// Raw CDP commands through chrome.debugger, sent to the session of a frame that Puppeteer reports.
// Elements are never reached through Puppeteer; every element command goes through here.
import { LayerError } from '../protocol/errors';

/** The pseudo session ID ExtensionTransport gives the page target. chrome.debugger addresses it with no sessionId. */
export const PAGE_SESSION_ALIAS = 'pageTargetSessionId';

/** Session ID as the layer uses it: undefined for the tab's root session. */
export function normalizeSessionId(sessionId: string | undefined): string | undefined {
  return sessionId === PAGE_SESSION_ALIAS ? undefined : sessionId;
}

/** @deprecated name kept for the step 0.2 spike; use normalizeSessionId. */
export const toDebuggerSessionId = normalizeSessionId;

export class CdpCommandError extends Error {
  constructor(
    readonly method: string,
    message: string,
  ) {
    super(`${method}: ${message}`);
    this.name = 'CdpCommandError';
  }
}

/** A command that did not answer in time. It cannot be cancelled, so its outcome is unknown. */
export class CdpTimeoutError extends Error {
  constructor(
    readonly method: string,
    readonly timeoutMs: number,
  ) {
    super(`${method}: no answer within ${timeoutMs} ms`);
    this.name = 'CdpTimeoutError';
  }
}

/** Timeouts: 10 s for captures, 5 s otherwise. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;
export const CAPTURE_TIMEOUT_MS = 10_000;

/** Sends one command. `cancel`, when it settles first, rejects the command (used for detach). */
export async function sendRaw<T = unknown>(
  tabId: number,
  sessionId: string | undefined,
  method: string,
  params: object = {},
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
  cancel?: Promise<never>,
): Promise<T> {
  const target: chrome.debugger.DebuggerSession = { tabId };
  const debuggerSessionId = normalizeSessionId(sessionId);
  if (debuggerSessionId) target.sessionId = debuggerSessionId;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CdpTimeoutError(method, timeoutMs)), timeoutMs);
  });
  try {
    const command = chrome.debugger
      .sendCommand(target, method, params as Record<string, unknown>)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (/not attached|Detached while handling command|No tab with given id/i.test(message)) {
          throw new LayerError('DEBUGGER_DETACHED', `${method}: ${message}`, { delivered: 'unknown' });
        }
        throw new CdpCommandError(method, message);
      });
    return (await Promise.race(cancel ? [command, timeout, cancel] : [command, timeout])) as T;
  } finally {
    clearTimeout(timer);
  }
}
