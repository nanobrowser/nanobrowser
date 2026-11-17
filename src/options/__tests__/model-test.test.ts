// Storing a model's test on its entry: a whole test forgets the window and the output limit a run learnt, and reading
// the API alone keeps them.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { providersStorage } from '@src/store/settings';
import type { ProviderConfig } from '@src/store/settings';
import { saveTest } from '../model-test';

/** A chrome.storage.local as a plain map, read into the providers' cache. */
async function fakeChrome(local: Record<string, unknown>) {
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.filter(k => k in local).map(k => [k, local[k]]));
        }),
        set: vi.fn(async (items: Record<string, unknown>) => void Object.assign(local, items)),
        onChanged: { addListener: () => undefined },
      },
    },
  });
  await providersStorage.get();
  return local;
}

afterEach(() => vi.unstubAllGlobals());

const provider = (): ProviderConfig => ({
  id: 'p',
  kind: 'openrouter',
  name: 'OpenRouter',
  models: [{ name: 'm', tested: { maxOutput: 2048, contextWindow: 20_000, vision: false, at: 'then' } }],
});

const tested = (local: Record<string, unknown>) => (local['nb.providers'] as ProviderConfig[])[0].models[0].tested;

describe('saveTest', () => {
  it('forgets the window and the output limit runs learnt when the whole test ran, and keeps the other answers', async () => {
    const local = await fakeChrome({ 'nb.providers': [provider()] });
    await saveTest('p', undefined, 'm', {
      result: { ok: true, toolCalling: true, ms: 1 },
      patch: { noToolCalling: false, tested: { reasons: true } },
    });
    expect(tested(local)).toMatchObject({ vision: false, reasons: true });
    expect(tested(local)).not.toHaveProperty('maxOutput');
    expect(tested(local)).not.toHaveProperty('contextWindow');
  });

  it('forgets it also when the whole test learnt nothing new', async () => {
    const local = await fakeChrome({ 'nb.providers': [provider()] });
    await saveTest('p', undefined, 'm', { result: { ok: true, toolCalling: true, ms: 1 }, patch: {} });
    expect(tested(local)).toEqual({ vision: false, at: 'then' });
  });

  it('keeps it when only the API was read', async () => {
    const local = await fakeChrome({ 'nb.providers': [provider()] });
    await saveTest('p', undefined, 'm', { patch: { fromApi: undefined } });
    expect(tested(local)).toMatchObject({ maxOutput: 2048, contextWindow: 20_000 });
  });
});
