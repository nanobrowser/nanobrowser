// The catalogue's expected results: for a fixed list of names, the row the lookup chooses, the capability, and what
// the four efforts become on the wire, with the future names of each family. Regression coverage for the order of the
// rows.
import { describe, expect, it } from 'vitest';
import { atLeast, cleanName, findRow, isCloudEndpoint, REASONING_EFFORTS, rows, sendRule } from '../catalogue';
import type { CatalogueRow, ReasoningSupport, WireEffort } from '../catalogue';
import type { ProviderKind } from '../providers';
import { makePair, resolveProfile, wireEffort } from '../profiles';

type Wire = [WireEffort | undefined, WireEffort | undefined, WireEffort | undefined, WireEffort | undefined];
const ALL: Wire = ['none', 'low', 'medium', 'high'];
const ALWAYS: Wire = ['low', 'low', 'medium', 'high'];
const NOTHING: Wire = [undefined, undefined, undefined, undefined];
const UNKNOWN: Wire = [undefined, 'low', 'medium', 'high'];
const PRO: Wire = ['medium', 'medium', 'medium', 'high'];
const HIGH_FOR_MEDIUM: Wire = ['low', 'low', 'high', 'high'];

/** The OpenAI-compatible card at a public host unless a case says otherwise. */
const CLOUD_URL = 'https://api.example.com/v1';
const LOCAL_URL = 'http://localhost:8000/v1';

