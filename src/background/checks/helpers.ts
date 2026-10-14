// Helpers for checks. Checks may use raw page script to set up a situation; the layer itself never does.
import { sendRaw } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { call } from '../rpc';
import type { TabSummary } from '../messages';

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

/** Opens a tab, runs fn, and closes the tab (detaching first if fn attached). */
export async function withTab<T>(url: string, fn: (tab: TabSummary) => Promise<T>): Promise<T> {
  const tab = await call<TabSummary>('tabs.open', { url });
  try {
    return await fn(tab);
  } finally {
    await call('session.detach', { tabId: tab.tabId }).catch(() => undefined);
    await chrome.tabs.remove(tab.tabId).catch(() => undefined);
  }
}

/** Resolves when the tab next reports status 'complete', or after the budget. */
export function waitForLoad(tabId: number, budgetMs = 10_000): Promise<chrome.tabs.Tab> {
  return new Promise(resolve => {
    const timer = setTimeout(done, budgetMs);
    function done() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      void chrome.tabs.get(tabId).then(resolve);
    }
    function listener(id: number, info: chrome.tabs.OnUpdatedInfo) {
      if (id === tabId && info.status === 'complete') done();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

export async function evaluate<T = unknown>(
  tabId: number,
  sessionId: string | undefined,
  expression: string,
): Promise<T> {
  const response = await sendRaw<{ result: { value: T }; exceptionDetails?: { text: string } }>(
    tabId,
    sessionId,
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
  );
  if (response.exceptionDetails) throw new Error(`evaluate failed: ${response.exceptionDetails.text}`);
  return response.result.value;
}

export interface RequestCounters {
  requests: Array<{ host: string; method: string; path: string; count: number }>;
  posts: Array<{ host: string; body: string }>;
}

export async function resetRequests(): Promise<void> {
  await fetch(`${FIXTURE_ORIGIN}/__reset`, { method: 'POST' });
}

export async function readRequests(): Promise<RequestCounters> {
  return (await fetch(`${FIXTURE_ORIGIN}/__requests`)).json();
}

export function countOf(counters: RequestCounters, method: string, path: string, host?: string): number {
  return counters.requests
    .filter(r => r.method === method && r.path === path && (!host || r.host === host))
    .reduce((n, r) => n + r.count, 0);
}
