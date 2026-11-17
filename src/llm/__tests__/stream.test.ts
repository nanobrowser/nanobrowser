import { describe, expect, it } from 'vitest';
import { APICallError } from 'ai';
import { ScriptedModel } from '../scripted';
import { backoffMs, DEFAULT_RETRY, refusesOutputLimit, streamTurn } from '../stream';
import { isContextOverflow } from '../overflow';
import { requestOutputLimit } from '../profiles';
import { OUTPUT_LIMIT } from '../catalogue';
import type { ModelProfile } from '../profiles';

const tools = {
  click: { description: 'Click', parameters: { type: 'object', properties: { ref: { type: 'string' } } } },
};

function apiError(status: number, body = '', headers: Record<string, string> = {}) {
  return new APICallError({
    message: `HTTP ${status}`,
    url: 'https://example.test',
    requestBodyValues: {},
    statusCode: status,
    responseBody: body,
    responseHeaders: headers,
  });
}

const noSleep = async () => undefined;

describe('streamTurn', () => {
  it('streams text and collects tool calls without running them', async () => {
    const scripted = new ScriptedModel([{ text: 'Clicking.', toolCalls: [{ name: 'click', input: { ref: 'e1' } }] }]);
    const deltas: string[] = [];
    const result = await streamTurn({
      chat: scripted.chat(),
      system: 'sys',
      messages: [{ role: 'user', content: 'go' }],
      tools,
      onTextDelta: d => deltas.push(d),
    });
    expect(result.text).toBe('Clicking.');
    expect(deltas.join('')).toBe('Clicking.');
    expect(result.toolCalls).toEqual([{ toolCallId: 'call_1', toolName: 'click', input: { ref: 'e1' } }]);
    expect(result.finish).toBe('tool-calls');
    expect(result.usage).toMatchObject({ input: 100, output: 10 });
    expect(scripted.calls[0].tools.map(t => t.name)).toEqual(['click']);
  });

  it('reports the output limit, so the loop can fail the calls of a cut reply', async () => {
    const scripted = new ScriptedModel([{ toolCalls: [{ name: 'click', input: { ref: 'e1' } }], finish: 'length' }]);
    const result = await streamTurn({
      chat: scripted.chat(),
      system: '',
      messages: [{ role: 'user', content: 'x' }],
      tools,
    });
    expect(result.finish).toBe('length');
  });

  it('marks a call to an unknown tool as invalid', async () => {
    const scripted = new ScriptedModel([{ toolCalls: [{ name: 'eval', input: { code: '1' } }] }]);
    const result = await streamTurn({
      chat: scripted.chat(),
      system: '',
      messages: [{ role: 'user', content: 'x' }],
      tools,
    });
    expect(result.toolCalls[0].toolName).toBe('eval');
    expect(result.toolCalls[0].invalid).toBeTruthy();
  });

  it('retries a rate limit and a server error, then succeeds', async () => {
    const scripted = new ScriptedModel([{ error: apiError(429) }, { error: apiError(503) }, { text: 'ok' }]);
    const result = await streamTurn({
      chat: scripted.chat(),
      system: '',
      messages: [{ role: 'user', content: 'x' }],
      sleep: noSleep,
    });
    expect(result.text).toBe('ok');
    expect(result.attempts).toBe(3);
  });

  it('stops after 3 attempts', async () => {
    const scripted = new ScriptedModel(() => ({ error: apiError(500) }));
    const result = await streamTurn({
      chat: scripted.chat(),
      system: '',
      messages: [{ role: 'user', content: 'x' }],
      sleep: noSleep,
    });
    expect(result.finish).toBe('error');
    expect(result.attempts).toBe(3);
    expect(result.error?.status).toBe(500);
  });

  it('does not retry a client error, and detects an overflow', async () => {
    const scripted = new ScriptedModel([
      { error: apiError(400, '{"error":{"message":"prompt is too long: 210000 tokens"}}') },
    ]);
    const result = await streamTurn({
      chat: scripted.chat(),
      system: '',
      messages: [{ role: 'user', content: 'x' }],
      sleep: noSleep,
    });
    expect(result.attempts).toBe(1);
    expect(result.error?.overflow).toBe(true);
  });

  it('ends the turn with the error once text has streamed, and runs no calls', async () => {
    const scripted = new ScriptedModel([{ text: 'partial', streamError: apiError(500) }]);
    const result = await streamTurn({
      chat: scripted.chat(),
      system: '',
      messages: [{ role: 'user', content: 'x' }],
      sleep: noSleep,
    });
    expect(result.text).toBe('partial');
    expect(result.finish).toBe('error');
    expect(result.attempts).toBe(1);
  });

  it('ends as aborted when the signal fires', async () => {
    const scripted = new ScriptedModel([{ text: 'slow', delayMs: 5000 }]);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const result = await streamTurn({
      chat: scripted.chat(),
      system: '',
      messages: [{ role: 'user', content: 'x' }],
      signal: controller.signal,
    });
    expect(result.finish).toBe('aborted');
  });
});

