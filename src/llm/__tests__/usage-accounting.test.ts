import { describe, expect, it } from 'vitest';
import { usageAccounting } from '../providers';

const sse = (...chunks: unknown[]) =>
  new Response(chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n', { status: 200 });

describe('OpenRouter usage accounting', () => {
  it('asks for usage in each request and reads the cost from the stream, once', async () => {
    let sent: Record<string, unknown> = {};
    const { fetch, takeCost } = usageAccounting((async (_url: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return sse(
        { choices: [{ delta: { content: 'hi' } }] },
        { choices: [], usage: { prompt_tokens: 9, completion_tokens: 2, cost: 0.0000196 } },
      );
    }) as typeof globalThis.fetch);
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'x' }),
    });
    expect(sent).toMatchObject({ model: 'x', usage: { include: true } });
    // The SDK still reads the whole stream.
    expect(await response.text()).toContain('"content":"hi"');
    expect(await takeCost()).toBe(0.0000196);
    expect(await takeCost()).toBeUndefined();
  });

  it('reports nothing when the provider sends no cost', async () => {
    const { fetch, takeCost } = usageAccounting((async () =>
      sse({ choices: [], usage: { prompt_tokens: 1 } })) as typeof globalThis.fetch);
    await (await fetch('https://x', { method: 'POST', body: '{}' })).text();
    expect(await takeCost()).toBeUndefined();
  });
});
