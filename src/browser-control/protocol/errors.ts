// Error codes of the protocol. Every error says whether any input reached the page's handlers.

export const ERROR_CODES = [
  'REF_UNKNOWN',
  'REF_NOT_PRESENTED',
  'REF_TAB_MISMATCH',
  'STALE_DOCUMENT',
  'NODE_DETACHED',
  'TARGET_CHANGED',
  'AMBIGUOUS_TARGET',
  'NO_MATCH',
  'NOT_VISIBLE',
  'NOT_STABLE',
  'DISABLED',
  'NOT_EDITABLE',
  'OBSCURED',
  'INTERCEPTED',
  'NOT_INTERACTABLE',
  'NO_SUCH_OPTION',
  'AMBIGUOUS_OPTION',
  'STATE_UNCHANGED',
  'MODAL_PENDING',
  'USER_DECLINED',
  'USER_STEP',
  'CONFIRMATION_TIMEOUT',
  'NEEDS_USER',
  'FRAME_DETACHED',
  'DEBUGGER_DETACHED',
  'URL_NOT_ALLOWED',
  'NAVIGATION_FAILED',
  'TAB_NOT_IN_SESSION',
  'PAGE_NOT_SUPPORTED',
  'CAPABILITY_DISABLED',
  'CAPTURE_FAILED',
  'INVALID_ARGUMENT',
  'TIMEOUT',
  'CANCELLED',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Hints for the agent. They say what to do next, never to retry blindly after a delivered action. */
export const DEFAULT_HINTS: Record<ErrorCode, string> = {
  REF_UNKNOWN: 'This ref is not known (it may be from before a restart). Take a new snapshot and choose again.',
  REF_NOT_PRESENTED: 'This ref was not in the latest observation of its tab. Take a new snapshot and choose again.',
  REF_TAB_MISMATCH: 'The ref belongs to a different tab than the tabId given. Omit tabId or use the ref’s tab.',
  STALE_DOCUMENT: 'The page has loaded a new document since this ref was shown. Take a new snapshot.',
  NODE_DETACHED: 'The element is no longer in the page. Take a new snapshot and choose again.',
  TARGET_CHANGED: 'The element is no longer what was shown. Take a new snapshot and choose again.',
  AMBIGUOUS_TARGET: 'More than one element matches. Use a ref, or add name, nth or within.',
  NO_MATCH: 'No element matches. Take a snapshot to see what the page contains.',
  NOT_VISIBLE: 'The element is not visible. Scroll, open its container, or choose another element.',
  NOT_STABLE: 'The element kept moving. Wait for the page to settle and try again.',
  DISABLED: 'The element is disabled. Complete what enables it first.',
  NOT_EDITABLE: 'The element does not accept text.',
  OBSCURED: 'Another element covers the target. Dismiss or interact with the covering element first.',
  INTERCEPTED:
    'The page changed at the moment of the click and the click was cancelled before it reached the page. Take a new snapshot; retrying is safe.',
  NOT_INTERACTABLE: 'The element cannot be interacted with this way.',
  NO_SUCH_OPTION: 'None of the options matches. Choose one of the options listed.',
  AMBIGUOUS_OPTION: 'More than one option matches. Use the exact value or label.',
  STATE_UNCHANGED: 'The control did not take the requested state.',
  MODAL_PENDING: 'A dialog or prompt is open on this tab. Resolve it first (handle_dialog, or wait for the user).',
  USER_DECLINED: 'The user declined. Do not repeat this action without new instructions from the user.',
  USER_STEP:
    'This step is the user’s: a payment, an access grant, a secret or a page’s prompt dialog. Nothing was dispatched for it. Prepare everything around it, let the user do it, and do not try to do it another way.',
  CONFIRMATION_TIMEOUT:
    'The user did not answer in time. Do not repeat this action without new instructions from the user.',
  NEEDS_USER: 'This action needs the user’s confirmation, and no one can be asked here.',
  FRAME_DETACHED: 'The frame that held this element is gone. Take a new snapshot.',
  DEBUGGER_DETACHED: 'The browser connection to this tab was closed. Take a new snapshot to reconnect.',
  URL_NOT_ALLOWED: 'This address is not allowed by the navigation policy.',
  NAVIGATION_FAILED:
    'The page could not be loaded (the address does not resolve, the connection failed, or the load was aborted). Check the address, or take a snapshot to see where the tab is.',
  TAB_NOT_IN_SESSION: 'This tab is not part of the session. Use tabs list to see the session’s tabs.',
  PAGE_NOT_SUPPORTED: 'This page cannot be controlled (browser pages, the extension store and similar).',
  CAPABILITY_DISABLED: 'This capability is turned off for the session. Only the user can turn it on.',
  CAPTURE_FAILED: 'The page could not be observed. Try again after it has loaded.',
  INVALID_ARGUMENT: 'The arguments do not match the tool’s schema.',
  TIMEOUT: 'The operation did not finish in time.',
  CANCELLED: 'The call was cancelled before anything was dispatched.',
  INTERNAL: 'An internal error occurred.',
};

/**
 * Hints for codes whose default hint assumes nothing reached the page, used when something did (a key sequence
 * stopped part way): the agent must look before acting again.
 */
export const DELIVERED_HINTS: Partial<Record<ErrorCode, string>> = {
  INTERCEPTED:
    'Part of the input reached the page before the rest was stopped. Take a new snapshot to see what it did before acting again; repeating the action could repeat its effect.',
};

/** The hint for a code, given whether any input reached the page. */
export function hintFor(code: ErrorCode, delivered: boolean | 'unknown'): string {
  return (delivered !== false ? DELIVERED_HINTS[code] : undefined) ?? DEFAULT_HINTS[code];
}

export interface ProtocolError {
  code: ErrorCode;
  message: string;
  /** Whether any input reached the page's handlers. False means a retry cannot cause a double effect. */
  delivered: boolean | 'unknown';
  hint: string;
  /** Structured facts some codes carry: USER_STEP names its reason and target. */
  details?: unknown;
}

/** Thrown inside the layer and turned into a result at the controller boundary. */
export class LayerError extends Error {
  readonly code: ErrorCode;
  readonly delivered: boolean | 'unknown';
  readonly hint: string;
  readonly details?: unknown;
  /** What was done before the error, returned with it (fill_form's receipts of the fields already set). */
  readonly partial?: { data?: unknown; lines?: string[] };

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      delivered?: boolean | 'unknown';
      hint?: string;
      details?: unknown;
      partial?: { data?: unknown; lines?: string[] };
    } = {},
  ) {
    super(message);
    this.name = 'LayerError';
    this.code = code;
    this.delivered = options.delivered ?? false;
    this.hint = options.hint ?? hintFor(code, this.delivered);
    this.details = options.details;
    this.partial = options.partial;
  }

  toProtocol(): ProtocolError {
    return {
      code: this.code,
      message: this.message,
      delivered: this.delivered,
      hint: this.hint,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

export function isLayerError(error: unknown): error is LayerError {
  return error instanceof LayerError;
}
