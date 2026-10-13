// "Ask Nanobrowser about this", the only context-menu item: on a selection, it opens the side panel on that tab (a menu
// click is a user gesture) and puts the selection in the composer as a quote chip.
import { PANEL_PATH } from './panel';
import type { RunManager } from './run-manager';

const MENU_ID = 'nb-ask-selection';

export function listenForSelections(manager: RunManager): void {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      // Chrome's menus follow Chrome's language, so the title comes from the extension's locales.
      const title = chrome.i18n.getMessage('menuAskAboutSelection') || 'Ask Nanobrowser about this';
      chrome.contextMenus.create({ id: MENU_ID, title, contexts: ['selection'] });
    });
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || tab?.id === undefined || !info.selectionText) return;
    const tabId = tab.id;
    void chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true }).catch(() => undefined);
    void chrome.sidePanel.open({ tabId }).catch(() => undefined);
    manager.addSelection(tabId, {
      text: info.selectionText,
      url: tab.url ?? info.pageUrl ?? '',
      title: tab.title ?? '',
    });
  });
}
