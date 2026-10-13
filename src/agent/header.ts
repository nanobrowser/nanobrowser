// The page header: a short block after the last message of every request, never stored, so the cached prefix stays
// intact. Every page string in it is a quoted fragment; everything else is the extension's own text.
import { quote } from '@src/browser-control';
import type { PendingModal, TabsData } from '@src/browser-control';
import type { PermissionMode } from '@src/store/types';

export interface HeaderInput {
  now: Date;
  timeZone?: string;
  mode: PermissionMode;
  tabs: TabsData;
  tabInfo: (tabId: number) => { rev: number; pending: PendingModal[] } | null;
  /** Tabs whose address changed since the model last saw them, not by the agent's own action. */
  changed: Array<{ tabId: number; url: string }>;
}

function time(now: Date, timeZone?: string): string {
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} (${zone})`;
}

function tabLine(tab: TabsData['tabs'][number], rev: number | undefined): string {
  return `[${tab.tabId}] ${quote(tab.title || '(untitled)')} ${quote(tab.url)}${rev ? ` · rev ${rev}` : ''}`;
}

export function browserState(input: HeaderInput): string {
  const lines = [`time: ${time(input.now, input.timeZone)} · mode: ${input.mode}`];
  const active = input.tabs.tabs.find(t => t.tabId === input.tabs.activeTabId);
  const others = input.tabs.tabs.filter(t => t.tabId !== input.tabs.activeTabId);
  lines.push(
    active
      ? `active tab: ${tabLine(active, input.tabInfo(active.tabId)?.rev)}`
      : 'active tab: none (open or share one)',
  );
  if (others.length) lines.push(`other tabs: ${others.map(t => tabLine(t, input.tabInfo(t.tabId)?.rev)).join(' · ')}`);
  for (const tab of input.tabs.tabs) {
    for (const p of input.tabInfo(tab.tabId)?.pending ?? [])
      lines.push(`pending: ${p.kind} on tab ${tab.tabId}: ${p.detail}`);
  }
  for (const c of input.changed) {
    lines.push(`tab ${c.tabId} changed since you last saw it (now ${quote(c.url)}); earlier refs may be stale`);
  }
  return ['<browser-state>', ...lines, '</browser-state>'].join('\n');
}
