// Errors of provider calls, ported from the current Nanobrowser's src/background/llm/errors.ts, with what retries and
// overflow detection need.
import { APICallError, LoadAPIKeyError, RetryError } from 'ai';

/** The last underlying error of a `RetryError`, or the error itself. */
export function unwrapError(error: unknown): unknown {
  if (RetryError.isInstance(error) && error.lastError !== undefined) return error.lastError;
  return error;
}

export function getApiCallStatusCode(error: unknown): number | undefined {
  const unwrapped = unwrapError(error);
  return APICallError.isInstance(unwrapped) ? unwrapped.statusCode : undefined;
}

export function getApiCallResponseBody(error: unknown): string | undefined {
  const unwrapped = unwrapError(error);
  return APICallError.isInstance(unwrapped) ? unwrapped.responseBody : undefined;
}

export function isMissingApiKeyError(error: unknown): boolean {
  return LoadAPIKeyError.isInstance(unwrapError(error));
}

/**
 * The error's message with its response body, for overflow matching and for the user. A JSON body whose only news is
 * the message the SDK already took from it (AWS's `message` or `Message`, or `error.message`) is left out, so the text
 * does not show twice.
 */
export function errorText(error: unknown): string {
  const unwrapped = unwrapError(error);
  const message = unwrapped instanceof Error ? unwrapped.message : String(unwrapped);
  const body = getApiCallResponseBody(unwrapped);
  if (!body || message.includes(body) || onlyRepeats(body, message)) return message;
  return `${message} ${body}`;
}

/** Whether a JSON body says nothing but the message: that one field, alone, or with nothing else in an `error` object. */
function onlyRepeats(body: string, message: string): boolean {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return false;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return false;
  const fields = Object.entries(json as Record<string, unknown>);
  if (fields.length !== 1) return false;
  const [key, value] = fields[0]!;
  if (key === 'message' || key === 'Message') return value === message;
  if (key === 'error' && value && typeof value === 'object' && !Array.isArray(value)) {
    const inner = Object.entries(value as Record<string, unknown>);
    return inner.length === 1 && inner[0]![0] === 'message' && inner[0]![1] === message;
  }
  return false;
}

/** Rate limits, server errors and network failures are retried; other client errors are not. */
export function isRetryable(error: unknown): boolean {
  const unwrapped = unwrapError(error);
  if (unwrapped instanceof Error && unwrapped.name === 'AbortError') return false;
  if (APICallError.isInstance(unwrapped)) {
    const status = unwrapped.statusCode;
    if (status === undefined) return unwrapped.isRetryable;
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }
  // fetch rejects with a TypeError on network failures.
  return unwrapped instanceof TypeError;
}

/** The delay a `Retry-After` (seconds or a date) or `retry-after-ms` header asks for, in milliseconds. */
export function retryAfterMs(error: unknown, now = Date.now()): number | undefined {
  const unwrapped = unwrapError(error);
  if (!APICallError.isInstance(unwrapped)) return undefined;
  const headers = unwrapped.responseHeaders ?? {};
  const get = (name: string) => Object.entries(headers).find(([k]) => k.toLowerCase() === name)?.[1];
  const ms = Number(get('retry-after-ms'));
  if (Number.isFinite(ms) && ms >= 0) return ms;
  const value = get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/** A refused request from a local server's CORS or origin check: no status, or 403 with no body. */
export function isOriginRefused(error: unknown): boolean {
  const unwrapped = unwrapError(error);
  if (unwrapped instanceof TypeError) return true;
  return getApiCallStatusCode(unwrapped) === 403;
}