/** [kind, name, row id or null for the defaults, capability, None/Low/Medium/High on the wire, base URL]. */
const MATRIX: Array<[ProviderKind, string, string | null, ReasoningSupport | undefined, Wire, string?]> = [
  // Anthropic
  ['anthropic', 'claude-opus-5-5', 'claude-opus-5-5', 'always', ALWAYS],
  ['anthropic', 'claude-fable-5-1', 'claude-fable', 'always', ALWAYS],
  ['anthropic', 'claude-sonnet-5-5', 'claude-sonnet-5-5', 'optional', ALL],
  ['anthropic', 'claude-haiku-5-5', 'claude-5', 'optional', ALL],
  ['anthropic', 'claude-haiku-4-5-20251001', 'claude-4', 'optional', ALL],
  ['anthropic', 'claude-opus-4-8', 'claude-4-6-plus', 'optional', ALL],
  ['anthropic', 'claude-sonnet-4-6', 'claude-4-6-plus', 'optional', ALL],
  ['anthropic', 'claude-sonnet-4-5-20250929', 'claude-4', 'optional', ALL],
  ['anthropic', 'claude-opus-4-20250514', 'claude-opus-4-legacy', 'optional', ALL],
  ['anthropic', 'claude-opus-4-1', 'claude-opus-4-legacy', 'optional', ALL],
  ['anthropic', 'claude-opus-4-0', 'claude-opus-4-legacy', 'optional', ALL],
  ['anthropic', 'claude-opus-4-5', 'claude-4', 'optional', ALL],
  ['anthropic', 'claude-3-5-haiku-latest', 'claude-3', 'none', NOTHING],
  ['anthropic', 'claude-3-opus-20240229', 'claude-3', 'none', NOTHING],
  ['anthropic', 'claude-3-7-sonnet', 'claude-family', 'always', ALWAYS],
  ['anthropic', 'claude-opus-6', 'claude-opus-5-5', 'always', ALWAYS],
  ['anthropic', 'claude-sonnet-5-6', 'claude-sonnet-5-5', 'optional', ALL],
  ['anthropic', 'claude-haiku-6', 'claude-5', 'optional', ALL],
  ['anthropic', 'claude-mystery-9', 'claude-family', 'always', ALWAYS],
  ['openrouter', 'anthropic/claude-sonnet-5-5', 'claude-sonnet-5-5-openrouter', 'always', ALWAYS],
  ['openrouter', 'anthropic/claude-sonnet-5.5', 'claude-sonnet-5-5-openrouter', 'always', ALWAYS],
  ['openrouter', 'anthropic/claude-opus-5.5', 'claude-opus-5-5', 'always', ALWAYS],
  ['openrouter', 'anthropic/claude-opus-4.1', 'claude-opus-4-legacy', 'optional', ALL],
  // OpenAI
  ['openai', 'o1-mini', 'o1-mini', undefined, UNKNOWN],
  ['openai', 'o1-preview', 'o1-preview', undefined, UNKNOWN],
  ['openai', 'o1', 'o1', 'always', ALWAYS],
  ['openai', 'o3-mini', 'o3-mini', 'always', ALWAYS],
  ['openai', 'o3', 'o-series', 'always', ALWAYS],
  ['openai', 'o4-mini', 'o-series', 'always', ALWAYS],
  ['openai', 'o5', 'o-series', 'always', ALWAYS],
  ['openai', 'gpt-5', 'gpt-5-base', 'optional', ['minimal', 'low', 'medium', 'high']],
  ['openai', 'gpt-5-mini-2025-08-07', 'gpt-5-base', 'optional', ['minimal', 'low', 'medium', 'high']],
  ['openai', 'gpt-5-pro', 'gpt-5-pro', 'none', NOTHING],
  ['openai', 'gpt-5.2-pro', 'gpt-5-2-pro', 'always', PRO],
  ['openai', 'gpt-5.4-pro', 'gpt-5-4-pro', 'always', PRO],
  ['openai', 'gpt-5.5-pro', 'gpt-5-4-pro', 'always', PRO],
  ['openai', 'gpt-5.6-pro', 'gpt-5-4-pro', 'always', PRO],
  ['openai', 'gpt-6-pro', 'gpt-5-4-pro', 'always', PRO],
  ['openai', 'gpt-5-chat-latest', 'gpt-5-chat', 'none', NOTHING],
  ['openai', 'gpt-5.1-chat-latest', 'gpt-5-chat', 'none', NOTHING],
  ['openai', 'gpt-5.5', 'gpt-5-4-plus', 'optional', ALL],
  ['openai', 'gpt-5.6-terra', 'gpt-5-4-plus', 'optional', ALL],
  ['openai', 'gpt-5.4-2026-03-05', 'gpt-5-4-plus', 'optional', ALL],
  ['openai', 'gpt-5.4-mini', 'gpt-5', 'optional', ALL],
  ['openai', 'gpt-5.2', 'gpt-5', 'optional', ALL],
  ['openai', 'gpt-5-codex', 'gpt-5-codex', 'always', ALWAYS],
  ['openai', 'gpt-5.3-codex', 'gpt-5-codex', 'always', ALWAYS],
  ['openai', 'gpt-5.1-codex-max', 'gpt-5-codex', 'always', ALWAYS],
  ['openai', 'gpt-6-astra', 'gpt-6', 'always', ALWAYS],
  ['openai', 'gpt-6-sol', 'gpt-6-sol-luna', 'optional', ALL],
  ['openai', 'gpt-6-luna', 'gpt-6-sol-luna', 'optional', ALL],
  ['openai', 'gpt-6-sol-2026-10-01', 'gpt-6', 'always', ALWAYS],
  ['openai', 'gpt-6', 'gpt-6', 'always', ALWAYS],
  ['openai', 'gpt-6.1-sol', 'gpt-6', 'always', ALWAYS],
  ['openai', 'gpt-7', 'gpt-6', 'always', ALWAYS],
  ['openai', 'gpt-4.1-mini', 'gpt-4-1', 'none', NOTHING],
  ['openai', 'gpt-4o', 'gpt-4o', 'none', NOTHING],
  ['openai', 'gpt-4', 'gpt-old', 'none', NOTHING],
  ['openai', 'gpt-3.5-turbo', 'gpt-old', 'none', NOTHING],
  ['openai', 'unknown-model', null, undefined, UNKNOWN],
  ['openrouter', 'openai/gpt-oss-120b', 'gpt-oss-cloud', 'optional', ALL],
  ['openrouter', 'openai/gpt-next', 'openai-family', 'always', ALWAYS],
  // Google
  ['gemini', 'gemini-3-pro-preview', 'gemini-3-pro-preview', 'always', HIGH_FOR_MEDIUM],
  ['gemini', 'gemini-3.1-pro-preview', 'gemini-3-pro', 'always', ALWAYS],
  ['gemini', 'gemini-3.1-pro-preview-customtools', 'gemini-3-pro', 'always', ALWAYS],
  ['gemini', 'gemini-pro-latest', 'gemini-pro-latest', 'always', ALWAYS],
  ['gemini', 'gemini-4-pro', 'gemini-3-pro', 'always', ALWAYS],
  ['gemini', 'gemini-3-flash', 'gemini-3', 'optional', ALL],
  ['gemini', 'gemini-3-flash-preview', 'gemini-3', 'optional', ALL],
  ['gemini', 'gemini-3.6-flash', 'gemini-3', 'optional', ALL],
  ['gemini', 'gemini-3.5-flash-lite', 'gemini-3', 'optional', ALL],
  ['gemini', 'gemini-3.1-flash-lite', 'gemini-3', 'optional', ALL],
  ['gemini', 'gemini-3.8-flash-lite', 'gemini-3', 'optional', ALL],
  ['gemini', 'gemini-flash-lite-latest', 'gemini-flash-lite-latest', 'optional', ALL],
  ['gemini', 'gemini-flash-latest', 'gemini-flash-latest', 'always', ALWAYS],
  ['gemini', 'gemini-3.7-flash', 'gemini-flash-3-7-plus', 'always', ALWAYS],
  ['gemini', 'gemini-3.8-flash', 'gemini-flash-3-7-plus', 'always', ALWAYS],
  ['gemini', 'gemini-3.9-flash', 'gemini-flash-3-7-plus', 'always', ALWAYS],
  ['gemini', 'gemini-4-flash', 'gemini-flash-3-7-plus', 'always', ALWAYS],
  ['gemini', 'gemini-2.5-pro', 'gemini-2-5-pro', 'always', ALWAYS],
  ['gemini', 'gemini-2.5-flash', 'gemini-2-5', 'optional', ALL],
  ['gemini', 'gemini-2.0-flash', 'gemini-old', 'none', NOTHING],
  ['gemini', 'gemini-3.8-flash-preview-tts', 'gemini-media', 'none', NOTHING],
  ['gemini', 'gemini-3.1-flash-image', 'gemini-media', 'none', NOTHING],
  ['gemini', 'gemini-9-ultra', 'gemini-family', 'always', ALWAYS],
  // xAI
  ['openai-compatible', 'grok-4.3', 'grok-4-3', 'optional', ALL],
  ['openai-compatible', 'grok-4.6', 'grok-4-5-to-7', 'always', ALWAYS],
  ['openai-compatible', 'grok-5', 'grok-4-5-to-7', 'always', ALWAYS],
  ['openai-compatible', 'grok-4.20', 'grok-no-effort', 'none', NOTHING],
  ['openai-compatible', 'grok-4', 'grok-no-effort', 'none', NOTHING],
  ['openai-compatible', 'grok-3-mini', 'grok-no-effort', 'none', NOTHING],
  ['openai-compatible', 'grok-4.7', 'grok-4-7', 'always', ALWAYS],
  ['openrouter', 'x-ai/grok-4.7', 'grok-4-7-openrouter', 'always', ALWAYS],
  ['openai-compatible', 'grok-code-fast', 'grok-family', 'always', ALWAYS],
  // DeepSeek
  ['openai-compatible', 'deepseek-v4-flash', 'deepseek-flash', 'always', ALWAYS],
  ['openai-compatible', 'deepseek-flash', 'deepseek-flash', 'always', ALWAYS],
  ['openai-compatible', 'deepseek-v4.1-flash', 'deepseek-flash', 'always', ALWAYS],
  ['openai-compatible', 'deepseek-v4', 'deepseek-v4', 'always', ALWAYS],
  ['openai-compatible', 'deepseek-v4-pro-0813', 'deepseek-v4', 'always', ALWAYS],
  ['openrouter', 'deepseek/deepseek-r1', 'deepseek-r1', 'always', ALWAYS],
  ['openai-compatible', 'deepseek-chat', 'deepseek-chat', 'none', NOTHING],
  [
    'openrouter',
    'deepseek/deepseek-v4.1-flash',
    'deepseek-4-1-flash-openrouter',
    'optional',
    ['none', 'low', 'high', 'high'],
  ],
  [
    'openrouter',
    'deepseek/deepseek-v4-pro-0813',
    'deepseek-pro-0813-openrouter',
    'optional',
    ['none', 'high', 'high', 'xhigh'],
  ],
  ['openai-compatible', 'deepseek-v5', 'deepseek-family', 'always', ALWAYS],
  // Moonshot and Zhipu
  ['openrouter', 'moonshotai/kimi-k3', 'kimi-k3-openrouter', 'optional', ['none', 'low', 'high', 'high']],
  ['openai-compatible', 'kimi-k3', 'kimi-k3', 'always', HIGH_FOR_MEDIUM],
  ['openai-compatible', 'kimi-k4', 'kimi-family', 'always', ALWAYS],
  ['openrouter', 'z-ai/glm-5.3', 'glm-5-3', 'always', HIGH_FOR_MEDIUM],
  ['openai-compatible', 'glm-5.3-flash', 'glm-5-3-flash', 'always', HIGH_FOR_MEDIUM],
  ['openrouter', 'z-ai/glm-5', 'glm-family', 'always', ALWAYS],
  ['openai-compatible', 'glm-6', 'glm-family', 'always', ALWAYS],
  // Qwen on the cloud
  ['openai-compatible', 'qwen3.8-max', 'qwen3-8-cloud', 'optional', ALL],
  ['openai-compatible', 'qwen3.8-flash', 'qwen3-8-cloud', 'optional', ALL],
  ['openrouter', 'qwen/qwen3.8-max', 'qwen3-8-max-openrouter', 'always', ALWAYS],
  ['openrouter', 'qwen/qwen3.8-2.4t-a95b', 'qwen3-8-2-4t-openrouter', 'always', ['low', 'low', 'medium', 'xhigh']],
  ['openai-compatible', 'qwen3.8-2.4t-a95b', 'qwen3-8-2-4t', 'optional', ALL],
  ['openrouter', 'qwen/qwen3.8-27b', 'qwen3-8-27b-openrouter', 'optional', ['none', 'low', 'medium', 'xhigh']],
  ['openrouter', 'qwen/qwen3.8-omni-flash', 'qwen3-8-omni-openrouter', 'none', NOTHING],
  ['openai-compatible', 'qwen3.8-omni-flash', 'qwen3-8-omni', 'optional', ['none', 'low', 'medium', 'xhigh']],
  ['openai-compatible', 'qwen3.8-plus', 'qwen-family', 'always', ALWAYS],
  ['openai-compatible', 'qwen3.5-plus', 'qwen-family', 'always', ALWAYS],
  // Mistral
  ['openai-compatible', 'mistral-large-2512', 'mistral-cloud', 'none', NOTHING],
  ['openrouter', 'mistralai/mistral-medium-3.1', 'mistral-cloud', 'none', NOTHING],
  ['openai-compatible', 'mistral-large-4-0', 'mistral-family', 'always', ALWAYS],
  ['openai-compatible', 'mistral-medium-3-5', 'mistral-family', 'always', ALWAYS],
  // Local servers: no family row applies there
  ['ollama', 'qwen3-vl:8b', 'qwen3-vl-local', 'optional', ALL],
  ['ollama', 'Qwen3:8B', 'qwen3-local', 'optional', ALL],
  ['lmstudio', 'qwen3-4b', 'qwen3-local', 'optional', ALL],
  ['ollama', 'qwen3.8:27b-mlx', 'qwen3-5-local', 'optional', ALL],
  ['ollama', 'gpt-oss:20b', 'gpt-oss', 'optional', ALL],
  ['ollama', 'qwen2.5:7b', 'qwen2-5', 'none', NOTHING],
  ['ollama', 'gemma3:12b', 'gemma3', 'none', NOTHING],
  ['ollama', 'llama3.2', 'llama3', 'none', NOTHING],
  ['ollama', 'devstral', 'mistral-local', 'none', NOTHING],
  ['ollama', 'mystery', null, undefined, UNKNOWN],
  ['ollama', 'deepseek-coder:6.7b', null, undefined, UNKNOWN],
  ['openai-compatible', 'qwen3.8-plus', null, undefined, UNKNOWN, LOCAL_URL],
  ['openai-compatible', 'gemini-9', null, undefined, UNKNOWN, LOCAL_URL],
];

