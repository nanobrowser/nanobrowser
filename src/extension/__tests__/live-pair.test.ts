// Settings and the live pair: the setting's default, the session key, the pair a run uses, the conversation record
// without a model, and the clearing on a base URL change.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { getConversation, updateConversation } from '@src/store/conversations';
import { closeDb, db } from '@src/store/db';
import {
  autoWindow,
  capabilityOf,
  getLive,
  setContextWindow,
  windowFromText,
  learnFacts,
  providersStorage,
  mergeSettings,
  removeLive,
  setLive,
  usableModel,
  withBaseUrl,
  type ProviderConfig,
  type Settings,
} from '@src/store/settings';
import { livePair } from '../models';
import { resolveProfile } from '@src/llm';

/** A chrome.storage with a local and a session area, as plain maps. */
function fakeChrome(local: Record<string, unknown> = {}) {
  const area = (data: Record<string, unknown>) => ({
    get: vi.fn(async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter(k => k in data).map(k => [k, data[k]]));
    }),
    set: vi.fn(async (items: Record<string, unknown>) => void Object.assign(data, items)),
    remove: vi.fn(async (key: string) => void delete data[key]),
    onChanged: { addListener: () => undefined },
  });
  const session: Record<string, unknown> = {};
  vi.stubGlobal('chrome', { storage: { local: area(local), session: area(session) } });
  return { local, session };
}

const PROVIDERS: ProviderConfig[] = [
  { id: 'a', kind: 'anthropic', name: 'Anthropic', models: [{ name: 'claude-sonnet-5-5' }, { name: 'claude-x' }] },
  { id: 'o', kind: 'openai', name: 'OpenAI', models: [{ name: 'gpt-4o' }, { name: 'unknown-model' }] },
  {
    id: 'l',
    kind: 'ollama',
    name: 'Ollama',
    models: [
      { name: 'mystery', reasoningSupport: 'optional' },
      { name: 'tested', tested: { reasons: true, acceptsNone: true, at: '' } },
    ],
  },
];

