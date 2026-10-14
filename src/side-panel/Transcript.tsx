// The transcript: the user's messages, answers as sanitised Markdown, notices. The replies of one run share one
// activity block. Under a user's message, on hover: its time, Copy, Edit and Restart from here. Under an answer,
// always: Copy and its time. Retry after an error. A new turn keeps the question in view; auto-scroll resumes only at
// the bottom, with a jump-to-latest arrow otherwise.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AttachmentRef, DisplayEntry, ToolRow } from '@src/ui/protocol';
import { runRows } from '@src/ui/protocol';
import { AttachmentChips } from './Composer';
import { t, useLanguage } from '@src/ui/i18n';
import type { MessageKey } from '@src/ui/i18n';
import en from '@src/ui/locales/en.json';
import { Markdown } from './Markdown';
import { Activity, phaseOf } from './Activity';
import { messageTime, messageTimeFull } from './message-time';
import { ArrowDownIcon, CheckIcon, CopyIcon, FileIcon, PencilIcon, RestartIcon } from '@src/ui/icons';
import { useGrantedPermissions } from '@src/ui/optional-permissions';

export interface MessageActions {
  /** False while a run works: Edit, Restart and Retry wait for it. */
  idle: boolean;
  edit(entryId: string, text: string): void;
  /** Runs the conversation again from a user's message, as a new branch. */
  restart(entryId: string): void;
  retry(): void;
}

type AssistantEntry = Extract<DisplayEntry, { kind: 'assistant' }>;
type Opened = { messageId: string };
type RunItem = { kind: 'run'; id: string; replies: AssistantEntry[]; opened?: Opened; start: number };
type Item = Exclude<DisplayEntry, AssistantEntry> | RunItem;

/** When the run that wrote a reply began; a reply stored without it, from when its model call began. */
function runStart(e: AssistantEntry): number {
  return e.runStartedAt ? Date.parse(e.runStartedAt) : Date.parse(e.at) - (e.durationMs ?? 0);
}

/**
 * Consecutive replies form one run: one activity block, then the answers. The page the loop read when the run began,
 * attached to the user's message before it, is the run's first step. A run's time starts when it began, or at the
 * message or reply above it when that came later (a message sent while it worked, a file saved between replies).
 * `floor` is the time of the last message or reply, where the next run's time starts at the latest.
 */
function group(entries: DisplayEntry[]): { items: Item[]; floor: number } {
  const items: Item[] = [];
  let opened: Opened | undefined;
  let floor = 0;
  for (const e of entries) {
    const last = items.at(-1);
    if (e.kind === 'assistant') {
      if (last?.kind === 'run') last.replies.push(e);
      else {
        items.push({
          kind: 'run',
          id: e.id,
          replies: [e],
          start: Math.max(floor, runStart(e)),
          ...(opened ? { opened } : {}),
        });
        opened = undefined;
      }
    } else {
      if (e.kind === 'user') opened = e.opened ? { messageId: e.id } : undefined;
      items.push(e);
    }
    if (e.kind === 'assistant' || e.kind === 'user') floor = Math.max(floor, Date.parse(e.at) || 0);
  }
  return { items, floor };
}

export function Transcript({
  entries,
  streaming,
  live,
  footer,
  actions,
}: {
  entries: DisplayEntry[];
  streaming: { id: string; text: string } | null;
  /** Set while the run works: when it began, and whether it waits for the user's answer. */
  live?: { startedAt?: string; waiting: boolean };
  footer?: ReactNode;
  actions?: MessageActions;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const lastUser = [...entries].reverse().find(e => e.kind === 'user')?.id;

  // A new question scrolls to the bottom, so it is in view while the answer streams.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastUser]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom) el.scrollTop = el.scrollHeight;
  });

  const now = useMinute();
  const { items, floor } = group(entries);
  const lastItem = items.at(-1);
  const pending = streaming && !entries.some(e => e.id === streaming.id) ? streaming : null;
  // The working run's block is the last one; before its first reply, its status line stands alone.
  const working = !!live || !!pending;
  const liveRun = working && lastItem?.kind === 'run' ? lastItem : undefined;
  // Every block after the last user message belongs to the working run, also one a saved file split off: none of them
  // shows its answer's line until the run stops.
  const settledBefore = working ? items.findLastIndex(i => i.kind === 'user') + 1 : items.length;
  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        className="h-full overflow-y-auto p-4"
        onScroll={e => {
          const el = e.currentTarget;
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
        }}>
        <ol className="flex flex-col gap-6" aria-label={t('panel.transcript')} data-role="transcript">
          {items.map((item, i) => (
            <li key={item.id}>
              <ItemView
                item={item}
                now={now}
                streaming={streaming}
                live={item === liveRun ? { waiting: !!live?.waiting } : undefined}
                settled={i < settledBefore}
                actions={actions}
                retry={item === lastItem && item.kind === 'notice' && item.tone === 'error'}
              />
            </li>
          ))}
          {working && !liveRun ? (
            <li className="text-sm">
              <Activity
                rows={[]}
                phase={live?.waiting ? 'waiting' : 'thinking'}
                start={Math.max(floor, live?.startedAt ? Date.parse(live.startedAt) : 0) || Date.now()}
              />
            </li>
          ) : null}
          {pending?.text ? (
            <li>
              <div className="nb-answer">
                <Markdown text={pending.text} />
              </div>
            </li>
          ) : null}
        </ol>
        {footer}
      </div>
      {!atBottom ? (
        <button
          type="button"
          aria-label={t('panel.jumpToLatest')}
          title={t('panel.jumpToLatest')}
          className="absolute bottom-3 left-1/2 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-nb-border bg-nb-bg text-nb-muted shadow-pop transition-colors hover:bg-nb-surface hover:text-nb-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-nb-accent"
          onClick={() => {
            const el = scroller.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}>
          <ArrowDownIcon size={16} />
        </button>
      ) : null}
    </div>
  );
}