describe('the catalogue', () => {
  it.each(MATRIX)('%s %s → %s', (kind, name, id, capability, wire, url) => {
    const baseUrl = url ?? (kind === 'openai-compatible' ? CLOUD_URL : undefined);
    expect(findRow(kind, name, undefined, isCloudEndpoint(kind, baseUrl))?.id ?? null).toBe(id);
    const profile = resolveProfile({ kind, modelName: name, baseUrl });
    expect(profile.reasoning).toBe(capability);
    expect(REASONING_EFFORTS.map(e => wireEffort(profile, e))).toEqual(wire);
  });

  it('names every row at least once', () => {
    const named = new Set(MATRIX.map(m => m[2]));
    expect(rows.map(r => r.id).filter(id => !named.has(id))).toEqual([]);
  });

  it('has unique ids, a date and a source on every row, and a version group on every range', () => {
    expect(new Set(rows.map(r => r.id)).size).toBe(rows.length);
    for (const r of rows) {
      expect(r.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.source).not.toBe('');
      if (r.since) expect(r.match.source).toContain('?<v>');
    }
  });

  it('cleans a name for the ranges and families', () => {
    expect(cleanName('google/gemini-3.1-pro-preview')).toBe('gemini-3.1-pro');
    expect(cleanName('claude-sonnet-4-5-20250929')).toBe('claude-sonnet-4-5');
    expect(cleanName('gpt-6-sol-2026-10-01')).toBe('gpt-6-sol');
    expect(cleanName('gemini-3-flash-preview-latest')).toBe('gemini-3-flash');
    expect(cleanName('deepseek/deepseek-r1:free')).toBe('deepseek-r1');
  });

  it('compares versions part by part', () => {
    expect(atLeast('5.10', '5.4')).toBe(true);
    expect(atLeast('5.3', '5.4')).toBe(false);
    expect(atLeast('4-6', '4.6')).toBe(true);
    expect(atLeast('6', '5.4')).toBe(true);
    expect(atLeast('5', '5')).toBe(true);
  });

  it('tells a cloud endpoint from a local one by kind and host', () => {
    expect(isCloudEndpoint('anthropic')).toBe(true);
    expect(isCloudEndpoint('openrouter')).toBe(true);
    expect(isCloudEndpoint('ollama', 'https://ollama.example.com')).toBe(false);
    expect(isCloudEndpoint('lmstudio')).toBe(false);
    expect(isCloudEndpoint('openai-compatible', 'https://api.deepseek.com/v1')).toBe(true);
    expect(isCloudEndpoint('openai-compatible', 'http://172.32.0.1:8000/v1')).toBe(true);
    for (const url of [
      'http://localhost:8000/v1',
      'http://127.0.0.1:8000',
      'http://10.0.0.2/v1',
      'http://172.20.1.1/v1',
      'http://192.168.1.5:8000',
      'http://gpu-box:8000/v1',
      'http://studio.local:1234/v1',
      'http://[::1]:8000',
      '',
      undefined,
    ]) {
      expect(isCloudEndpoint('openai-compatible', url)).toBe(false);
    }
  });
});

