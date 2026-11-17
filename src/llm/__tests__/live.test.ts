// A live check of one streamed tool call per provider, run only on request:
//   NB_LIVE=1 corepack pnpm vitest run src/llm/__tests__/live.test.ts
// Keys come from the environment and are never written anywhere. Models can be overridden with NB_LIVE_<KIND>.
// Bedrock takes BEDROCK_API_KEY (a Bedrock API key, or an access key ID and secret separated by a colon) and its
// region from NB_LIVE_BEDROCK_REGION; a short-term key works only in the region it was made in.
import { describe, expect, it } from 'vitest';
import { listModels } from '../connection';
import { createModel } from '../providers';
import type { ProviderKind } from '../providers';
import { streamTurn } from '../stream';

const live = process.env.NB_LIVE === '1';
const bedrockRegion = process.env.NB_LIVE_BEDROCK_REGION ?? 'us-east-1';
const cases: Array<{ kind: ProviderKind; model: string; key?: string; baseUrl?: string }> = [
  {
    kind: 'anthropic',
    model: process.env.NB_LIVE_ANTHROPIC ?? 'claude-haiku-4-5-20251001',
    key: process.env.ANTHROPIC_API_KEY,
  },
  { kind: 'openai', model: process.env.NB_LIVE_OPENAI ?? 'gpt-4.1-mini', key: process.env.OPENAI_API_KEY },
  {
    kind: 'gemini',
    model: process.env.NB_LIVE_GEMINI ?? 'gemini-2.5-flash',
    key: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  },
  {
    kind: 'openrouter',
    model: process.env.NB_LIVE_OPENROUTER ?? 'openai/gpt-4.1-mini',
    key: process.env.OPENROUTER_API_KEY,
  },
  {
    kind: 'bedrock',
    // Through its global inference profile: newer Bedrock models do not run on demand by their own id.
    model: process.env.NB_LIVE_BEDROCK ?? 'global.amazon.nova-2-lite-v1:0',
    key: process.env.BEDROCK_API_KEY,
    baseUrl: bedrockRegion,
  },
];

const tools = {
  click: {
    description: 'Click an element by its ref.',
    parameters: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
      additionalProperties: false,
    },
  },
};

describe.skipIf(!live)('live providers', () => {
  it.each(cases)(
    '$kind $model streams a tool call',
    async ({ kind, model, key, baseUrl }) => {
      expect(key, `no key for ${kind}`).toBeTruthy();
      let deltas = 0;
      const result = await streamTurn({
        chat: createModel({ kind, modelName: model, apiKey: key, baseUrl, maxOutputTokens: 512 }),
        system: 'You operate a web page through tools. Always act with a tool call.',
        messages: [{ role: 'user', content: 'Click the element with ref e7.' }],
        tools,
        onTextDelta: () => deltas++,
      });
      console.info(kind, model, result.finish, JSON.stringify(result.toolCalls), result.usage, result.error?.message);
      expect(result.error).toBeUndefined();
      expect(result.toolCalls[0]?.toolName).toBe('click');
      expect(result.toolCalls[0]?.input).toEqual({ ref: 'e7' });
      expect(result.usage?.input).toBeGreaterThan(0);
      // OpenRouter reports cost; the others do not, and none is made up.
      if (kind === 'openrouter') expect(result.usage?.cost).toBeGreaterThan(0);
      else expect(result.usage?.cost).toBeUndefined();
    },
    60_000,
  );
});

describe.skipIf(!live)('live Bedrock model list', () => {
  it('lists inference profiles among the models', async () => {
    expect(process.env.BEDROCK_API_KEY, 'no key for bedrock').toBeTruthy();
    const list = await listModels({ kind: 'bedrock', apiKey: process.env.BEDROCK_API_KEY, baseUrl: bedrockRegion });
    console.info('bedrock', bedrockRegion, list.models.length, 'listed,', list.hidden.length, 'hidden');
    expect(list.models.some(id => /^(global|us|eu|apac|jp|au|ca|us-gov)\./.test(id))).toBe(true);
  }, 60_000);
});
