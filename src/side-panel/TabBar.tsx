// The conversation's tabs above the composer, and the @ picker that shares one. Titles are text nodes; a tab chip's ×
// unshares the tab, which stays open.
import { useEffect, useState } from 'react';
import type { ScopeTab } from '@src/ui/protocol';
import { t } from '@src/ui/i18n';
import { plain } from './Cards';
import { CloseIcon } from '@src/ui/icons';

export function TabBar({ tabs, onUnshare }: { tabs: ScopeTab[]; onUnshare: (tabId: number) => void }) {
  if (!tabs.length) return null;
  return (
    <ul aria-label={t('tabs.bar')} data-role="tab-chips" className="flex flex-wrap gap-1 px-2 pb-1">
      {tabs.map(tab => (
        <li
          key={tab.tabId}
          className="flex min-w-0 max-w-full items-center gap-1 rounded-full border border-nb-accent/15 bg-nb-surface px-2 py-0.5 text-xs">
          {tab.favIconUrl && /^https?:/.test(tab.favIconUrl) ? (
            <img src={tab.favIconUrl} alt="" className="size-3 shrink-0" referrerPolicy="no-referrer" />
          ) : null}
          <span className="min-w-0 truncate" title={plain(tab.url)}>
            {plain(tab.title) || plain(tab.url)}
          </span>
          {tab.origin !== 'start' ? (
            <button
              type="button"
              className="shrink-0 rounded-full p-0.5 text-nb-muted hover:bg-nb-bg hover:text-nb-fg"
              aria-label={t('tabs.unshare', { title: plain(tab.title) })}
              onClick={() => onUnshare(tab.tabId)}>
              <CloseIcon size={11} />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** The @ picker: the tabs of this window, filtered by what follows the @. */
export function TabPicker({
  query,
  exclude,
  onPick,
}: {
  query: string;
  exclude: number[];
  onPick: (tab: { tabId: number; title: string }) => void;
}) {
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);
  useEffect(() => {
    void chrome.tabs.query({ currentWindow: true }).then(setTabs);
  }, []);
  const q = query.toLowerCase();
  const shown = tabs.filter(
    tab =>
      tab.id !== undefined &&
      !exclude.includes(tab.id) &&
      /^https?:/.test(tab.url ?? '') &&
      (!q || `${tab.title} ${tab.url}`.toLowerCase().includes(q)),
  );
  return (
    <div
      role="listbox"
      aria-label={t('tabs.pick')}
      className="max-h-48 overflow-y-auto rounded-xl border border-nb-border bg-nb-bg p-1 text-xs shadow-pop">
      {shown.length === 0 ? <p className="p-2 text-nb-muted">{t('tabs.none')}</p> : null}
      {shown.map(tab => (
        <button
          key={tab.id}
          type="button"
          role="option"
          aria-selected={false}
          aria-label={`${plain(tab.title)} ${plain(new URL(tab.url!).host)}`}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-nb-surface"
          onClick={() => onPick({ tabId: tab.id!, title: tab.title ?? '' })}>
          <span className="truncate">{plain(tab.title)}</span>
          <span className="truncate text-nb-muted">{plain(new URL(tab.url!).host)}</span>
        </button>
      ))}
    </div>
  );
}