// Recorded documentation facts, separate from lookup and wire coverage. Endpoint limits can change independently of
// vendor limits; these are snapshots of the sources on the rows, not live API tests.
describe('documented model limits and vision (2026-10-10)', () => {
  const facts: Array<[ProviderKind, string, number, number, boolean]> = [
    ['openai', 'gpt-6.1-sol', 1_050_000, 128_000, true],
    ['openai', 'gpt-6-sol', 1_050_000, 128_000, true],
    ['openai', 'gpt-5.5-pro', 1_050_000, 128_000, true],
    ['openai', 'gpt-5.2-pro', 400_000, 128_000, true],
    ['openai', 'o1-mini', 128_000, 65_536, false],
    ['openai', 'o1-preview', 128_000, 32_768, false],
    ['openai', 'o3-mini', 200_000, 100_000, false],
    ['anthropic', 'claude-opus-5-5', 1_000_000, 128_000, true],
    ['anthropic', 'claude-sonnet-5-5', 1_000_000, 128_000, true],
    ['anthropic', 'claude-haiku-5-5', 1_000_000, 128_000, true],
    ['anthropic', 'claude-fable-5-1', 1_000_000, 128_000, true],
    ['anthropic', 'claude-opus-4-1', 200_000, 32_000, true],
    ['anthropic', 'claude-opus-4-5', 200_000, 64_000, true],
    ['gemini', 'gemini-3.8-flash', 1_048_576, 65_536, true],
    ['gemini', 'gemini-3.1-pro-preview', 1_048_576, 65_536, true],
    ['gemini', 'gemini-3.5-flash-lite', 1_048_576, 65_536, true],
    ['openai-compatible', 'grok-4.7', 500_000, 500_000, true],
    ['openrouter', 'x-ai/grok-4.7', 500_000, 450_000, true],
    ['openai-compatible', 'deepseek-v4.1-flash', 1_000_000, 384_000, true],
    ['openai-compatible', 'deepseek-v4-pro-0813', 1_000_000, 384_000, false],
    ['openrouter', 'deepseek/deepseek-v4.1-flash', 1_048_576, 943_718, true],
    ['openrouter', 'moonshotai/kimi-k3', 1_048_576, 943_718, true],
    ['openai-compatible', 'glm-5.3', 1_000_000, 128_000, false],
    ['openai-compatible', 'glm-5.3-flash', 1_000_000, 128_000, true],
    ['openai-compatible', 'qwen3.8-max', 1_000_000, 131_072, true],
    ['openrouter', 'qwen/qwen3.8-2.4t-a95b', 1_048_576, 131_072, false],
    ['ollama', 'qwen3-vl:8b', 262_144, 4096, true],
    ['ollama', 'gpt-oss:20b', 131_072, 4096, false],
  ];
  it.each(facts)('%s %s', (kind, modelName, contextWindow, maxOutput, vision) => {
    const baseUrl = kind === 'openai-compatible' ? CLOUD_URL : undefined;
    expect(resolveProfile({ kind, modelName, baseUrl })).toMatchObject({ contextWindow, maxOutput, vision });
  });

  it('gives a family row vision, as the newest models of the family have', () => {
    for (const [kind, name] of [
      ['anthropic', 'claude-mystery-9'],
      ['gemini', 'gemini-9-ultra'],
      ['openai-compatible', 'kimi-k4'],
    ] as const) {
      expect(resolveProfile({ kind, modelName: name, baseUrl: CLOUD_URL }).vision).toBe(true);
    }
  });

  it('identifies an unpublished output maximum as a fallback', () => {
    expect(findRow('openai-compatible', 'kimi-k3')?.source).toContain('output maximum unpublished');
    expect(findRow('openai-compatible', 'qwen3.8-omni-flash')?.source).toContain('output maximum unpublished');
  });
});

