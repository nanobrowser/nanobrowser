// Renders the test panel in a tab and captures it, so the panel can be looked at in unattended runs.
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { attach } from '../spike-session';

defineCheck({
  name: 'panel-screenshot',
  title: 'Panel screenshot',
  description: 'Opens the side panel page in a tab (optionally on a given panel tab) and captures it as PNG.',
  async run(args) {
    const panelTab = (args.tab as string | undefined) ?? '';
    // Optionally share a fixture page with the session first, so tabs that act on it have something to show.
    let shared: number | undefined;
    if (args.share) {
      const page = await chrome.tabs.create({ url: String(args.share), active: false });
      await waitForLoad(page.id!);
      await attach(page.id!);
      shared = page.id;
    }
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL(`/testpanel.html#${panelTab}`), active: true });
    try {
      await waitForLoad(tab.id!);
      await sleep(Number(args.waitMs ?? 1000));
      // Optionally leave a confirmation waiting, so the Prompts tab shows a card.
      let pending: Promise<unknown> | undefined;
      if (args.pendingDelete && shared !== undefined) {
        const { session } = await (await import('../layer')).layer();
        const snap = await session.call('snapshot', { tabId: shared });
        const ref = /\[(\w+)\] button "Delete"/.exec(snap.page?.snapshot ?? '')?.[1];
        pending = session.call('click', { target: { ref }, intent: 'Delete invoice INV-1042' });
        await sleep(800);
        await chrome.tabs.reload(tab.id!);
        await waitForLoad(tab.id!);
        await sleep(800);
      }
      // Optionally run scenarios first, so their results show in the Scenarios tab.
      if (args.runSets) await (await import('../scenarios/registry')).runAll(args.runSets as never);
      await sleep(300);
      const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      if (pending) {
        const prompts = await import('../prompts');
        for (const id of ['c1', 'c2', 'c3', 'c4', 'c5']) prompts.answer(id, 'decline');
        await pending;
      }
      return { image };
    } finally {
      await chrome.tabs.remove(tab.id!);
      if (shared !== undefined) await chrome.tabs.remove(shared).catch(() => undefined);
    }
  },
});
