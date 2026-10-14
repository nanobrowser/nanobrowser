// chrome.tabs and chrome.storage behind the core's host interfaces.
import { LayerError } from '../protocol/errors';
import type { EpochStore, HostTab, TabHost } from '../core/ports';

function toHostTab(tab: chrome.tabs.Tab): HostTab {
  return {
    tabId: tab.id ?? -1,
    windowId: tab.windowId,
    url: tab.url ?? tab.pendingUrl ?? '',
    title: tab.title ?? '',
    active: tab.active,
    openerTabId: tab.openerTabId,
    status: (tab.status as HostTab['status']) ?? 'complete',
  };
}

export const chromeTabHost: TabHost = {
  async get(tabId) {
    try {
      return toHostTab(await chrome.tabs.get(tabId));
    } catch {
      return null;
    }
  },
  async list() {
    return (await chrome.tabs.query({})).filter(t => t.id !== undefined).map(toHostTab);
  },
  async open(url, options = {}) {
    return toHostTab(
      await chrome.tabs.create({ url, active: options.active ?? true, openerTabId: options.openerTabId }),
    );
  },
  load(tabId, url, timeoutMs) {
    return new Promise<void>((resolve, reject) => {
      let started = false;
      const done = (error?: unknown) => {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        if (error) reject(error);
        else resolve();
      };
      // Finished when the tab has started loading and is complete again, wherever redirects took it.
      const listener = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
        if (id !== tabId) return;
        if (info.status === 'loading') started = true;
        else if (info.status === 'complete' && started) done();
      };
      const timer = setTimeout(
        () =>
          done(
            new LayerError('TIMEOUT', `Tab ${tabId} did not finish loading ${url} in ${timeoutMs} ms`, {
              delivered: 'unknown',
            }),
          ),
        timeoutMs,
      );
      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs.update(tabId, { url }).catch(done);
    });
  },
  async activate(tabId) {
    // The window is never focused: the user may be working in another one.
    await chrome.tabs.update(tabId, { active: true });
  },
  async setDiscardable(tabId, discardable) {
    await chrome.tabs.update(tabId, { autoDiscardable: discardable }).catch(() => undefined);
  },
  async close(tabId) {
    await chrome.tabs.remove(tabId);
  },
  onRemoved(handler) {
    const listener = (tabId: number) => handler(tabId);
    chrome.tabs.onRemoved.addListener(listener);
    return () => chrome.tabs.onRemoved.removeListener(listener);
  },
  onCreated(handler) {
    const listener = (tab: chrome.tabs.Tab) => {
      if (tab.id !== undefined) handler(toHostTab(tab));
    };
    chrome.tabs.onCreated.addListener(listener);
    return () => chrome.tabs.onCreated.removeListener(listener);
  },
  onNavigationTarget(handler) {
    const listener = (details: chrome.webNavigation.WebNavigationSourceCallbackDetails) =>
      handler({ sourceTabId: details.sourceTabId, tabId: details.tabId, url: details.url });
    chrome.webNavigation.onCreatedNavigationTarget.addListener(listener);
    return () => chrome.webNavigation.onCreatedNavigationTarget.removeListener(listener);
  },
};

const EPOCH_KEY = 'browserControl.epoch';

export const chromeEpochStore: EpochStore = {
  async read() {
    const value = (await chrome.storage.local.get(EPOCH_KEY))[EPOCH_KEY];
    return typeof value === 'number' ? value : null;
  },
  async write(epoch) {
    await chrome.storage.local.set({ [EPOCH_KEY]: epoch });
    // Confirm the write by reading it back.
    const stored = (await chrome.storage.local.get(EPOCH_KEY))[EPOCH_KEY];
    if (stored !== epoch) throw new Error('Epoch write not confirmed');
  },
};