describe('a refused output limit', () => {
  const refusal = (max: number) =>
    apiError(
      400,
      JSON.stringify({
        error: { message: `max_tokens is too large: ${max}. This model supports at most 4000 completion tokens` },
      }),
    );
  /** A model that takes at most `most` output tokens and refuses more, naming max_tokens. */
  const takesAtMost = (most: number) =>
    new ScriptedModel(call =>
      (call.maxOutputTokens ?? 0) > most ? { error: refusal(call.maxOutputTokens!) } : { text: 'ok' },
    );

  it('sends the same request again with half the limit while it is refused, and reports the limit taken', async () => {
    const scripted = takesAtMost(4000);
    const result = await streamTurn({
      chat: scripted.chat(),
      system: 'sys',
      messages: [{ role: 'user', content: 'x' }],
      maxOutputTokens: OUTPUT_LIMIT,
      sleep: noSleep,
    });
    expect(result.text).toBe('ok');
    expect(scripted.calls.map(c => c.maxOutputTokens)).toEqual([16_384, 8192, 4096, 2048]);
    expect(result.outputLimit).toBe(2048);
    // Halving is not an attempt.
    expect(result.attempts).toBe(1);
    expect(scripted.calls.every(c => JSON.stringify(c.prompt) === JSON.stringify(scripted.calls[0].prompt))).toBe(true);
  });

  it('stops at 1,024: a refusal there ends the turn with the error', async () => {
    const scripted = takesAtMost(500);
    const result = await streamTurn({
      chat: scripted.chat(),
      system: '',
      messages: [{ role: 'user', content: 'x' }],
      maxOutputTokens: OUTPUT_LIMIT,
      sleep: noSleep,
    });
    expect(scripted.calls.map(c => c.maxOutputTokens)).toEqual([16_384, 8192, 4096, 2048, 1024]);
    expect(result.finish).toBe('error');
    expect(result.outputLimit).toBeUndefined();
    expect(result.error?.overflow).toBe(false);
  });

  it('keeps the limit taken when the request then fails for another reason', async () => {
    const scripted = new ScriptedModel(call =>
      (call.maxOutputTokens ?? 0) > 4096 ? { error: refusal(call.maxOutputTokens!) } : { error: apiError(500) },
    );
    const result = await streamTurn({
      chat: scripted.chat(),
      system: '',
      messages: [{ role: 'user', content: 'x' }],
      maxOutputTokens: OUTPUT_LIMIT,
      sleep: noSleep,
    });
    expect(result.finish).toBe('error');
    expect(result.outputLimit).toBe(4096);
  });

  it('treats a message that names the context beside the limit as a refusal for size', async () => {
    const body = JSON.stringify({ error: { message: 'max_tokens plus the input exceed context limit (8192)' } });
    const scripted = new ScriptedModel([{ error: apiError(400, body) }]);
    const result = await streamTurn({
      chat: scripted.chat(),
      system: '',
      messages: [{ role: 'user', content: 'x' }],
      maxOutputTokens: OUTPUT_LIMIT,
      sleep: noSleep,
    });
    expect(scripted.calls).toHaveLength(1);
    expect(result.error?.overflow).toBe(true);
  });

  it('reads the wordings of the providers, and not a refusal for size or a rate limit', () => {
    for (const [status, message] of [
      [
        400,
        'max_tokens is too large: 20000. This model supports at most 16384 completion tokens, whereas you provided 20000.',
      ],
      [
        400,
        'max_tokens: 20000 > 8192, which is the maximum allowed number of output tokens for claude-3-haiku-20240307',
      ],
      [400, 'Invalid max_tokens value, the valid range of max_tokens is [1, 8192]'],
      [400, 'The requested maxOutputTokens exceeds the maximum allowed for this model'],
      [400, 'Malformed input request: #/maxTokens: 20000 is not less or equal to 8192'],
      [422, 'max_new_tokens must be <= 4096'],
      [400, "Unsupported value: 'max_output_tokens' must be at most 4096"],
      // Groq names the context window beside the limit; it is still a refused limit, not a refusal for size.
      [
        400,
        '`max_tokens` must be less than or equal to `8192`, the maximum value for `max_tokens` is less than the `context_window` for this model',
      ],
    ] as const) {
      expect(refusesOutputLimit(status, message), message).toBe(true);
    }
    for (const [status, message] of [
      [400, "This model's maximum context length is 8192 tokens. However, you requested 20000 tokens"],
      [429, 'Rate limit reached: max tokens per minute 30000'],
      [500, 'max_tokens is too large'],
      [400, 'prompt is too long: 210000 tokens > 200000 maximum'],
    ] as const) {
      expect(refusesOutputLimit(status, message), message).toBe(false);
    }
    expect(isContextOverflow(apiError(400, '{"message":"max_tokens and prompt exceed context limit"}'))).toBe(true);
    expect(
      isContextOverflow(
        apiError(
          400,
          '{"error":{"message":"`max_tokens` must be less than or equal to `8192`, the maximum value for `max_tokens` is less than the `context_window` for this model"}}',
        ),
      ),
    ).toBe(false);
  });
});

