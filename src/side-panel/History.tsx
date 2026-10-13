// History: "Recent tasks" over the whole panel, one card per conversation with its title on one line and its date under
// it, with search, and Rename, Export as Markdown and Delete on hover or focus. Opening one shows it in this tab's
// panel. Titles are text nodes only.
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import type { ConversationSummary } from '@src/ui/protocol';
import { currentLanguage, t } from '@src/ui/i18n';
import { CloseIcon, DownloadIcon, PencilIcon, TrashIcon } from '@src/ui/icons';

export function HistoryDrawer({
  open,
  onOpenChange,
  items,
  currentId,
  onQuery,
  onOpen,
  onRename,
  onDelete,
  onExport,
  agentTabsOnEnd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ConversationSummary[];
  currentId: string | null;
  onQuery: (query: string) => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string, closeAgentTabs: boolean, remember: boolean) => void;
  /** Export as Markdown. */
  onExport: (id: string) => void;
  agentTabsOnEnd: 'ask' | 'close' | 'keep';
}) {
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => onQuery(query), 150);
    return () => clearTimeout(timer);
  }, [open, query, onQuery]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Content
          // The search takes the focus, so typing filters at once.
          onOpenAutoFocus={e => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector<HTMLInputElement>('input[type="search"]')?.focus();
          }}
          className="fixed inset-0 flex flex-col gap-3 bg-nb-canvas px-4 pb-3 pt-4 focus:outline-none">
          <div className="flex items-center gap-2 pl-1">
            <Dialog.Title className="flex-1 text-2xl font-semibold tracking-tight">{t('history.heading')}</Dialog.Title>
            <Dialog.Close
              className="flex size-8 items-center justify-center rounded-lg text-nb-muted hover:bg-nb-surface hover:text-nb-fg"
              aria-label={t('common.close')}>
              <CloseIcon size={18} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{t('history.description')}</Dialog.Description>
          <input
            type="search"
            value={query}
            placeholder={t('history.search')}
            aria-label={t('history.search')}
            className="rounded-lg border border-nb-border bg-nb-bg px-2.5 py-1.5 text-sm placeholder:text-nb-muted focus:border-nb-accent focus:outline-none focus:ring-2 focus:ring-nb-accent/25"
            onChange={e => setQuery(e.target.value)}
          />
          <ul className="-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 pb-1">
            {items.length === 0 ? <li className="p-2 text-xs text-nb-muted">{t('history.empty')}</li> : null}
            {items.map(item => (
              <HistoryRow
                key={item.id}
                item={item}
                current={item.id === currentId}
                onOpen={() => onOpen(item.id)}
                onRename={title => onRename(item.id, title)}
                agentTabsOnEnd={agentTabsOnEnd}
                onDelete={(close, remember) => onDelete(item.id, close, remember)}
                onExport={() => onExport(item.id)}
              />
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A run's status beside the date, when it is one to notice: working in blue, needs you in amber, never red. */
function statusClass(status: ConversationSummary['status']): string {
  if (status === 'running') return 'text-nb-link';
  if (status === 'awaiting_user' || status === 'interrupted') return 'text-amber-700 dark:text-amber-300';
  return '';
}

/** The day a conversation last changed, in the UI language: "October 6, 2026", "2026年10月6日". */
function day(iso: string): string {
  return new Date(iso).toLocaleDateString(currentLanguage().replace('_', '-'), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

const STATUSES = new Set<ConversationSummary['status']>([
  'running',
  'awaiting_user',
  'interrupted',
  'failed',
  'capped',
]);

function HistoryRow({
  item,
  current,
  onOpen,
  onRename,
  onDelete,
  onExport,
  agentTabsOnEnd,
}: {
  item: ConversationSummary;
  current: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDelete: (closeAgentTabs: boolean, remember: boolean) => void;
  onExport: () => void;
  agentTabsOnEnd: 'ask' | 'close' | 'keep';
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [remember, setRemember] = useState(false);
  const [title, setTitle] = useState(item.title);
  const status = STATUSES.has(item.status) ? t(`status.${item.status}`) : null;

  if (editing) {
    return (
      <li className="p-1">
        <form
          className="flex gap-1"
          onSubmit={e => {
            e.preventDefault();
            onRename(title);
            setEditing(false);
          }}>
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={title}
            aria-label={t('history.rename')}
            className="min-w-0 flex-1 rounded-lg border border-nb-border bg-nb-bg px-2 py-1 text-sm focus:border-nb-accent focus:outline-none focus:ring-2 focus:ring-nb-accent/25"
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setEditing(false);
              }
            }}
          />
          <button type="submit" className="rounded-lg px-2 text-xs font-medium text-nb-link hover:bg-nb-surface">
            {t('common.save')}
          </button>
        </form>
      </li>
    );
  }

  return (
    <li
      className={`group flex items-center gap-1 rounded-xl border bg-nb-bg/80 pr-2 shadow-sm transition-colors hover:border-nb-accent/30 hover:bg-nb-bg ${current ? 'border-nb-accent/40' : 'border-nb-border/60'}`}>
      <button
        type="button"
        className="flex min-w-0 flex-1 flex-col gap-1 py-3 pl-4 text-left"
        title={new Date(item.updatedAt).toLocaleString()}
        aria-current={current || undefined}
        onClick={onOpen}>
        <span className="w-full truncate text-[15px] text-nb-fg">{item.title || t('history.untitled')}</span>
        <span className="text-[13px] text-nb-muted">
          {day(item.updatedAt)}
          {status ? <span className={statusClass(item.status)}> · {status}</span> : null}
        </span>
      </button>
      {confirming && item.agentTabs > 0 && agentTabsOnEnd === 'ask' ? (
        // Ending a conversation asks once whether to close the tabs the agent opened.
        <span className="flex flex-col gap-1 text-xs">
          <span>
            {item.agentTabs === 1 ? t('history.closeAgentTab') : t('history.closeAgentTabs', { count: item.agentTabs })}
          </span>
          <span className="flex gap-1">
            <button
              type="button"
              className="rounded px-1 text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950"
              onClick={() => onDelete(true, remember)}>
              {t('history.closeTabs')}
            </button>
            <button type="button" className="rounded px-1 hover:bg-nb-bg" onClick={() => onDelete(false, remember)}>
              {t('history.keepTabs')}
            </button>
          </span>
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
            {t('history.remember')}
          </label>
        </span>
      ) : confirming ? (
        <span className="flex gap-1 text-xs">
          <button
            type="button"
            className="rounded px-1 text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950"
            onClick={() => onDelete(agentTabsOnEnd === 'close', false)}>
            {t('history.confirmDelete')}
          </button>
          <button type="button" className="rounded px-1 hover:bg-nb-bg" onClick={() => setConfirming(false)}>
            {t('common.cancel')}
          </button>
        </span>
      ) : (
        <span className="flex gap-0.5 text-nb-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            className="rounded-md p-1 hover:bg-nb-surface hover:text-nb-fg"
            aria-label={t('history.rename')}
            title={t('history.rename')}
            onClick={() => {
              setTitle(item.title);
              setEditing(true);
            }}>
            <PencilIcon size={14} />
          </button>
          <button
            type="button"
            className="rounded-md p-1 hover:bg-nb-surface hover:text-nb-fg"
            aria-label={t('history.export')}
            title={t('history.export')}
            onClick={onExport}>
            <DownloadIcon size={14} />
          </button>
          <button
            type="button"
            className="rounded-md p-1 hover:bg-nb-surface hover:text-nb-fg"
            aria-label={t('history.delete')}
            title={t('history.delete')}
            onClick={() => setConfirming(true)}>
            <TrashIcon size={14} />
          </button>
        </span>
      )}
    </li>
  );
}
