// The activity block: a status line for the run, "Thinking…", "Working…" or "Waiting for you…" with the time so far
// while it works, then "Worked for 12s", which opens one row per tool call in plain language, with its status, the
// effect when the page did not react, how a write was allowed, and on expanding, the arguments (typed values masked),
// the receipt and the error hint. Page strings are text nodes only.
import { useEffect, useState } from 'react';
import type { ToolRow } from '@src/ui/protocol';
import { t } from '@src/ui/i18n';
import type { MessageKey } from '@src/ui/i18n';
import { activityLine, maskArgs } from './activity-label';
import { ChevronIcon, SpinnerIcon } from '@src/ui/icons';

/** What a working run is doing: waiting for the model, running a tool, or waiting for the user's answer. */
export type Phase = 'thinking' | 'working' | 'waiting';

const PHASES: Record<Phase, MessageKey> = {
  thinking: 'panel.thinking',
  working: 'activity.working',
  waiting: 'activity.waiting',
};

const ICONS: Record<ToolRow['status'], string> = { running: '…', done: '✓', failed: '✗', skipped: '–', waiting: '!' };
const TONES: Record<ToolRow['status'], string> = {
  running: 'text-nb-link',
  done: 'text-emerald-600 dark:text-emerald-400',
  failed: 'text-red-600 dark:text-red-400',
  skipped: 'text-nb-muted',
  waiting: 'text-amber-600 dark:text-amber-400',
};
const STATUS: Partial<Record<ToolRow['status'], Parameters<typeof t>[0]>> = {
  running: 'act.running',
  waiting: 'act.waiting',
  skipped: 'act.skipped',
  failed: 'act.failed',
};

/** The phase of a working run from its rows: a card waiting for the user, then a tool running, else the model. */
export function phaseOf(rows: ToolRow[], waiting: boolean): Phase {
  if (waiting || rows.some(r => r.status === 'waiting')) return 'waiting';
  return rows.some(r => r.status === 'running') ? 'working' : 'thinking';
}

/** "4s", "2m 5s", "1h 3m". */
export function elapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return t('activity.hours', { h, m });
  if (m) return t('activity.minutes', { m, s });
  return t('activity.seconds', { s });
}

/** The current time, every second while `live`. */
function useNow(live: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  return now;
}

/**
 * `phase` is set while the run works and `start` is when it began, in ms; `end`, when its last reply came, gives
 * "Worked for" once it has stopped.
 */
export function Activity({ rows, phase, start, end }: { rows: ToolRow[]; phase?: Phase; start: number; end?: number }) {
  const [open, setOpen] = useState(false);
  const now = useNow(!!phase);
  const time = elapsed((phase ? now : (end ?? start)) - start);
  const status = phase ? (
    <>
      <SpinnerIcon size={14} className="text-nb-link motion-safe:animate-spin" />
      <span>{t(PHASES[phase])}</span>
      <span className="tabular-nums opacity-60">{time}</span>
    </>
  ) : (
    <span>{t('activity.worked', { time })}</span>
  );
  return (
    <div className="flex flex-col gap-1" data-role="activity">
      {rows.length ? (
        <button
          type="button"
          aria-expanded={open}
          className="flex items-center gap-1.5 self-start rounded-md py-0.5 pr-1 text-left text-nb-muted transition-colors hover:text-nb-fg"
          onClick={() => setOpen(o => !o)}>
          {status}
          <ChevronIcon size={14} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>
      ) : (
        <div className="flex items-center gap-1.5 py-0.5 text-nb-muted">{status}</div>
      )}
      {open && rows.length ? (
        <ul className="flex flex-col gap-0.5 rounded-xl border border-nb-border bg-nb-bg px-2.5 py-1.5 text-xs shadow-sm">
          {rows.map(row => (
            <Row key={row.toolCallId} row={row} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Row({ row }: { row: ToolRow }) {
  const [open, setOpen] = useState(false);
  const line = activityLine(row);
  const status = STATUS[row.status];
  const result = row.result as { receipt?: unknown; error?: { hint?: string } } | undefined;
  return (
    <li className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        className="flex items-start gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-nb-surface"
        onClick={() => setOpen(o => !o)}>
        <span aria-hidden className={`w-3 shrink-0 text-center font-semibold ${TONES[row.status]}`}>
          {ICONS[row.status]}
        </span>
        <span className="min-w-0 flex-1 break-words">
          {line.label}
          {[...(status ? [t(status)] : []), ...line.tags].map(tag => (
            <span key={tag} className="ml-1 rounded-full bg-nb-surface px-1.5 text-[10px] text-nb-muted">
              {tag}
            </span>
          ))}
        </span>
      </button>
      {row.thumbnail ? (
        <img
          src={row.thumbnail}
          alt={t('act.thumbnail')}
          className="ml-5 mt-0.5 h-16 w-auto self-start rounded-md border border-nb-border"
        />
      ) : null}
      {line.details.map(d => (
        <span key={d} className="ml-5 text-[11px] text-nb-muted">
          {d}
        </span>
      ))}
      {open ? (
        <div className="ml-5 flex flex-col gap-1 py-1">
          {row.args !== undefined ? <Detail title={t('act.arguments')} value={maskArgs(row.args)} /> : null}
          {result?.receipt ? <Detail title={t('act.result')} value={result.receipt} /> : null}
          {result?.error?.hint ? <Detail title={t('act.hint')} value={result.error.hint} /> : null}
        </div>
      ) : null}
    </li>
  );
}

function Detail({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <span className="text-nb-muted">{title}</span>
      <pre className="whitespace-pre-wrap break-words rounded-md bg-nb-surface p-1.5 font-mono text-[11px]">
        {typeof value === 'string' ? value : JSON.stringify(value, null, 1)}
      </pre>
    </div>
  );
}