describe('requestOutputLimit', () => {
  const profile = (contextWindow: number, maxOutput = OUTPUT_LIMIT): ModelProfile => ({
    contextWindow,
    maxOutput,
    vision: false,
  });
  it('is the fixed limit, a quarter of a small window, or a learnt limit, and never under 1,024', () => {
    expect(requestOutputLimit(profile(1_000_000))).toBe(16_384);
    expect(requestOutputLimit(profile(16_384))).toBe(4096);
    expect(requestOutputLimit(profile(1_000_000, 2048))).toBe(2048);
    expect(requestOutputLimit(profile(2000, 500))).toBe(1024);
  });
});

describe('backoffMs', () => {
  it('honours Retry-After and grows exponentially with jitter otherwise', () => {
    expect(backoffMs(1, DEFAULT_RETRY, apiError(429, '', { 'retry-after': '2' }))).toBe(2000);
    expect(backoffMs(1, DEFAULT_RETRY, apiError(429, '', { 'Retry-After': '120' }))).toBe(30_000);
    expect(backoffMs(1, DEFAULT_RETRY, apiError(500), () => 0)).toBe(500);
    expect(backoffMs(2, DEFAULT_RETRY, apiError(500), () => 1)).toBe(2000);
  });
});

describe('the limit per local server', () => {
  it('sends one request at a time to a server with one slot', async () => {
    let inFlight = 0;
    let max = 0;
    const scripted = new ScriptedModel(() => {
      inFlight++;
      max = Math.max(max, inFlight);
      return { text: 'ok', delayMs: 30 };
    });
    const chat = scripted.chat({ kind: 'ollama', baseUrl: 'http://box:11434', maxConcurrent: 1 });
    const runs = await Promise.all(
      [1, 2, 3].map(async () => {
        const r = await streamTurn({ chat, system: '', messages: [{ role: 'user', content: 'x' }] });
        inFlight--;
        return r;
      }),
    );
    expect(runs.every(r => r.text === 'ok')).toBe(true);
    expect(max).toBe(1);
  });
});
