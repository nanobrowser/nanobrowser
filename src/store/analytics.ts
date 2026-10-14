// Where analytics keeps its state in chrome.storage.local. Only the worker's analytics module writes these keys.

/** The install week, the day of the last ping and the day a task last started. */
export const ANALYTICS_KEY = 'nb.analytics';
/** Today's and past days' usage counts, by UTC day. */
export const ANALYTICS_COUNTS_KEY = 'nb.analytics.counts';
/** Events waiting to be sent, with their failed tries. */
export const ANALYTICS_QUEUE_KEY = 'nb.analytics.queue';

export const ANALYTICS_KEYS = [ANALYTICS_KEY, ANALYTICS_COUNTS_KEY, ANALYTICS_QUEUE_KEY];

export interface AnalyticsState {
  /** ISO week of install (`2026-W41`), `v0.2` after an update from the old Nanobrowser, or `unknown`. */
  installWeek: string;
  /** Set on a real install, until the first ping. */
  newInstall?: boolean;
  /** The UTC day (`2026-10-13`) of the last ping. */
  lastPing?: string;
  /** The UTC day a task last started. */
  ranTaskOn?: string;
}

/** One event as it goes to the capture endpoint, without the project key. */
export interface SentEvent {
  event: string;
  distinct_id: string;
  timestamp: string;
  properties: Record<string, unknown>;
}

export interface QueuedEvent {
  body: SentEvent;
  tries: number;
}
