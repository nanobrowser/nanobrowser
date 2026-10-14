// One streamed tool call per provider, in the MV3 worker. Run with NB_LIVE=1 pnpm autorun llm-live. The keys come from
// the fixture server's environment and are never stored, returned or logged.
import { streamTurn, createModel } from '@src/llm';
import type { ProviderKind } from '@src/llm';
import { defineCheck } from './registry';

const MODELS: Array<{ kind: ProviderKind; model: string }> = [
  { kind: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  { kind: 'openai', model: 'gpt-4.1-mini' },
  { kind: 'gemini', model: 'gemini-2.5-flash' },
];

defineCheck({
  name: 'llm-live',
  title: 'Live tool call per provider (worker)',
  description: 'Streams one tool call from Anthropic, OpenAI and Gemini in the service worker. Needs NB_LIVE=1.',
  async run(args) {
    const response = await fetch('http://localhost:8787/__live/keys');
    if (!response.ok) throw new Error('Run with NB_LIVE=1 so the fixture server can hand over the keys');
    const keys = (await response.json()) as Record<string, string | undefined>;
    const models = (args.models as typeof MODELS | undefined) ?? MODELS;
    const results = [];
    for (const { kind, model } of models) {
      const result = await streamTurn({
        chat: createModel({ kind, modelName: model, apiKey: keys[kind], maxOutputTokens: 512 }),
        system: 'You operate a web page through tools. Always act with a tool call.',
        messages: [{ role: 'user', content: 'Click the element with ref e7.' }],
        tools: {
          click: {
            description: 'Click an element by its ref.',
            parameters: {
              type: 'object',
              properties: { ref: { type: 'string' } },
              required: ['ref'],
              additionalProperties: false,
            },
          },
        },
      });
      const call = result.toolCalls[0];
      results.push({
        kind,
        model,
        ok: !result.error && call?.toolName === 'click' && (call.input as { ref?: string })?.ref === 'e7',
        finish: result.finish,
        call: call ? { name: call.toolName, input: call.input } : null,
        usage: result.usage,
        ms: result.durationMs,
        error: result.error?.message?.slice(0, 300),
      });
    }
    if (results.some(r => !r.ok)) throw new Error(JSON.stringify(results));
    return { results };
  },
});