describe('the send rule', () => {
  it('sends nothing for a model that takes no effort, or an unknown one at None', () => {
    for (const e of REASONING_EFFORTS) expect(sendRule('none', e)).toBeUndefined();
    expect(sendRule(undefined, 'none')).toBeUndefined();
    expect(sendRule(undefined, 'low')).toBe('low');
  });

  it("raises an always model's None to Low, and applies the map last", () => {
    expect(sendRule('always', 'none')).toBe('low');
    const synthetic: CatalogueRow = {
      id: 'synthetic',
      match: /^synthetic$/,
      contextWindow: 1,
      maxOutput: 1,
      vision: false,
      reasoning: 'always',
      wire: { low: 'minimal' },
      checked: '2026-10-10',
      source: 'test',
    };
    expect(sendRule(synthetic.reasoning, 'none', synthetic.wire)).toBe('minimal');
    expect(sendRule(synthetic.reasoning, 'low', synthetic.wire)).toBe('minimal');
    expect(sendRule(synthetic.reasoning, 'high', synthetic.wire)).toBe('high');
    expect(sendRule('optional', 'none')).toBe('none');
  });

  it('applies every row that has a map', () => {
    for (const r of rows.filter(r => r.wire)) {
      for (const e of REASONING_EFFORTS) {
        const level = r.reasoning === 'always' && e === 'none' ? 'low' : e;
        expect(sendRule(r.reasoning, e, r.wire)).toBe(r.wire![level] ?? level);
      }
    }
  });
});