const action =
  'rounded-md px-1.5 py-0.5 text-[11px] text-nb-muted transition-colors hover:bg-nb-surface hover:text-nb-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-nb-accent';
const iconAction =
  'flex size-6 items-center justify-center rounded-md text-nb-muted transition-colors hover:bg-nb-surface hover:text-nb-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-nb-accent';

/** The current time, every 30 seconds, for the times under the messages. */
function useMinute(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** A message's time: short under it, in full as the tooltip. */
function Time({ at, now }: { at: string; now: number }) {
  const language = useLanguage();
  const ms = Date.parse(at);
  if (!ms) return null;
  return (
    <time dateTime={at} title={messageTimeFull(ms, language)} className="px-1 text-xs text-nb-muted">
      {messageTime(ms, now, language)}
    </time>
  );
}

/** Copy as an icon, with a check for a moment once copied. */
function CopyButton({ text }: { text: string }) {
  // When it last copied, so a second copy shows the check for its own 1.5 s.
  const [copiedAt, setCopiedAt] = useState(0);
  const copied = copiedAt > 0;
  useEffect(() => {
    if (!copiedAt) return;
    const timer = setTimeout(() => setCopiedAt(0), 1500);
    return () => clearTimeout(timer);
  }, [copiedAt]);
  const label = copied ? t('msg.copied') : t('msg.copy');
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={iconAction}
      onClick={() =>
        void navigator.clipboard
          ?.writeText(text)
          .then(() => setCopiedAt(Date.now()))
          .catch(() => undefined)
      }>
      {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
    </button>
  );
}

function ItemView({
  item,
  now,
  streaming,
  live,
  settled,
  actions,
  retry,
}: {
  item: Item;
  now: number;
  streaming: { id: string; text: string } | null;
  live?: { waiting: boolean };
  /** The run this block belongs to has stopped. */
  settled: boolean;
  actions?: MessageActions;
  retry: boolean;
}) {
  if (item.kind === 'user')
    return (
      <UserMessage
        id={item.id}
        text={item.text}
        attachments={item.attachments}
        quotes={item.quotes}
        at={item.at}
        now={now}
        actions={actions}
      />
    );
  if (item.kind === 'notice') {
    const tone =
      item.tone === 'error'
        ? 'text-red-700 dark:text-red-300'
        : item.tone === 'warn'
          ? 'text-amber-700 dark:text-amber-300'
          : 'text-nb-muted';
    return (
      <p className={`text-xs ${tone}`}>
        {noticeText(item.text)}
        {retry && actions?.idle ? (
          <button type="button" className={`${action} ml-2 underline`} onClick={() => actions.retry()}>
            {t('msg.retry')}
          </button>
        ) : null}
      </p>
    );
  }
  if (item.kind === 'download') return <SavedFile name={item.name} downloadId={item.downloadId} bytes={item.bytes} />;
  return <RunView item={item} now={now} streaming={streaming} live={live} settled={settled} />;
}

/**
 * A notice is stored in English, as the worker wrote it; one that has a `notice.*` string in the catalogue is shown in
 * the panel's language.
 */
function noticeText(text: string): string {
  const key = NOTICE_KEYS.find(k => en[k] === text);
  return key ? t(key) : text;
}

const NOTICE_KEYS = (Object.keys(en) as MessageKey[]).filter(k => k.startsWith('notice.'));

/**
 * A file the agent saved: its name, Open and Show in folder. The two buttons need Chrome's downloads permissions; while
 * either is not allowed they are not shown, and they never ask for it.
 */
function SavedFile({ name, downloadId, bytes }: { name: string; downloadId: number; bytes: number }) {
  const granted = useGrantedPermissions();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-nb-border bg-nb-bg px-2.5 py-1.5 text-xs shadow-sm">
      <FileIcon size={14} className="text-nb-link" />
      <span>{t('download.saved', { name })}</span>
      <span className="text-nb-muted">{bytes.toLocaleString()} B</span>
      {granted?.['downloads.open'] && granted.downloads ? (
        <>
          <button type="button" className={action} onClick={() => void chrome.downloads.open(downloadId)}>
            {t('download.open')}
          </button>
          <button type="button" className={action} onClick={() => chrome.downloads.show(downloadId)}>
            {t('download.show')}
          </button>
        </>
      ) : null}
    </div>
  );
}

