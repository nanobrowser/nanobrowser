// Result shapes of the protocol. Every result is plain JSON and carries a `text` rendering for a model.
import type { ProtocolError } from './errors';

export type ModalKind = 'dialog' | 'file-chooser' | 'confirmation' | 'user-request';

export interface PendingModal {
  kind: ModalKind;
  detail: string;
}

export interface PageState {
  tabId: number;
  url: string;
  title: string;
  rev: number;
  changed: 'none' | 'diff' | 'full';
  snapshot?: string;
  /** With changed "diff": the edit script against revision `since` (runs of kept lines as counts). */
  diff?: { since: number; ops: Array<number | { add: string } | { remove: string }> };
}

export type Mechanism = 'pointer' | 'keyboard' | 'insert-text' | 'set-value' | 'select-option' | 'file-input';
export type SensitiveCategory = 'submit' | 'pay' | 'delete' | 'grant' | 'upload' | 'script';

export interface ActionReceipt {
  action: string;
  /** For example 'button "Delete" in row "INV-1042 Acme Corp"'. */
  target?: string;
  mechanism: Mechanism;
  dispatched: boolean | 'unknown';
  /** False when the dispatch-time guard saw no event in the target's frame. */
  reachedTarget?: boolean;
  effect: { verdict: 'changed' | 'unattributable' | 'none'; signals: string[] };
  postcondition?: { status: 'met' | 'unmet' | 'not_checked'; detail?: string };
  navigation?: { url: string; kind: 'new-document' | 'same-document' };
  newTab?: { tabId: number; url: string };
  sensitive?: SensitiveCategory;
  confirmedByUser?: boolean;
  /** How a write was allowed under a host write policy: by the user on a card, by the site's rule, or by Auto mode. */
  allowedBy?: 'user' | 'site-rule' | 'auto';
  /**
   * Downloads the page began during the action (`Page.downloadWillBegin`): reported, not held.
   * `name` is the suggested file name, `url` where it comes from.
   */
  downloads?: Array<{ name: string; url: string }>;
}

/**
 * The `details` of a `USER_STEP` error: what the user has to do, on which site.
 * `hasBrowserHandler` says, for a page's prompt dialog, whether Chrome can show the dialog to the user.
 */
export interface UserStepDetails {
  reason: 'pay' | 'grant' | 'secret' | 'prompt';
  target: string;
  site: string;
  hasBrowserHandler?: boolean;
}

export interface Result<T = unknown> {
  ok: boolean;
  error?: ProtocolError;
  receipt?: ActionReceipt;
  page?: PageState;
  /**
   * The page state that was asked for could not be read after the action. The action's receipt still stands: it
   * says what was dispatched.
   */
  pageError?: ProtocolError;
  pending?: PendingModal[];
  data?: T;
  /** Rendering of all the above for a model. Page-derived text sits inside an untrusted-content boundary. */
  text: string;
}

/** `data` of a snapshot result. */
export interface SnapshotData {
  status: 'complete' | 'partial';
  /** For observe "diff": the edit script against revision `since`, and the refs it added and removed. */
  diff?: {
    since: number;
    ops: Array<number | { add: string } | { remove: string }>;
    added: string[];
    removed: string[];
  };
  refs: number;
  frames: { captured: number; skipped: number; failed: number };
  notices: string[];
  captureMs: number;
}

export interface FindMatch {
  ref: string;
  line: string;
  tabId: number;
}

export interface ScreenshotData {
  mimeType: 'image/png';
  /** Base64 without the data: prefix. */
  base64: string;
  width: number;
  height: number;
  /** Device pixels per CSS pixel in the image; coordinate targets use CSS pixels. */
  scale: number;
  /** Top-left of the image in page CSS pixels, for full-page and element shots. */
  origin: { x: number; y: number };
}

export interface TabInfo {
  tabId: number;
  url: string;
  title: string;
  active: boolean;
}

export interface TabsData {
  tabs: TabInfo[];
  activeTabId: number | null;
}
