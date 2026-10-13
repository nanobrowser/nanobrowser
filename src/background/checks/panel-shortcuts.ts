// Shortcuts. A pinned shortcut shows on the new-chat page in place of the fixed starters, which come back when none is
// pinned and send their text when clicked; `/` opens the launcher, and picking a shortcut opens its start page in the
// tab before the run and sends its text as the user's message with its mode; a start page on a blocked site is refused
// before anything is sent; Settings → Shortcuts lists them.
import { deleteShortcut, listShortcuts, saveShortcut } from '@src/store/shortcuts';
import { getConversation } from '@src/store/conversations';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { panel, scriptReplies, seedFixtureModel, waitForText } from './panel-chat';

const options = (op: string, extra: Record<string, unknown> = {}) =>
  chrome.runtime.sendMessage({ nbTest: 'options', op, ...extra }) as Promise<{ ok: boolean; body?: string }>;

async function lastUserText(): Promise<string> {
  const requests = (await (await fetch('http://localhost:8787/__llm/requests')).json()) as Array<{
    messages: Array<{ role: string; content: unknown }>;
  }>;
  return (requests.at(-1)?.messages ?? [])
    .filter(m => m.role === 'user')
    .flatMap(m =>
      typeof m.content === 'string' ? [m.content] : (m.content as Array<{ text?: string }>).map(p => p.text ?? ''),
    )
    .join('\n');
}

defineCheck({
  name: 'panel-shortcuts',
  title: 'Shortcuts',
  description:
    'The / launcher, a pinned shortcut or the starters on the new-chat page, the start page and mode, a blocked start page, Settings → Shortcuts.',
  async run() {
    await seedFixtureModel();
    for (const s of await listShortcuts()) await deleteShortcut(s.id);
    const rulesBefore = (await chrome.storage.local.get('nb.siteRules'))['nb.siteRules'] ?? {};
    await chrome.storage.local.set({
      'nb.siteRules': { ...rulesBefore, '127.0.0.1:8787': { rule: 'block', setAt: new Date().toISOString() } },
    });
    const startUrl = `${FIXTURE_ORIGIN}/c-states.html`;
    await saveShortcut({
      name: 'page-title',
      description: 'Say the title of the start page',
      text: 'What is the title of this page? Kq7Shortcut',
      startUrl,
      mode: 'auto',
      pinned: true,
    });
    await saveShortcut({
      name: 'blocked-start',
      description: 'A start page on a blocked site',
      text: 'This must not be sent.',
      startUrl: 'http://127.0.0.1:8787/c-text.html',
    });
    const page = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/c-text.html`, active: false });
    await waitForLoad(page.id!);
    const view = await chrome.tabs.create({
      url: chrome.runtime.getURL(`/sidepanel.html#tab=${page.id}`),
      active: true,
    });
    await waitForLoad(view.id!);
    await sleep(800);
    const id = page.id!;
    try {
      const empty = await panel(id, 'read');
      // The pinned shortcut shows by its description, in place of the fixed starters; the unpinned one does not.
      const pinnedOnEmpty =
        empty.body.includes('Say the title of the start page') &&
        !empty.body.includes('A start page on a blocked site') &&
        !empty.body.includes('Star us on GitHub');

      // The blocked start page: nothing is sent, the panel says why.
      await panel(id, 'type-send', { text: '/blocked' });
      await sleep(800);
      const blocked = await panel(id, 'read');
      const requestsAfterBlocked = (await (await fetch('http://localhost:8787/__llm/requests')).json()) as unknown[];

      // The launcher: `/page` and Enter picks the shortcut.
      await scriptReplies([{ text: 'The page is called Kq7Answer.' }]);
      await panel(id, 'type-send', { text: '/page' });
      const after = await waitForText(id, 'Kq7Answer', 20_000);
      const tab = await chrome.tabs.get(id);
      const userText = await lastUserText();
      const scope = (await chrome.storage.session.get('nb.scope'))['nb.scope'] as
        { tabs: Record<string, { conversationId: string }> } | undefined;
      const conversation = await getConversation(scope?.tabs[id]?.conversationId ?? '');
      const image = await chrome.tabs.captureVisibleTab(view.windowId, { format: 'png' });

      const settings = await chrome.tabs.create({
        url: chrome.runtime.getURL('/options.html#shortcuts'),
        active: true,
      });
      await waitForLoad(settings.id!);
      await sleep(800);
      const settingsPage = (await options('read')).body ?? '';
      await chrome.tabs.remove(settings.id!);

      // With no shortcut pinned, a new chat offers the fixed starters, and one click sends the text behind the label.
      for (const s of await listShortcuts()) await deleteShortcut(s.id);
      await panel(id, 'click', { label: 'New chat' });
      await sleep(800);
      const starters = (await panel(id, 'read')).body;
      await scriptReplies([{ text: 'Kq7Summary.' }]);
      await panel(id, 'click', { label: 'Summarize this page' });
      await waitForText(id, 'Kq7Summary', 20_000);
      const starterText = await lastUserText();

      const report = {
        pinnedOnEmpty,
        blockedSaid: blocked.body.includes('blocked'),
        blockedNotSent: requestsAfterBlocked.length === 0 && !blocked.transcript.includes('must not be sent'),
        startPageOpened: tab.url === startUrl,
        textSent: userText.includes('What is the title of this page? Kq7Shortcut'),
        startPageInState: userText.includes('c-states.html'),
        modeAuto: conversation?.mode === 'auto',
        messageShown: after.transcript.includes('Kq7Shortcut'),
        settingsList: settingsPage.includes('/page-title'),
        startersShown: ['Star us on GitHub', 'Summarize this page', 'Today on Hacker News'].every(x =>
          starters.includes(x),
        ),
        starterSent: starterText.includes('Summarize this page in a few bullet points.'),
        image,
      };
      const failed = Object.entries(report).filter(([, v]) => v === false);
      if (failed.length) {
        throw new Error(
          JSON.stringify({
            ...report,
            image: undefined,
            blocked: blocked.body.slice(-400),
            userText: userText.slice(0, 800),
          }),
        );
      }
      return report;
    } finally {
      await chrome.storage.local.set({ 'nb.siteRules': rulesBefore });
      for (const s of await listShortcuts()) await deleteShortcut(s.id);
      await chrome.tabs.remove(view.id!).catch(() => undefined);
      await chrome.tabs.remove(page.id!).catch(() => undefined);
    }
  },
});
