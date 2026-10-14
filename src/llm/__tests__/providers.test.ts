import { describe, expect, it, vi } from 'vitest';
import { createModel, openAICompatibleBaseUrl } from '../providers';
import type { ModelSpec } from '../providers';
import { streamTurn } from '../stream';

interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** A fetch that records the request and answers 400, so nothing is retried. */
function captureFetch() {
  const requests: Captured[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : {},
    });
    return new Response(JSON.stringify({ error: { message: 'captured', type: 'invalid_request_error' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, requests };
}

const tools = {
  done: { description: 'Finish', parameters: { type: 'object', properties: { summary: { type: 'string' } } } },
};

async function capture(spec: ModelSpec): Promise<Captured> {
  const { fetch, requests } = captureFetch();
  const result = await streamTurn({
    chat: createModel(spec, { fetch }),
    system: 'You are a test.',
    messages: [{ role: 'user', content: 'hi' }],
    tools,
  });
  expect(result.finish).toBe('error');
  expect(requests).toHaveLength(1);
  return requests[0];
}

describe('providers', () => {
  it('Anthropic: messages endpoint with the direct browser access header', async () => {
    const r = await capture({ kind: 'anthropic', modelName: 'claude-sonnet-5-5', apiKey: 'k', maxOutputTokens: 1000 });
    expect(r.url).toBe('https://api.anthropic.com/v1/messages');
    expect(r.headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(r.headers.get('x-api-key')).toBe('k');
    expect(r.body.stream).toBe(true);
    expect((r.body.tools as Array<{ name: string }>).map(t => t.name)).toEqual(['done']);
    expect(r.body.max_tokens).toBe(1000);
  });

  it('Gemini: streamGenerateContent with the key header', async () => {
    const r = await capture({ kind: 'gemini', modelName: 'gemini-3-flash', apiKey: 'g' });
    expect(r.url).toContain('generativelanguage.googleapis.com');
    expect(r.url).toContain('models/gemini-3-flash:streamGenerateContent');
    expect(r.headers.get('x-goog-api-key')).toBe('g');
  });

  it('OpenAI: the Responses API, nothing stored, non-strict schemas, tools as functions', async () => {
    const r = await capture({ kind: 'openai', modelName: 'gpt-6-luna', apiKey: 'o' });
    expect(r.url).toBe('https://api.openai.com/v1/responses');
    expect(r.body.store).toBe(false);
    const [done] = r.body.tools as Array<{ type: string; name: string; strict?: boolean }>;
    expect(done).toMatchObject({ type: 'function', name: 'done', strict: false });
  });

  it('OpenAI: a tool call goes back in history without its item id', async () => {
    const { fetch, requests } = captureFetch();
    await streamTurn({
      chat: createModel({ kind: 'openai', modelName: 'gpt-6-luna', apiKey: 'o' }, { fetch }),
      system: 'You are a test.',
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call_1',
              toolName: 'done',
              input: { summary: 's' },
              providerOptions: { openai: { itemId: 'fc_1' } },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            { type: 'tool-result', toolCallId: 'call_1', toolName: 'done', output: { type: 'text', value: 'ok' } },
          ],
        },
      ],
      tools,
    });
    const input = requests[0].body.input as Array<Record<string, unknown>>;
    const call = input.find(i => i.type === 'function_call');
    expect(call).toMatchObject({ call_id: 'call_1', name: 'done' });
    expect(call).not.toHaveProperty('id');
    expect(input.some(i => i.type === 'item_reference')).toBe(false);
  });

  it('Ollama: the server address gets /v1 and needs no key', async () => {
    const r = await capture({ kind: 'ollama', modelName: 'qwen3:8b', baseUrl: 'http://localhost:11434' });
    expect(r.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(r.body.model).toBe('qwen3:8b');
  });

  it('a custom OpenAI-compatible endpoint uses its base URL as is', async () => {
    const r = await capture({
      kind: 'openai-compatible',
      modelName: 'm',
      baseUrl: 'http://10.0.0.2:8000/v1/',
      apiKey: 'x',
    });
    expect(r.url).toBe('http://10.0.0.2:8000/v1/chat/completions');
  });

  it('OpenRouter sends its headers', async () => {
    const r = await capture({ kind: 'openrouter', modelName: 'anthropic/claude-sonnet-5.5', apiKey: 'or' });
    expect(r.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(r.headers.get('x-title')).toBe('Nanobrowser');
  });
});

describe('helpers', () => {
  it('builds local server base URLs', () => {
    expect(openAICompatibleBaseUrl('ollama')).toBe('http://localhost:11434/v1');
    expect(openAICompatibleBaseUrl('ollama', 'http://box:11434/')).toBe('http://box:11434/v1');
    expect(openAICompatibleBaseUrl('lmstudio', 'http://localhost:1234/v1')).toBe('http://localhost:1234/v1');
  });

  it("keeps OpenRouter's fixed address, whatever an older card stored", () => {
    expect(openAICompatibleBaseUrl('openrouter', 'https://example.com/v1')).toBe('https://openrouter.ai/api/v1');
  });
});
