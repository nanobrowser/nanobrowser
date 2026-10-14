import type { TabSummary } from './messages';
import { register } from './rpc';

export function summarize(tab: chrome.tabs.Tab): TabSummary {
  return {
    tabId: tab.id ?? -1,
    windowId: tab.windowId,
    url: tab.url ?? '',
    title: tab.title ?? '',
    active: tab.active,
  };
}

/**
 * Background mode: fixture tabs open in the background, behind a tab the "user" stays on, so the layer's scenarios run
 * on tabs that are not visible.
 */
let userTab: number | null = null;

export async function setBackgroundMode(on: boolean): Promise<void> {
  if (!on) {
    if (userTab !== null) await chrome.tabs.remove(userTab).catch(() => undefined);
    userTab = null;
    return;
  }
  const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
  userTab = tab.id!;
}

export function backgroundUserTab(): number | null {
  return userTab;
}

/** Opens a tab and resolves once it has finished loading, or after the budget. */
export async function openTab(url: string, budgetMs = 15_000): Promise<chrome.tabs.Tab> {
  const tab = await chrome.tabs.create({ url, active: userTab === null });
  const tabId = tab.id!;
  await new Promise<void>(resolve => {
    const timer = setTimeout(done, budgetMs);
    function done() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(id: number, info: chrome.tabs.OnUpdatedInfo) {
      if (id === tabId && info.status === 'complete') done();
    }
    chrome.tabs.onUpdated.addListener(listener);
    // A fast page may have finished before the listener was added.
    void chrome.tabs.get(tabId).then(t => {
      if (t.status === 'complete' && t.url !== 'about:blank') done();
    });
  });
  return chrome.tabs.get(tabId);
}

register('tabs.list', async () => {
  const tabs = await chrome.tabs.query({});
  return tabs.filter(t => t.id !== undefined).map(summarize);
});

register('tabs.open', async params => {
  const { url } = params as { url: string };
  return summarize(await openTab(url));
});

register('tabs.close', async params => {
  const { tabId } = params as { tabId: number };
  await chrome.tabs.remove(tabId);
  return null;
});