function UserMessage({
  id,
  text,
  attachments,
  quotes,
  at,
  now,
  actions,
}: {
  id: string;
  text: string;
  attachments?: AttachmentRef[];
  quotes?: Array<{ text: string; url: string; title: string }>;
  at: string;
  now: number;
  actions?: MessageActions;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  if (editing) {
    return (
      <form
        className="ml-8 flex flex-col gap-1"
        onSubmit={e => {
          e.preventDefault();
          setEditing(false);
          if (value.trim() && value !== text) actions?.edit(id, value);
        }}>
        <textarea
          aria-label={t('msg.edit')}
          value={value}
          onChange={e => setValue(e.target.value)}
          rows={3}
          className="rounded-2xl border border-nb-border bg-nb-bg px-3.5 py-2 text-[15px] focus:border-nb-accent focus:outline-none focus:ring-2 focus:ring-nb-accent/25"
        />
        <div className="flex justify-end gap-1">
          <button type="button" className={action} onClick={() => setEditing(false)}>
            {t('common.cancel')}
          </button>
          <button type="submit" className={`${action} font-medium`}>
            {t('composer.send')}
          </button>
        </div>
      </form>
    );
  }
  return (
    <div className="group relative ml-8 flex flex-col items-end">
      <div
        className="flex max-w-full flex-col gap-1 whitespace-pre-wrap break-words rounded-2xl bg-nb-surface px-3.5 py-2 text-[15px] leading-normal"
        data-role="user">
        {(quotes ?? []).map((q, i) => (
          <blockquote key={i} className="border-l-2 border-nb-sky pl-2 text-xs">
            <span className="line-clamp-3 italic">“{q.text}”</span>
            <span className="block truncate text-nb-muted">{q.title || q.url}</span>
          </blockquote>
        ))}
        {text}
        <AttachmentChips files={(attachments ?? []).map(ref => ({ ref }))} />
      </div>
      {/* Over the gap below the message, shown on hover or while a button in it has focus; the buttons stay in place
          for the keyboard. */}
      <div className="absolute right-0 top-full z-10 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <Time at={at} now={now} />
        <CopyButton text={text} />
        {actions?.idle ? (
          <>
            <button
              type="button"
              aria-label={t('msg.edit')}
              title={t('msg.edit')}
              className={iconAction}
              onClick={() => {
                setValue(text);
                setEditing(true);
              }}>
              <PencilIcon size={14} />
            </button>
            <button
              type="button"
              aria-label={t('msg.restart')}
              title={t('msg.restart')}
              className={iconAction}
              onClick={() => actions.restart(id)}>
              <RestartIcon size={14} />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function RunView({
  item,
  now,
  streaming,
  live,
  settled,
}: {
  item: RunItem;
  now: number;
  streaming: { id: string; text: string } | null;
  live?: { waiting: boolean };
  settled: boolean;
}) {
  const { replies, opened, start } = item;
  const rows: ToolRow[] = runRows(
    replies.flatMap(r => r.tools),
    opened,
  );
  const last = replies.at(-1)!;
  const answer = replies
    .map(r => r.text)
    .filter(Boolean)
    .join('\n\n');
  return (
    <div className="flex flex-col gap-2 text-sm" data-role="assistant">
      <Activity
        rows={rows}
        phase={live ? phaseOf(rows, live.waiting) : undefined}
        start={start}
        end={Date.parse(last.at)}
      />
      {replies.map(r =>
        streaming?.id === r.id ? (
          streaming.text ? (
            <div key={r.id} className="nb-answer">
              <Markdown text={streaming.text} />
            </div>
          ) : null
        ) : r.text ? (
          <div key={r.id} className="nb-answer">
            <Markdown text={r.text} />
          </div>
        ) : null,
      )}
      {/* Model, tokens and cost stay in the conversation's record and are not shown for now. */}
      {settled && streaming?.id !== last.id ? (
        <div className="-ml-1 flex items-center gap-0.5">
          {answer ? <CopyButton text={answer} /> : null}
          <Time at={last.at} now={now} />
        </div>
      ) : null}
    </div>
  );
}
