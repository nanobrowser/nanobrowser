// Diagnostic for background mode: what happens when a page in a background tab opens a tab (window.open,
// target=_blank) after a click the layer dispatched. Records every tab Chrome creates, with its opener and whether it
// came to the front.
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { layer } from '../layer';
import { openTab, setBackgroundMode } from '../tabs';
import { defineCheck } from './registry';
import { sleep } from './helpers';

defineCheck({
  name: 'background-popup',
  title: 'Popup from a background tab',
  description:
    'Clicks "Open a new tab" on c-effects.html with the tab in front and in the background, and reports what opened.',
  async run() {
    const { controller } = await layer();
    const report: unknown[] = [];
    for (const background of [false, true]) {
      if (background) await setBackgroundMode(true);
      const created: Array<{ id?: number; opener?: number; active: boolean; url?: string }> = [];
      const onCreated = (t: chrome.tabs.Tab) =>
        created.push({ id: t.id, opener: t.openerTabId, active: t.active, url: t.pendingUrl ?? t.url });
      chrome.tabs.onCreated.addListener(onCreated);
      const tab = await openTab(`${FIXTURE_ORIGIN}/c-effects.html`);
      const session = controller.createSession();
      session.shareTab(tab.id!);
      try {
        const snap = await session.call('snapshot', { tabId: tab.id });
        const ref = /\[(\w+)\] button "Open a new tab"/.exec(snap.page?.snapshot ?? '')?.[1];
        const r = await session.call('click', { tabId: tab.id, target: { ref } });
        await sleep(1500);
        const activeNow = (await chrome.tabs.query({ active: true, windowId: tab.windowId }))[0];
        report.push({
          background,
          receiptNewTab: r.receipt?.newTab,
          signals: r.receipt?.effect.signals,
          created: created.filter(c => c.id !== tab.id),
          activeTabNow: activeNow?.id === tab.id ? 'operated tab' : activeNow?.url,
        });
      } finally {
        chrome.tabs.onCreated.removeListener(onCreated);
        for (const c of created) if (c.id && c.id !== tab.id) await chrome.tabs.remove(c.id).catch(() => undefined);
        await controller.closeSession(session);
        await chrome.tabs.remove(tab.id!).catch(() => undefined);
        if (background) await setBackgroundMode(false);
      }
    }
    return { report };
  },
});