function settings(patch: Partial<Settings>): Settings {
  return { ...mergeSettings({}), ...patch };
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(async () => {
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
});

describe('settings', () => {
  it('gives Medium to stored settings without the field', () => {
    expect(mergeSettings({ defaultMode: 'auto' }).reasoning).toBe('medium');
    expect(mergeSettings({ reasoning: 'high' }).reasoning).toBe('high');
  });

  it('clears what was learnt about the models when the base URL changes', () => {
    const provider: ProviderConfig = {
      id: 'p',
      kind: 'openai-compatible',
      name: 'P',
      baseUrl: 'http://a/v1',
      models: [
        {
          name: 'm',
          detectedContext: 8192,
          noToolCalling: true,
          reasoningSupport: 'none',
          overrides: { vision: true },
        },
      ],
    };
    expect(withBaseUrl(provider, 'http://a/v1')).toBe(provider);
    expect(withBaseUrl(provider, 'http://b/v1').models).toEqual([{ name: 'm', overrides: { vision: true } }]);
  });

  it("keeps a run's window, and a stated window below the user's number replaces that number", async () => {
    const entry = (overrides: object) => ({ name: 'm', overrides, tested: { vision: false, at: '' } });
    const { local } = fakeChrome({
      'nb.providers': [
        {
          id: 'p',
          kind: 'openrouter',
          name: 'P',
          models: [entry({ contextWindow: 200_000, vision: true }), { ...entry({ contextWindow: 10_000 }), name: 'n' }],
        },
      ],
    });
    await providersStorage.get();
    await learnFacts('p', undefined, 'm', { contextWindow: 131_072 });
    await learnFacts('p', undefined, 'n', { contextWindow: 131_072 });
    const [m, n] = (local['nb.providers'] as ProviderConfig[])[0].models;
    expect(m.tested).toMatchObject({ contextWindow: 131_072, vision: false });
    expect(m.overrides).toEqual({ vision: true });
    // A stated window at or above the user's number leaves it.
    expect(n.overrides).toEqual({ contextWindow: 10_000 });
    await learnFacts('p', undefined, 'm', { contextWindow: 100_000 });
    expect((local['nb.providers'] as ProviderConfig[])[0].models[0].overrides).toEqual({ vision: true });
  });

  it('reads the context window field: empty is Auto, a whole number from 16,384 to 2,000,000 is taken', () => {
    expect(windowFromText('')).toBeNull();
    expect(windowFromText('  ')).toBeNull();
    expect(windowFromText('16384')).toBe(16_384);
    expect(windowFromText('16,383')).toBeUndefined();
    expect(windowFromText('200,000')).toBe(200_000);
    expect(windowFromText('1 048 576')).toBe(1_048_576);
    expect(windowFromText('2000000')).toBe(2_000_000);
    expect(windowFromText('2000001')).toBeUndefined();
    expect(windowFromText('128k')).toBeUndefined();
    expect(windowFromText('-20000')).toBeUndefined();
    // A separator only between groups of three digits: a decimal is not read as digits.
    expect(windowFromText('200.000')).toBe(200_000);
    expect(windowFromText('128000.5')).toBeUndefined();
    expect(windowFromText('100000.0')).toBeUndefined();
    expect(windowFromText('16.5')).toBeUndefined();
  });

  it("shows Auto as the window the model runs at without the user's number", () => {
    const providers: ProviderConfig[] = [
      {
        id: 'a',
        kind: 'anthropic',
        name: 'A',
        models: [
          { name: 'claude-sonnet-5-5', overrides: { contextWindow: 50_000 } },
          { name: 'claude-x', tested: { contextWindow: 90_000, at: '' } },
        ],
      },
      { id: 'l', kind: 'ollama', name: 'L', models: [{ name: 'm', detectedContext: 65_536, detectedLoaded: true }] },
    ];
    // The row, not the user's number; what a run learnt; the window a local server loaded.
    expect(autoWindow(providers, { providerId: 'a', model: 'claude-sonnet-5-5' })).toBe(1_000_000);
    expect(autoWindow(providers, { providerId: 'a', model: 'claude-x' })).toBe(90_000);
    expect(autoWindow(providers, { providerId: 'l', model: 'm' })).toBe(65_536);
    expect(autoWindow(providers, { providerId: 'gone', model: 'm' })).toBeUndefined();
  });

  it("stores the user's window on the model's entry, over every other source, and removes it for Auto", async () => {
    const { local } = fakeChrome({
      'nb.providers': [
        { id: 'p', kind: 'openrouter', name: 'P', models: [{ name: 'm', tested: { contextWindow: 90_000, at: '' } }] },
      ],
    });
    await providersStorage.get();
    const ref = { providerId: 'p', model: 'm' };
    await setContextWindow(ref, 300_000);
    const entry = () => (local['nb.providers'] as ProviderConfig[])[0].models[0];
    expect(entry().overrides).toEqual({ contextWindow: 300_000 });
    expect(resolveProfile({ kind: 'openrouter', modelName: 'm', ...entry() }).contextWindow).toBe(300_000);
    await setContextWindow(ref, null);
    expect(entry()).not.toHaveProperty('overrides');
    expect(entry().tested).toMatchObject({ contextWindow: 90_000 });
  });

  it('reads the capability from the probe, then the catalogue', () => {
    expect(capabilityOf(PROVIDERS, { providerId: 'a', model: 'claude-sonnet-5-5' })).toBe('optional');
    expect(capabilityOf(PROVIDERS, { providerId: 'o', model: 'gpt-4o' })).toBe('none');
    // An unknown Claude name reaches the Claude family: it reasons.
    expect(capabilityOf(PROVIDERS, { providerId: 'a', model: 'claude-x' })).toBe('always');
    expect(capabilityOf(PROVIDERS, { providerId: 'o', model: 'unknown-model' })).toBeUndefined();
    // An older version's stored `optional` reads as "reasons" only, since that probe never proved None.
    expect(capabilityOf(PROVIDERS, { providerId: 'l', model: 'mystery' })).toBe('always');
    expect(capabilityOf(PROVIDERS, { providerId: 'l', model: 'tested' })).toBe('optional');
    expect(capabilityOf(PROVIDERS, { providerId: 'gone', model: 'x' })).toBeUndefined();
  });
});

describe('the live pair', () => {
  it('is kept under nb.live.<id> in storage.session and removed with the conversation', async () => {
    const { session } = fakeChrome();
    const pair = { model: { providerId: 'a', model: 'claude-sonnet-5-5' }, reasoning: 'high' as const };
    await setLive('c1', pair);
    expect(session['nb.live.c1']).toEqual(pair);
    expect(await getLive('c1')).toEqual(pair);
    await removeLive('c1');
    expect(await getLive('c1')).toBeUndefined();
  });

  it('a run uses the key, then a pair made from the settings', async () => {
    fakeChrome({
      'nb.settings': settings({ defaultModel: { providerId: 'a', model: 'claude-sonnet-5-5' }, reasoning: 'medium' }),
      'nb.providers': PROVIDERS,
    });
    // No key: the setting's effort for a model that reasons.
    expect(await livePair('c1')).toEqual({
      model: { providerId: 'a', model: 'claude-sonnet-5-5' },
      reasoning: 'medium',
    });
    // The key wins over the settings, whatever its model.
    const pair = { model: { providerId: 'o', model: 'gpt-4o' }, reasoning: 'low' as const };
    await setLive('c1', pair);
    expect(await livePair('c1')).toEqual(pair);
  });

  it('makes None for a model that does not reason or is unknown, and nothing without any model', async () => {
    fakeChrome({
      'nb.settings': settings({ defaultModel: { providerId: 'o', model: 'gpt-4o' }, reasoning: 'high' }),
      'nb.providers': PROVIDERS,
    });
    expect((await livePair(null))?.reasoning).toBe('none');
    fakeChrome({
      'nb.settings': settings({ defaultModel: { providerId: 'o', model: 'unknown-model' }, reasoning: 'high' }),
      'nb.providers': PROVIDERS,
    });
    expect((await livePair(null))?.reasoning).toBe('none');
    fakeChrome({ 'nb.settings': settings({ defaultModel: null }), 'nb.providers': [] });
    expect(await livePair('c1')).toBeNull();
  });
});

describe('a model that is no longer configured', () => {
  it("falls back to the default model, then the first usable one, keeping the pair's effort", async () => {
    fakeChrome({
      'nb.settings': settings({ defaultModel: { providerId: 'o', model: 'gpt-4o' }, reasoning: 'low' }),
      'nb.providers': PROVIDERS,
    });
    await setLive('c1', { model: { providerId: 'gone', model: 'x' }, reasoning: 'high' });
    expect(await livePair('c1')).toEqual({ model: { providerId: 'o', model: 'gpt-4o' }, reasoning: 'high' });
    fakeChrome({ 'nb.settings': settings({ defaultModel: null, reasoning: 'medium' }), 'nb.providers': PROVIDERS });
    expect(await livePair(null)).toEqual({
      model: { providerId: 'a', model: 'claude-sonnet-5-5' },
      reasoning: 'medium',
    });
  });

  it('skips a model that failed the tool test', () => {
    const providers: ProviderConfig[] = [
      { id: 'p', kind: 'ollama', name: 'P', models: [{ name: 'bad', noToolCalling: true }, { name: 'good' }] },
    ];
    expect(usableModel(providers, { providerId: 'p', model: 'bad' })).toEqual({ providerId: 'p', model: 'good' });
    expect(usableModel([])).toBeNull();
  });
});

describe('the conversation record', () => {
  it('loses the model field of an older record on its next write', async () => {
    const old = {
      id: 'c',
      title: 't',
      createdAt: 'x',
      updatedAt: 'x',
      leafId: null,
      mode: 'ask',
      model: { providerId: 'p', model: 'm' },
      tabs: [],
      status: 'idle',
    };
    await (await db()).put('conversations', old as never);
    await updateConversation('c', { title: 'u' });
    const stored = await getConversation('c');
    expect(stored?.title).toBe('u');
    expect(stored).not.toHaveProperty('model');
  });
});
