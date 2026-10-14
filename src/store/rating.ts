// When the side panel asks the user to rate Nanobrowser in the browser's web store: right after a run finishes well,
// in the panel that showed it, once there have been at least 10 such runs on at least 3 different days of the last 7.
// Maybe later asks again 30 days later, once; Leave a rating, or a second Maybe later, ends it. The state stays on this
// device and nothing in it is sent.
import { createStorage } from './storage';

/** Written only by the worker, when a run ends. */
export interface RatingUsage {
  /** Runs that finished well, counted since this version. */
  runs: number;
  /** The local dates (`YYYY-MM-DD`) in the last 7 days on which a run finished well. */
  days: string[];
  /** The last run that finished well: its conversation, and when it ended. */
  last?: { conversationId: string; at: number };
}

/** Written only by the panel, when the user answers the card. Two keys, so neither write can undo the other. */
export interface RatingAnswer {
  /** How many times the user chose Maybe later. */
  later: number;
  /** After a Maybe later: no new ask before this local date. */
  notBefore?: string;
  /** Rated, or asked twice: never asked again. */
  done: boolean;
  /** When the user last answered: only a run that finished after it can show the card again. */
  at?: number;
}

export const RATING_KEY = 'nb.rating';
export const RATING_ANSWER_KEY = 'nb.rating.answer';

export const NO_USAGE: RatingUsage = { runs: 0, days: [] };
export const NO_ANSWER: RatingAnswer = { later: 0, done: false };

export const ratingStorage = createStorage<RatingUsage>(RATING_KEY, NO_USAGE, { liveUpdate: true });
export const ratingAnswerStorage = createStorage<RatingAnswer>(RATING_ANSWER_KEY, NO_ANSWER, { liveUpdate: true });

const MIN_RUNS = 10;
const MIN_DAYS = 3;
const WINDOW_DAYS = 7;
const LATER_DAYS = 30;
const MAX_LATER = 2;

/** The date in the user's own time zone, as `YYYY-MM-DD`. */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d + n));
}

/** The days of the last 7, today included, among `days`. */
function recent(days: string[], now: Date): string[] {
  const today = localDay(now);
  const since = addDays(today, -(WINDOW_DAYS - 1));
  return days.filter(d => d >= since && d <= today);
}

/** A run of `conversationId` finished well: it is counted, with today among the days. */
export function afterFinishedRun(usage: RatingUsage, now: Date, conversationId: string): RatingUsage {
  const days = recent([...new Set([...usage.days, localDay(now)])], now).sort();
  return { runs: usage.runs + 1, days, last: { conversationId, at: now.getTime() } };
}

/** Whether the card shows now: the user uses the extension often, and has not answered it for good or lately. */
export function ratingDue(usage: RatingUsage, answer: RatingAnswer, now: Date): boolean {
  if (answer.done || usage.runs < MIN_RUNS || recent(usage.days, now).length < MIN_DAYS) return false;
  return !answer.notBefore || localDay(now) >= answer.notBefore;
}

/**
 * Whether a panel showing `conversationId` shows the card: that conversation's last run finished well after `since`,
 * and the card is due. `since` is the later of when the panel began showing the conversation and when its latest run
 * began, so a panel that switched to the conversation afterwards, or a later run that did not finish well, shows none.
 */
export function ratingShowsIn(
  usage: RatingUsage,
  answer: RatingAnswer,
  conversationId: string | null,
  since: number,
  now: Date,
): boolean {
  const last = usage.last;
  return (
    !!last &&
    last.conversationId === conversationId &&
    last.at >= since &&
    last.at > (answer.at ?? 0) &&
    ratingDue(usage, answer, now)
  );
}

/** The user's answer on the card. */
export function answerRating(answer: RatingAnswer, choice: 'rate' | 'later', now: Date): RatingAnswer {
  if (choice === 'rate') return { ...answer, done: true, at: now.getTime() };
  const later = answer.later + 1;
  return { later, done: later >= MAX_LATER, notBefore: addDays(localDay(now), LATER_DAYS), at: now.getTime() };
}

const CHROME_STORE =
  'https://chromewebstore.google.com/detail/nanobrowser-ai-web-agent/imbddededgmcgfhfpcjmijokokekbkal/reviews';
const EDGE_STORE =
  'https://microsoftedge.microsoft.com/addons/detail/nanobrowser-ai-web-agent/ajdioenfpgabnjlclgckbbnjjhdnjkhn';

/** The store page to rate on: Edge's add-ons store in Edge, the Chrome Web Store anywhere else. */
export function ratingUrl(userAgent: string): string {
  return userAgent.includes('Edg/') ? EDGE_STORE : CHROME_STORE;
}
