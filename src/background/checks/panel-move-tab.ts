// Sharing a tab that another conversation holds, through the real panel and port: the "Move it here?" card opens, and
// its answer reaches the worker although the command that opened it is still waiting for it. Covers the tab picked with
// @ before the first message (shared when the message is sent) and the tab shared with @ in a running conversation. The
// moved tab's open panel then shows the conversation it joined.
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { panel, scriptReplies, seedFixtureModel, waitForText } from './panel-chat';

const scopeOf = async (tabId: number) =>
  (
    (await chrome.storage.session.get('nb.scope'))['nb.scope'] as
      { tabs: Record<string, { conversationId: string }> } | undefined
  )?.tabs[tabId]?.conversationId ?? null;

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, what: string): Promise<T> {
  for (let i = 0; i < 60; i++) {
    const v = await read();
    if (ok(v)) return v;
    await sleep(150);
  }
  throw new Error(`${what}: ${JSON.stringify(await read())}`);
}

async function pickWithAt(viewTab: number, title: string): Promise<boolean> {
  await panel(viewTab, 'fill', { label: 'Ask anything…', text: `@${title.slice(0, 6)}` });
  await sleep(400);
  return (await panel(viewTab, 'click', { label: `${title} localhost:8787` })).ok;
}

defineCheck({
  name: 'panel-move-tab',
  title: 'Move a tab from another conversation',
  description: 'The "Move it here?" card answers through the panel (Move), for a tab picked before the first message.',
  async run() {
    await seedFixtureModel();
    const held = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/c-states.html`, active: false });
    const mine = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/c-text.html`, active: false });
    await waitForLoad(held.id!);
    await waitForLoad(mine.id!);
    const viewA = await chrome.tabs.create({ url: chrome.runtime.getURL(`/sidepanel.html#tab=${held.id}`) });
    await waitForLoad(viewA.id!);
    await sleep(600);
    const report: Record<string, unknown> = {};
    let viewB: chrome.tabs.Tab | undefined;
    try {
      // Conversation A holds the tab.
      await scriptReplies([{ text: 'A answered.' }]);
      await panel(held.id!, 'type-send', { text: 'First conversation' });
      await waitForText(held.id!, 'A answered.');
      const a = await scopeOf(held.id!);
      viewB = await chrome.tabs.create({ url: chrome.runtime.getURL(`/sidepanel.html#tab=${mine.id}`), active: true });
      await waitForLoad(viewB.id!);
      await sleep(600);
      const title = (await chrome.tabs.get(held.id!)).title ?? '';
      // Conversation B picks it with @ before its first message, then sends.
      report.picked = await pickWithAt(mine.id!, title);
      await scriptReplies([{ text: 'B answered with both tabs.' }]);
      await panel(mine.id!, 'type-send', { text: 'Second conversation' });
      report.cardShown = (
        await until(
          async () => (await panel(mine.id!, 'read')).body,
          b => b.includes('Another conversation is using this tab'),
          'card',
        )
      ).includes('Move it here');
      report.clicked = (await panel(mine.id!, 'click', { label: 'Move' })).ok;
      await waitForText(mine.id!, 'B answered with both tabs.');
      const b = await scopeOf(mine.id!);
      report.cardClosed = !(await panel(mine.id!, 'read')).body.includes('Another conversation is using this tab');
      report.moved = !!b && b !== a && (await scopeOf(held.id!)) === b;
      // The moved tab's open panel follows it to the conversation it joined.
      report.panelFollowed = await waitForText(held.id!, 'Second conversation')
        .then(() => true)
        .catch(() => false);
      report.image = await chrome.tabs.captureVisibleTab(viewB.windowId, { format: 'png' });
      if (Object.entries(report).some(([k, v]) => k !== 'image' && !v)) {
        throw new Error(JSON.stringify({ ...report, image: undefined, a, b }));
      }
      return report;
    } finally {
      for (const t of [viewA, viewB, held, mine]) if (t?.id) await chrome.tabs.remove(t.id).catch(() => undefined);
    }
  },
});
