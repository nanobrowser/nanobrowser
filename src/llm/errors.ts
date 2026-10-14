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

/** The error's message with its response body, for overflow matching and for the user. */
export function errorText(error: unknown): string {
  const unwrapped = unwrapError(error);
  const message = unwrapped instanceof Error ? unwrapped.message : String(unwrapped);
  const body = getApiCallResponseBody(unwrapped);
  return body && !message.includes(body) ? `${message} ${body}` : message;
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
