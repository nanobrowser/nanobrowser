// Attention: when a run needs the user, or finishes, while no panel of its conversation is in view, a system
// notification says so. Its text is the extension's own words and a site the extension read from the tab; never page or
// model text. A click brings the run's tab to the front. Notifications need a permission the user may not have allowed
// yet; without it, the toolbar badge is the only signal.
import { siteOf } from '@src/browser-control';
import type { OpenPrompt } from '@src/ui/protocol';

const tabOfNotification = new Map<string, number>();

const NEEDS: Record<string, (site: string) => string> = {
  'write-card': site => `Nanobrowser asks before it changes something on ${site}.`,
  handover: site => `Nanobrowser needs you: a step on ${site} is yours to do.`,
  'ask-takeover': site => `Nanobrowser needs you to do a step on ${site}.`,
  'ask-input': () => 'Nanobrowser has a question for you.',
  'save-file': () => 'Nanobrowser asks before it saves a file.',
  confirm: () => 'Nanobrowser has a question for you.',
};

async function siteOfTab(tabId: number | undefined): Promise<string> {
  if (tabId === undefined) return 'this site';
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  return siteOf(tab?.url ?? '') || 'this site';
}

export async function notifyNeeds(prompt: OpenPrompt, fallbackTab: number | undefined): Promise<void> {
  const tabId = prompt.tabId ?? fallbackTab;
  const site = await siteOfTab(tabId);
  await show(`needs-${prompt.id}`, (NEEDS[prompt.kind] ?? NEEDS.confirm)(site), tabId);
}

export async function notifyFinished(conversationId: string, ok: boolean, tabId: number | undefined): Promise<void> {
  await show(
    `done-${conversationId}`,
    ok ? 'Nanobrowser finished the task.' : 'Nanobrowser stopped before finishing.',
    tabId,
  );
}

async function show(id: string, message: string, tabId: number | undefined): Promise<void> {
  if (!globalThis.chrome?.notifications) return;
  if (tabId !== undefined) tabOfNotification.set(id, tabId);
  await chrome.notifications
    .create(id, { type: 'basic', iconUrl: chrome.runtime.getURL('/icon-128.png'), title: 'Nanobrowser', message })
    .catch(() => undefined);
}

export function clearNotification(id: string): void {
  void chrome.notifications?.clear(id).catch(() => undefined);
}

function onClicked(id: string): void {
  const tabId = tabOfNotification.get(id);
  clearNotification(id);
  if (tabId === undefined) return;
  // A click is a user gesture: the panel may open here (it is not known whether Chrome accepts it).
  chrome.sidePanel.open({ tabId }).catch(() => undefined);
  void chrome.tabs.update(tabId, { active: true }).then(tab => {
    if (tab?.windowId !== undefined) void chrome.windows.update(tab.windowId, { focused: true });
  });
}

/** The click listener, once chrome.notifications exists: when the worker starts, or when the user allows it later. */
function listen(): void {
  if (chrome.notifications && !chrome.notifications.onClicked.hasListener(onClicked)) {
    chrome.notifications.onClicked.addListener(onClicked);
  }
}

listen();
chrome.permissions?.onAdded.addListener(listen);
