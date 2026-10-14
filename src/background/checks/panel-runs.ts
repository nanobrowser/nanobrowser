// The panel for runs: the activity block in plain language with its tags, the line under an answer (Copy and its time),
// Edit and Restart from here as new branches, Retry after an error, and the Settings pages for Agent and Permissions.
import { DEFAULT_SETTINGS, settingsStorage, siteRulesStorage } from '@src/store/settings';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { panel, scriptReplies, seedFixtureModel, waitForText } from './panel-chat';

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, what: string): Promise<T> {
  for (let i = 0; i < 60; i++) {
    const v = await read();
    if (ok(v)) return v;
    await sleep(150);
  }
  throw new Error(`${what}: ${JSON.stringify(await read())}`);
}

const options = (op: string, extra: Record<string, unknown> = {}) =>
  chrome.runtime.sendMessage({ nbTest: 'options', op, ...extra }) as Promise<{ ok: boolean; body?: string }>;

defineCheck({
  name: 'panel-runs',
  title: 'The panel for runs',
  description: 'Activity rows, the answer line, Edit, Restart from here, Retry, Settings → General and Permissions.',
  async run() {
    await seedFixtureModel();
    const page = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/g-writes.html`, active: false });
    await waitForLoad(page.id!);
    const view = await chrome.tabs.create({
      url: chrome.runtime.getURL(`/sidepanel.html#tab=${page.id}`),
      active: true,
    });
    await waitForLoad(view.id!);
    await sleep(600);
    const id = page.id!;
    const read = () => panel(id, 'read');
    const report: Record<string, unknown> = {};
    await siteRulesStorage.set({});
    try {
      // 1. Activity: a write allowed on the card, a navigate the agent wrote, and the run's answer.
      await scriptReplies([
        {
          toolCalls: [
            { name: 'click', input: { target: { role: 'button', name: 'Send' }, intent: 'Send the reply to Dana' } },
          ],
        },
        { toolCalls: [{ name: 'navigate', input: { url: `${FIXTURE_ORIGIN}/c-text.html` } }] },
        { toolCalls: [{ name: 'snapshot', input: {} }] },
        { toolCalls: [{ name: 'done', input: { outcome: 'success', summary: 'Sent it and opened the text page.' } }] },
      ]);
      await panel(id, 'type-send', { text: 'Send the reply' });
      await until(
        async () => (await read()).body,
        b => b.includes('Send this?'),
        'write card',
      );
      await panel(id, 'click', { label: 'Allow' });
      await waitForText(id, 'Sent it and opened the text page.');
      await until(
        async () => (await read()).status,
        s => s === 'Done',
        'done 1',
      );
      const steps = (await read()).transcript.split('\n').find(l => /^Worked for /.test(l.trim()));
      await panel(id, 'click', { label: steps?.trim() });
      await sleep(200);
      const activity = (await read()).transcript;
      report.activity = activity.split('\n').filter(l => /Clicked|Went to|allowed|written/.test(l));
      if (!/Clicked .*Send/.test(activity) || !/submit · allowed by you/.test(activity) || !/Went to /.test(activity)) {
        throw new Error(`activity:\n${activity}`);
      }
      if (!/Address written by the agent/.test(activity))
        throw new Error('navigate not marked as written by the agent');
      // Under the answer: Copy and its time, and no message info.
      const answered = await read();
      report.answerLine = answered.buttons?.includes('Copy') && /\bnow\b|minute/.test(answered.transcript);
      if (!report.answerLine || /tokens ·/.test(answered.transcript))
        throw new Error(`answer line:\n${answered.transcript}`);

      // 2. Restart from here: the same question answered again, as a new branch.
      await scriptReplies([{ text: 'A restarted answer.' }]);
      await panel(id, 'click', { label: 'Restart from here' });
      const restarted = await waitForText(id, 'A restarted answer.');
      report.restarted = !restarted.transcript.includes('Sent it and opened');
      await until(
        async () => (await read()).status,
        s => s === 'Done',
        'done 2',
      );

      // 3. Edit: the question changed; the answer follows the edited text.
      await scriptReplies([{ text: 'Answer to the edited question.' }]);
      await panel(id, 'click', { label: 'Edit' });
      await sleep(100);
      await panel(id, 'fill', { label: 'Edit', text: 'An edited question', submit: true });
      const edited = await waitForText(id, 'Answer to the edited question.');
      report.edited = edited.transcript.includes('An edited question') && !edited.transcript.includes('Send the reply');
      const requests = (await (await fetch('http://localhost:8787/__llm/requests')).json()) as unknown[];
      report.editedSent = JSON.stringify(requests.at(-1)).includes('An edited question');
      await until(
        async () => (await read()).status,
        s => s === 'Done',
        'done 3',
      );

      // 4. Retry after an error.
      await scriptReplies([{ status: 400, error: 'Bad request from the fixture' }, { text: 'Worked on retry.' }]);
      await panel(id, 'type-send', { text: 'Try this' });
      await until(
        async () => (await read()).transcript,
        b => b.includes('Retry'),
        'retry button',
      );
      await panel(id, 'click', { label: 'Retry' });
      await waitForText(id, 'Worked on retry.');
      report.retried = true;
      report.panelImage = await chrome.tabs.captureVisibleTab(view.windowId, { format: 'png' });

      // 5. Settings → General: the keyboard shortcut and the turn cap. Settings → Permissions: a site added by hand.
      const before = await settingsStorage.get();
      const opts = await chrome.tabs.create({ url: chrome.runtime.getURL('/options.html#general'), active: true });
      await waitForLoad(opts.id!);
      await sleep(800);
      const generalPage = (await options('read')).body ?? '';
      report.generalPage =
        /Open side panel/.test(generalPage) && /Maximum turns/.test(generalPage) && !/tokens/.test(generalPage);
      if (!report.generalPage) throw new Error(`general page:\n${generalPage}`);
      await options('fill', { label: 'Maximum turns', text: '42' });
      await sleep(300);
      report.turnCap = (await settingsStorage.get()).turnCap === 42;
      report.generalImage = await chrome.tabs.captureVisibleTab(opts.windowId, { format: 'png' });
      await options('click', { label: 'Permissions' });
      await sleep(300);
      await options('fill', { label: 'Add a site', text: 'https://www.Example.com/path', submit: true });
      await sleep(300);
      const rules = await siteRulesStorage.get();
      report.siteAdded = rules['example.com']?.rule === 'allow';
      await options('select', { label: 'Rule for example.com', value: 'block' });
      await sleep(300);
      report.siteBlocked = (await siteRulesStorage.get())['example.com']?.rule === 'block';
      report.permissionsImage = await chrome.tabs.captureVisibleTab(opts.windowId, { format: 'png' });
      await settingsStorage.set({ ...DEFAULT_SETTINGS, ...before });
      await chrome.tabs.remove(opts.id!).catch(() => undefined);
      const failed = Object.entries(report).filter(([, v]) => v === false);
      if (failed.length) throw new Error(`failed: ${JSON.stringify(report)}`);
      return report;
    } finally {
      await siteRulesStorage.set({});
      await chrome.tabs.remove(view.id!).catch(() => undefined);
      await chrome.tabs.remove(page.id!).catch(() => undefined);
    }
  },
});
