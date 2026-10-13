// Tabs of a conversation, end to end: its group, a tab the agent opens (in the background while the user is elsewhere),
// a tab shared with @, a tab dragged out, and deleting the conversation.
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { panel, scriptReplies, seedFixtureModel, waitForText } from './panel-chat';

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, what: string): Promise<T> {
  for (let i = 0; i < 50; i++) {
    const v = await read();
    if (ok(v)) return v;
    await sleep(150);
  }
  throw new Error(`${what}: ${JSON.stringify(await read())}`);
}

defineCheck({
  name: 'panel-tabs',
  title: 'Tabs of a conversation',
  description: 'Group, agent-opened tab in the background, @ sharing, drag out, delete with the agent’s tabs.',
  async run() {
    await seedFixtureModel();
    await scriptReplies([
      { toolCalls: [{ name: 'tabs', input: { action: 'open', url: `${FIXTURE_ORIGIN}/c-effects.html` } }] },
      { toolCalls: [{ name: 'done', input: { outcome: 'success', summary: 'Opened the effects page.' } }] },
    ]);
    const start = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/c-text.html`, active: false });
    const other = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/index.html`, active: false });
    await waitForLoad(start.id!);
    await waitForLoad(other.id!);
    const view = await chrome.tabs.create({
      url: chrome.runtime.getURL(`/sidepanel.html#tab=${start.id}`),
      active: true,
    });
    await waitForLoad(view.id!);
    await sleep(600);
    const id = start.id!;
    const report: Record<string, unknown> = {};
    try {
      await panel(id, 'type-send', { text: 'Open the effects page' });
      await waitForText(id, 'Opened the effects page.');
      const startTab = await chrome.tabs.get(id);
      if (startTab.groupId === -1) throw new Error('the start tab is not in a group');
      const group = await chrome.tabGroups.get(startTab.groupId);
      const inGroup = await chrome.tabs.query({ groupId: startTab.groupId });
      const agentTab = inGroup.find(t => t.url?.includes('c-effects'));
      report.group = group.title;
      report.groupTabs = inGroup.length;
      if (!agentTab) throw new Error('the agent’s tab is not in the group');
      // The chip follows the page as it loads: its title, not the blank page the tab was opened on.
      report.agentChip = await until(
        async () => (await panel(id, 'read')).body.split('\n').find(l => l.startsWith('Effects')),
        line => line !== undefined,
        'the agent’s chip shows its page title',
      );
      // At a side panel's width, each chip stays one line tall: only the title is cut.
      const layout = (): Promise<{ innerWidth: number; tabChips: Array<{ text: string; height: number }> }> =>
        chrome.runtime.sendMessage({ nbTest: 'panel', tabId: id, op: 'layout' });
      const { innerWidth } = await layout();
      await chrome.tabs.setZoom(view.id!, Math.max(1, innerWidth / 220));
      await sleep(400);
      const narrow = await layout();
      await chrome.tabs.setZoom(view.id!, 0);
      const chipHeights = narrow.tabChips.map(c => Math.round(c.height));
      report.narrowWidth = narrow.innerWidth;
      report.chipHeights = chipHeights;
      if (chipHeights.some(h => h > 30)) throw new Error(`a tab chip wraps at ${narrow.innerWidth} px: ${chipHeights}`);
      // Nobody was watching the conversation's tabs: the visible tab is still the user's.
      const [visible] = await chrome.tabs.query({ active: true, windowId: view.windowId });
      report.visibleAfterOpen = visible.id === view.id ? 'user' : visible.url;
      if (visible.id !== view.id) throw new Error('the agent’s tab came to the front');

      // Share a tab with @.
      await panel(id, 'fill', { label: 'Ask anything…', text: '@Fixt' });
      await sleep(400);
      await panel(id, 'click', { label: 'Fixtures' });
      await until(
        async () => (await chrome.tabs.get(other.id!)).groupId,
        g => g === startTab.groupId,
        'shared with @',
      );
      const chips = await until(
        async () => (await panel(id, 'read')).body,
        b => b.includes('Fixtures'),
        'chip',
      );
      report.chips = chips.split('\n').filter(l => /Fixtures|Effects/.test(l));

      // Dragged out of the group: unshared, and the chip goes.
      await chrome.tabs.ungroup(other.id!);
      await until(
        async () => (await panel(id, 'read')).body,
        b => !b.split('\n').some(l => l === 'Fixtures'),
        'chip gone after drag out',
      );

      // Delete the conversation in Recent tasks and close the agent's tabs.
      await panel(id, 'click', { label: 'History' });
      await sleep(400);
      await panel(id, 'click', { label: 'Delete' });
      await sleep(200);
      const ask = (await panel(id, 'read')).dialog;
      report.deleteQuestion = ask.split('\n').find(l => l.startsWith('Also close'));
      await panel(id, 'click', { label: 'Close them' });
      await until(
        async () => (await chrome.tabs.get(agentTab.id!).catch(() => null)) === null,
        v => v,
        'agent tab closed',
      );
      report.startUngrouped = (await chrome.tabs.get(id)).groupId === -1;
      return report;
    } finally {
      for (const t of [view.id, start.id, other.id]) await chrome.tabs.remove(t!).catch(() => undefined);
    }
  },
});
