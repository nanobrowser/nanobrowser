import { describe, expect, it } from 'vitest';
import { APICallError, RetryError } from 'ai';
import { errorText, isRetryable, retryAfterMs, unwrapError } from '../errors';
import { isContextOverflow, isSilentOverflow, statedContextLimit } from '../overflow';

const err = (status: number, body = '') =>
  new APICallError({ message: 'm', url: 'u', requestBodyValues: {}, statusCode: status, responseBody: body });

describe('errors', () => {
  it('unwraps a RetryError', () => {
    const last = err(500);
    expect(unwrapError(new RetryError({ message: 'r', reason: 'maxRetriesExceeded', errors: [last] }))).toBe(last);
  });

  it('adds the response body to the message only when it says more', () => {
    const call = (message: string, body: string) =>
      new APICallError({ message, url: 'u', requestBodyValues: {}, statusCode: 400, responseBody: body });
    const aws = 'The provided model identifier is invalid.';
    // Bedrock: the SDK's message is the body's only field.
    expect(errorText(call(aws, JSON.stringify({ message: aws })))).toBe(aws);
    expect(errorText(call(aws, JSON.stringify({ Message: aws })))).toBe(aws);
    expect(errorText(call(aws, JSON.stringify({ error: { message: aws } })))).toBe(aws);
    // A body with more than the message is still added.
    const more = JSON.stringify({ error: { message: aws, code: 'context_length_exceeded' } });
    expect(errorText(call(aws, more))).toBe(`${aws} ${more}`);
    const other = JSON.stringify({ message: 'Something else' });
    expect(errorText(call(aws, other))).toBe(`${aws} ${other}`);
    // A body that is not JSON is added as before.
    expect(errorText(call('Bad Gateway', '<html>upstream</html>'))).toBe('Bad Gateway <html>upstream</html>');
  });

  it('retries rate limits, server errors and network failures only', () => {
    expect(isRetryable(err(429))).toBe(true);
    expect(isRetryable(err(503))).toBe(true);
    expect(isRetryable(err(400))).toBe(false);
    expect(isRetryable(err(401))).toBe(false);
    expect(isRetryable(new TypeError('Failed to fetch'))).toBe(true);
    expect(isRetryable(Object.assign(new Error('a'), { name: 'AbortError' }))).toBe(false);
  });

  it('reads Retry-After as seconds, a date, or retry-after-ms', () => {
    const h = (headers: Record<string, string>) =>
      new APICallError({ message: 'm', url: 'u', requestBodyValues: {}, statusCode: 429, responseHeaders: headers });
    expect(retryAfterMs(h({ 'retry-after': '3' }))).toBe(3000);
    expect(retryAfterMs(h({ 'retry-after-ms': '250' }))).toBe(250);
    expect(retryAfterMs(h({ 'retry-after': new Date(10_000).toUTCString() }), 4000)).toBe(6000);
    expect(retryAfterMs(h({}))).toBeUndefined();
  });
});

describe('overflow detection', () => {
  it.each([
    ['Anthropic', 'prompt is too long: 213456 tokens > 200000 maximum'],
    [
      'OpenAI',
      "This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens.",
    ],
    ['OpenAI code', 'context_length_exceeded'],
    ['Gemini', 'The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).'],
    ['llama.cpp', 'the request exceeds the available context size, try increasing it'],
    [
      'LM Studio',
      'Trying to keep the first 5000 tokens when context the overflows. However, the model is loaded with context length of 4096 which is greater than the context length',
    ],
    ['Ollama', 'prompt too long; exceeded max context length by 100 tokens'],
  ])('recognises %s', (_name, body) => {
    expect(isContextOverflow(err(400, body))).toBe(true);
  });

  it('ignores other errors, and recognises 413', () => {
    expect(isContextOverflow(err(400, 'invalid api key'))).toBe(false);
    expect(isContextOverflow(err(413))).toBe(true);
  });

  it('detects a silent overflow from reported usage', () => {
    expect(isSilentOverflow(40_000, 32_768)).toBe(true);
    expect(isSilentOverflow(30_000, 32_768)).toBe(false);
    expect(isSilentOverflow(undefined, 32_768)).toBe(false);
  });
});

describe('statedContextLimit', () => {
  it('reads the limit from the recorded wordings that state one', () => {
    expect(
      statedContextLimit(
        "This model's maximum context length is 131072 tokens. However, you requested 140000 tokens (139000 in the messages, 1000 in the completion).",
      ),
    ).toBe(131_072);
    expect(
      statedContextLimit("This model's maximum prompt length is 256000 but the request contains 300000 tokens."),
    ).toBe(256_000);
  });

  it('reads nothing from another wording, a rate limit, or a number out of range', () => {
    // The Responses API states no limit.
    expect(statedContextLimit('Your input exceeds the context window of this model.')).toBeUndefined();
    expect(statedContextLimit('prompt is too long: 210000 tokens > 200000 maximum')).toBeUndefined();
    expect(statedContextLimit('Rate limit reached: limit 30000 tokens per minute')).toBeUndefined();
    expect(statedContextLimit('maximum context length is 512 tokens')).toBeUndefined();
    expect(statedContextLimit('maximum context length is 3000000 tokens')).toBeUndefined();
  });
});
