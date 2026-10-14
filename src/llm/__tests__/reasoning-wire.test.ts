// What is sent about reasoning, as the SDK serialises it with a mocked fetch: the effort as the one option, Anthropic's
// cache switch, no forceReasoning, the fallback for a refused field, reasoning parts left out and reasoning tokens in
// the usage.
import { describe, expect, it, vi } from 'vitest';
import type { LanguageModel } from 'ai';
import { createModel } from '../providers';
import type { ModelSpec } from '../providers';
import { resolveProfile, wireEffort } from '../profiles';
import { streamTurn } from '../stream';
import type { WireEffort } from '../catalogue';

function sse(chunks: unknown[]): Response {
  const body = chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const chunk = (delta: unknown, finish: string | null = null, usage?: unknown) => ({
  id: '1',
  object: 'chat.completion.chunk',
  created: 0,
  model: 'm',
  choices: [{ index: 0, delta, finish_reason: finish }],
  ...(usage ? { usage } : {}),
});

/** Records each request body and answers with `answer`, a 400 that names nothing by default. */
function recorder(answer: (body: Record<string, unknown>) => Response = () => error400('captured')) {
  const bodies: Array<Record<string, unknown>> = [];
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    bodies.push(body);
    return answer(body);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, bodies };
}

function error400(message: string): Response {
  return new Response(JSON.stringify({ error: { message, type: 'invalid_request_error' } }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  });
}

async function send(spec: ModelSpec, reasoning: WireEffort | undefined, fetch: typeof globalThis.fetch) {
  return streamTurn({
    chat: createModel(spec, { fetch }),
    system: 'S',
    messages: [{ role: 'user', content: 'hi' }],
    reasoning,
    retry: { attempts: 1, baseMs: 0, maxMs: 0 },
  });
}

describe('the wire', () => {
  it.each(['gpt-5.2-pro', 'gpt-5.4-pro', 'gpt-5.5-pro'])('%s maps Low to its supported Medium effort', async name => {
    const effort = wireEffort(resolveProfile({ kind: 'openai', modelName: name }), 'low');
    const { fetch, bodies } = recorder();
    await send({ kind: 'openai', modelName: name, apiKey: 'k' }, effort, fetch);
    expect(bodies[0].reasoning).toMatchObject({ effort: 'medium' });
  });

  it('Gemini 3.8 Flash sends Low for None, rather than an unsupported minimal level', async () => {
    const effort = wireEffort(resolveProfile({ kind: 'gemini', modelName: 'gemini-3.8-flash' }), 'none');
    const { fetch, bodies } = recorder();
    await send({ kind: 'gemini', modelName: 'gemini-3.8-flash', apiKey: 'g' }, effort, fetch);
    expect(bodies[0].generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: 'low' } });
  });

  it('Qwen 3.8 Max keeps the endpoint-specific None rule through SDK serialization', async () => {
    const { fetch, bodies } = recorder();
    for (const kind of ['openai-compatible', 'openrouter'] as const) {
      const spec: ModelSpec = { kind, modelName: 'qwen3.8-max', baseUrl: 'http://x/v1', apiKey: 'k' };
      await send(spec, wireEffort(resolveProfile(spec), 'none'), fetch);
    }
    expect(bodies[0].reasoning_effort).toBe('none');
    expect(bodies[1].reasoning_effort).toBe('low');
  });

  it('Gemini 3.1 Pro at None sends its lowest level', async () => {
    const effort = wireEffort(resolveProfile({ kind: 'gemini', modelName: 'gemini-3.1-pro-preview' }), 'none');
    const { fetch, bodies } = recorder();
    await send({ kind: 'gemini', modelName: 'gemini-3.1-pro-preview', apiKey: 'g' }, effort, fetch);
    expect(bodies[0].generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: 'low' } });
  });

  it('adaptive Claude gets the effort, and every Anthropic request the top-level cache switch', async () => {
    const { fetch, bodies } = recorder();
    await send(
      { kind: 'anthropic', modelName: 'claude-sonnet-5-5', apiKey: 'k', maxOutputTokens: 1000 },
      'medium',
      fetch,
    );
    expect(bodies[0]).toMatchObject({
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      max_tokens: 1000,
    });
  });

  it("budget Claude gets the SDK's budget on top of the request's limit", async () => {
    const { fetch, bodies } = recorder();
    await send({ kind: 'anthropic', modelName: 'claude-haiku-4-5', apiKey: 'k', maxOutputTokens: 1000 }, 'high', fetch);
    const thinking = bodies[0].thinking as { type: string; budget_tokens: number };
    expect(thinking.type).toBe('enabled');
    expect(bodies[0].max_tokens).toBe(1000 + thinking.budget_tokens);
  });

  it('an o-series model gets the developer role and the effort, with no forceReasoning', async () => {
    const { fetch, bodies } = recorder();
    await send({ kind: 'openai', modelName: 'o3', apiKey: 'k' }, 'low', fetch);
    expect((bodies[0].input as Array<{ role: string }>)[0].role).toBe('developer');
    expect(bodies[0].reasoning).toMatchObject({ effort: 'low' });
    expect(JSON.stringify(bodies[0])).not.toContain('forceReasoning');
  });

  it('chat completions get reasoning_effort, and nothing when no effort is given', async () => {
    const { fetch, bodies } = recorder();
    await send({ kind: 'ollama', modelName: 'qwen3:8b' }, 'low', fetch);
    await send({ kind: 'ollama', modelName: 'qwen3:8b' }, undefined, fetch);
    expect(bodies[0].reasoning_effort).toBe('low');
    expect(bodies[1]).not.toHaveProperty('reasoning_effort');
  });
});

