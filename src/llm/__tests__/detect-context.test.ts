import { describe, expect, it } from 'vitest';
import { detectContext } from '../connection';
import { resolveProfile } from '../profiles';

function server(routes: Record<string, unknown>): typeof fetch {
  return (async (url: string | URL) => {
    const path = new URL(String(url)).pathname;
    if (!(path in routes)) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(routes[path]), { status: 200 });
  }) as typeof fetch;
}

describe('context detection', () => {
  it('reads a loaded Ollama model from /api/ps', async () => {
    const fetchFn = server({ '/api/ps': { models: [{ name: 'qwen3:8b', context_length: 8192 }] } });
    expect(await detectContext({ kind: 'ollama', modelName: 'qwen3:8b' }, fetchFn)).toBe(8192);
  });

  it('falls back to num_ctx, then the model maximum, from /api/show', async () => {
    expect(
      await detectContext(
        { kind: 'ollama', modelName: 'm' },
        server({
          '/api/ps': { models: [] },
          '/api/show': { parameters: 'stop "<|im_end|>"\nnum_ctx 16384', model_info: {} },
        }),
      ),
    ).toBe(16384);
    expect(
      await detectContext(
        { kind: 'ollama', modelName: 'm', baseUrl: 'http://box:11434/v1' },
        server({ '/api/ps': { models: [] }, '/api/show': { model_info: { 'qwen3.context_length': 40960 } } }),
      ),
    ).toBe(40960);
  });

  it('reads LM Studio’s loaded_context_length', async () => {
    const fetchFn = server({
      '/api/v0/models': { data: [{ id: 'gemma-3', loaded_context_length: 4096, max_context_length: 131072 }] },
    });
    expect(await detectContext({ kind: 'lmstudio', modelName: 'gemma-3' }, fetchFn)).toBe(4096);
  });

  it('says nothing for an unreachable server or another kind', async () => {
    const down = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    expect(await detectContext({ kind: 'ollama', modelName: 'm' }, down)).toBeUndefined();
    expect(await detectContext({ kind: 'openai-compatible', modelName: 'm' }, down)).toBeUndefined();
  });

  it('only ever lowers the window the user set', () => {
    const base = { kind: 'ollama' as const, modelName: 'qwen3:8b', overrides: { contextWindow: 32768 } };
    expect(resolveProfile({ ...base, detectedContext: 8192 }).contextWindow).toBe(8192);
    expect(resolveProfile({ ...base, detectedContext: 131072 }).contextWindow).toBe(32768);
  });
});
