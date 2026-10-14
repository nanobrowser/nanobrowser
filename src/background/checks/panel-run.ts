// The user during a run, in the panel: a message typed while the agent works is queued and delivered as steering; Stop
// gives queued messages back to the composer; there is no Take over, and a message after Stop carries the task on;
// Continue after the turn cap.
import { getRun } from '@src/store/conversations';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { panel, scriptReplies, seedFixtureModel, waitForText } from './panel-chat';

async function until(read: () => Promise<string>, ok: (v: string) => boolean, what: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const v = await read();
    if (ok(v)) return v;
    await sleep(150);
  }
  throw new Error(`${what}: ${await read()}`);
}

defineCheck({
  name: 'panel-run',
  title: 'The user during a run',
  description:
    'Queue and steering, Stop with returned messages, no Take over and a message after Stop, Continue after the cap.',
  async run() {
    await seedFixtureModel();
    const page = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/c-text.html`, active: false });
    await waitForLoad(page.id!);
    const view = await chrome.tabs.create({
      url: chrome.runtime.getURL(`/sidepanel.html#tab=${page.id}`),
      active: true,
    });
    await waitForLoad(view.id!);
    await sleep(600);
    const id = page.id!;
    const body = async () => (await panel(id, 'read')).body;
    const report: Record<string, unknown> = {};
    try {
      // 1. Queue and steering: the second message waits while the first turn works, then reaches the model.
      await scriptReplies([
        { toolCalls: [{ name: 'read', input: {} }], delayMs: 1500 },
        { text: 'Answered with the steering.' },
      ]);
      await panel(id, 'type-send', { text: 'Read the page' });
      await sleep(300);
      await panel(id, 'type-send', { text: 'Also count the words' });
      report.queued = (await until(body, b => b.includes('Sent when the current action finishes'), 'queued')).includes(
        'Also count the words',
      );
      // The queue is in the run record too, so a worker restart would hand it back.
      const scope = (await chrome.storage.session.get('nb.scope'))['nb.scope'] as
        { tabs: Record<string, { conversationId: string }> } | undefined;
      const stored = await getRun(scope?.tabs[id]?.conversationId ?? '');
      report.queueStored = !!stored?.steering.some(q => q.text === 'Also count the words');
      await waitForText(id, 'Answered with the steering.');
      const requests = (await (await fetch('http://localhost:8787/__llm/requests')).json()) as unknown[];
      report.steeringDelivered = JSON.stringify(requests.at(-1)).includes('Also count the words');
      await until(
        async () => (await panel(id, 'read')).status,
        s => s === 'Done',
        'done 1',
      );

      // 2. Stop: the queued message comes back to the composer.
      await scriptReplies([{ text: 'Slow', delayMs: 4000 }]);
      await panel(id, 'type-send', { text: 'Take your time' });
      await sleep(300);
      await panel(id, 'type-send', { text: 'Then do this' });
      await sleep(300);
      await panel(id, 'click', { label: 'Stop' });
      report.returnedToComposer = await until(
        async () => (await panel(id, 'read')).input,
        v => v.includes('Then do this'),
        'returned',
      );
      await until(
        async () => (await panel(id, 'read')).status,
        s => s === 'Stopped',
        'stopped',
      );
      await panel(id, 'fill', { label: 'Ask anything…', text: '' });

      // 3. There is no Take over: while a run works the panel offers Stop, not Take over. Stop
      // gives the page back, Recent tasks opens again, and a message afterwards carries the task on.
      const status = async () => (await panel(id, 'read')).status;
      await scriptReplies([{ text: 'Slow again', delayMs: 4000 }, { text: 'Carried on after Stop.' }]);
      await panel(id, 'type-send', { text: 'Work on it' });
      await sleep(400);
      const working = await panel(id, 'read');
      report.noTakeOver =
        (working.disabled?.includes('History') ?? false) &&
        !working.body.includes('Take over') &&
        !(working.buttons ?? []).includes('Take over');
      await panel(id, 'click', { label: 'Stop' });
      await until(status, s => s === 'Stopped', 'stopped');
      report.historyOpenAfterStop = !(await panel(id, 'read')).disabled?.includes('History');
      // Stop says so in the transcript, and the next run's model is told the last one was stopped.
      report.stopNotice = (await panel(id, 'read')).body.includes('What should Nanobrowser do instead?');
      await panel(id, 'type-send', { text: 'Carry on' });
      await waitForText(id, 'Carried on after Stop.');
      const afterStop = (await (await fetch('http://localhost:8787/__llm/requests')).json()) as unknown[];
      report.stopNoteSent = JSON.stringify(afterStop.at(-1)).includes('the user stopped the run');
      await until(status, s => s === 'Done', 'done 3');

      // 4. The turn cap and Continue.
      const settings = (await chrome.storage.local.get('nb.settings'))['nb.settings'] ?? {};
      await chrome.storage.local.set({ 'nb.settings': { ...settings, turnCap: 1 } });
      await scriptReplies([
        { toolCalls: [{ name: 'read', input: {} }] },
        { toolCalls: [{ name: 'done', input: { outcome: 'partial', summary: 'Stopped at the limit.' } }] },
        { text: 'Continued.' },
      ]);
      await panel(id, 'type-send', { text: 'A long task' });
      report.capped = (await until(body, b => b.includes('stopped at its turn limit'), 'capped')).includes('Continue');
      await chrome.storage.local.set({ 'nb.settings': { ...settings, turnCap: 100 } });
      await panel(id, 'click', { label: 'Continue' });
      await waitForText(id, 'Continued.');
      report.image = await chrome.tabs.captureVisibleTab(view.windowId, { format: 'png' });
      const failed = Object.entries(report).filter(([k, v]) => k !== 'image' && !v);
      if (failed.length) throw new Error(`failed: ${JSON.stringify(report)}`);
      return report;
    } finally {
      await chrome.tabs.remove(view.id!).catch(() => undefined);
      await chrome.tabs.remove(page.id!).catch(() => undefined);
    }
  },
});