describe('profiles and pairs', () => {
  it('takes each fact from the first source that states it', () => {
    const at = '';
    // tested over fromApi over the row, fact by fact.
    expect(resolveProfile({ kind: 'ollama', modelName: 'qwen3:8b', tested: { reasons: false, at } }).reasoning).toBe(
      'none',
    );
    expect(
      resolveProfile({
        kind: 'ollama',
        modelName: 'mystery',
        fromApi: { reasons: true, acceptsNone: false, at },
        tested: { acceptsNone: true, at },
      }).reasoning,
    ).toBe('optional');
    // A bare "reasons" leaves None to the row: Gemini 2.5 Flash stays optional.
    expect(
      resolveProfile({ kind: 'gemini', modelName: 'gemini-2.5-flash', fromApi: { reasons: true, at } }).reasoning,
    ).toBe('optional');
    // "Reasons" with None unknown is always; a family row states "reasons" only.
    expect(resolveProfile({ kind: 'ollama', modelName: 'mystery', fromApi: { reasons: true, at } }).reasoning).toBe(
      'always',
    );
    expect(
      resolveProfile({ kind: 'anthropic', modelName: 'claude-mystery-9', fromApi: { acceptsNone: true, at } })
        .reasoning,
    ).toBe('optional');
    // Window, output and vision: overrides, then tested, then fromApi, then the row.
    const profile = resolveProfile({
      kind: 'anthropic',
      modelName: 'claude-mystery-9',
      fromApi: { contextWindow: 500_000, maxOutput: 32_000, vision: true, at },
      tested: { vision: false, at },
      overrides: { maxOutput: 8000 },
    });
    expect(profile).toMatchObject({ contextWindow: 500_000, maxOutput: 8000, vision: false });
  });

  it('gives defaults by endpoint, and the count factor by kind', () => {
    expect(resolveProfile({ kind: 'lmstudio', modelName: 'x' })).toMatchObject({
      contextWindow: 16_384,
      vision: false,
    });
    expect(resolveProfile({ kind: 'openrouter', modelName: 'x' })).toMatchObject({
      contextWindow: 128_000,
      vision: true,
    });
    expect(resolveProfile({ kind: 'openai-compatible', modelName: 'x', baseUrl: LOCAL_URL }).contextWindow).toBe(
      16_384,
    );
    expect(resolveProfile({ kind: 'openai-compatible', modelName: 'x', baseUrl: CLOUD_URL }).contextWindow).toBe(
      128_000,
    );
    expect(resolveProfile({ kind: 'anthropic', modelName: 'claude-mystery' }).countFactor).toBe(1.3);
    expect(resolveProfile({ kind: 'anthropic', modelName: 'not-claude' }).countFactor).toBe(1.3);
  });

  it('makes a pair: the setting for a model known to reason, None otherwise', () => {
    expect(makePair('m', 'low', 'optional')).toEqual({ model: 'm', reasoning: 'low' });
    expect(makePair('m', 'high', 'always')).toEqual({ model: 'm', reasoning: 'high' });
    expect(makePair('m', 'low', 'none')).toEqual({ model: 'm', reasoning: 'none' });
    expect(makePair('m', 'low', undefined)).toEqual({ model: 'm', reasoning: 'none' });
  });
});