describe('a refused field', () => {
  it('sends the same request once more without the option, and says so', async () => {
    const { fetch, bodies } = recorder(body =>
      body.reasoning_effort
        ? error400('Unrecognized request argument supplied: reasoning_effort')
        : sse([
            chunk({ role: 'assistant', content: 'ok' }),
            chunk({}, 'stop', { prompt_tokens: 5, completion_tokens: 1 }),
          ]),
    );
    const result = await send({ kind: 'openai-compatible', modelName: 'm', baseUrl: 'http://x/v1' }, 'low', fetch);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).not.toHaveProperty('reasoning_effort');
    expect({ ...bodies[1], reasoning_effort: 'low' }).toEqual(bodies[0]);
    expect(result).toMatchObject({ text: 'ok', reasoningDropped: true, attempts: 1 });
  });

  it('does not fire for a 400 that names nothing; it fires for Anthropic too', async () => {
    const plain = recorder(() => error400('bad request'));
    expect((await send({ kind: 'ollama', modelName: 'm' }, 'low', plain.fetch)).reasoningDropped).toBeUndefined();
    expect(plain.bodies).toHaveLength(1);
    const anthropic = recorder(() => error400('thinking is not supported'));
    const result = await send({ kind: 'anthropic', modelName: 'claude-x', apiKey: 'k' }, 'low', anthropic.fetch);
    // Refused with the option, then refused again without it: the fallback ran once, and the turn ends in the error.
    expect(anthropic.bodies).toHaveLength(2);
    expect(anthropic.bodies[1]).not.toHaveProperty('thinking');
    expect(result).toMatchObject({ finish: 'error', reasoningDropped: true });
  });
});

describe('the reply', () => {
  it('does not retry an error after reasoning streamed: the reply had started', async () => {
    let calls = 0;
    const model = {
      specificationVersion: 'v4',
      provider: 'test',
      modelId: 'test',
      supportedUrls: {},
      doGenerate: async () => {
        throw new Error('not used');
      },
      doStream: async () => {
        calls++;
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] });
              controller.enqueue({ type: 'reasoning-start', id: 'r' });
              controller.enqueue({ type: 'reasoning-delta', id: 'r', delta: 'thinking' });
              controller.enqueue({ type: 'error', error: new TypeError('network') });
              controller.close();
            },
          }),
        };
      },
    } as unknown as LanguageModel;
    const result = await streamTurn({
      chat: { spec: { kind: 'gemini', modelName: 'test' }, model },
      system: 'S',
      messages: [{ role: 'user', content: 'hi' }],
      sleep: async () => undefined,
    });
    expect(result.finish).toBe('error');
    expect(calls).toBe(1);
  });

  it('records reasoning tokens in the usage', async () => {
    const { fetch } = recorder(() =>
      sse([
        chunk({ role: 'assistant', content: 'ok' }),
        chunk({}, 'stop', {
          prompt_tokens: 5,
          completion_tokens: 30,
          completion_tokens_details: { reasoning_tokens: 25 },
        }),
      ]),
    );
    const result = await send({ kind: 'openrouter', modelName: 'm', apiKey: 'k' }, 'low', fetch);
    expect(result.usage).toMatchObject({ output: 30, reasoning: 25 });
  });

  it('leaves reasoning parts out, and a tool call keeps its provider metadata', async () => {
    const parts = [
      { type: 'stream-start', warnings: [] },
      { type: 'reasoning-start', id: 'r' },
      { type: 'reasoning-delta', id: 'r', delta: 'thinking hard' },
      { type: 'reasoning-end', id: 'r', providerMetadata: { anthropic: { signature: 'sig' } } },
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: 'Answer' },
      { type: 'text-end', id: 't' },
      {
        type: 'tool-call',
        toolCallId: 'c1',
        toolName: 'done',
        input: '{}',
        providerMetadata: { google: { thoughtSignature: 'ts' } },
      },
      {
        type: 'finish',
        finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
      },
    ];
    const model = {
      specificationVersion: 'v4',
      provider: 'test',
      modelId: 'test',
      supportedUrls: {},
      doGenerate: async () => {
        throw new Error('not used');
      },
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            for (const p of parts) controller.enqueue(p);
            controller.close();
          },
        }),
      }),
    } as unknown as LanguageModel;
    const result = await streamTurn({
      chat: { spec: { kind: 'gemini', modelName: 'test' }, model },
      system: 'S',
      messages: [{ role: 'user', content: 'hi' }],
      tools: { done: { description: 'd', parameters: { type: 'object', properties: {} } } },
    });
    expect(result.text).toBe('Answer');
    expect(JSON.stringify(result)).not.toContain('thinking hard');
    expect(result.toolCalls[0].providerOptions).toEqual({ google: { thoughtSignature: 'ts' } });
  });
});
