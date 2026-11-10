import { afterEach, expect, it, vi } from 'vitest';
import { upgradeJevSettings } from '../jev-upgrade';

function storage(initial: Record<string, unknown>) {
  const data = structuredClone(initial);
  const area = {
    get: vi.fn(async (names: string[]) =>
      Object.fromEntries(
        names.filter(name => Object.hasOwn(data, name)).map(name => [name, structuredClone(data[name])]),
      ),
    ),
    set: vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(data, structuredClone(values));
    }),
    remove: vi.fn(async (name: string) => {
      delete data[name];
    }),
  };
  vi.stubGlobal('chrome', { storage: { local: area } });
  return { data, area };
}
afterEach(() => vi.unstubAllGlobals());

it('moves legacy settings, routing refs and a separate key in one write before cleanup', async () => {
  const { data, area } = storage({
    'jev-settings': {
      enabled: true,
      apiKey: ' old-key ',
      model: 'jev-latest',
      routingEnabled: true,
      fastModel: { provider: 'openai', modelName: 'fast', reasoningEffort: 'low' },
      capableModel: { provider: 'missing', modelName: 'capable' },
      extra: 'not-config',
    },
    'nb.providers': [{ id: 'openai', kind: 'openai', name: 'OpenAI', models: [{ name: 'fast' }] }],
    'nb.keys': { openai: 'chat-key' },
  });
  await upgradeJevSettings();
  expect(data['nb.jev']).toMatchObject({
    enabled: true,
    routingEnabled: true,
    fastModel: { providerId: 'openai', model: 'fast' },
  });
  expect(data['nb.jev']).not.toHaveProperty('apiKey');
  expect(data['nb.jev']).not.toHaveProperty('capableModel');
  expect(data['nb.jev']).not.toHaveProperty('extra');
  expect(data['nb.keys']).toEqual({ openai: 'chat-key', 'jev-decision': 'old-key' });
  expect(data).not.toHaveProperty('jev-settings');
  expect(area.set).toHaveBeenCalledTimes(1);
  expect(area.set.mock.invocationCallOrder[0]).toBeLessThan(area.remove.mock.invocationCallOrder[0]);
});

it('leaves malformed legacy settings untouched and optional decisions disabled', async () => {
  const { data, area } = storage({ 'jev-settings': { enabled: 'yes', apiKey: 'private-key', proceedThreshold: 2 } });
  await expect(upgradeJevSettings()).resolves.toBeUndefined();
  expect(data).not.toHaveProperty('nb.jev');
  expect(data).not.toHaveProperty('nb.keys');
  expect(data).toHaveProperty('jev-settings');
  expect(area.set).not.toHaveBeenCalled();
  expect(area.remove).not.toHaveBeenCalled();
});

it('preserves current settings and keys, including a key the user intentionally cleared', async () => {
  for (const key of ['new-key', '']) {
    const current = { enabled: false, model: 'new-choice' };
    const { data } = storage({
      'jev-settings': { enabled: true, apiKey: 'old-key' },
      'nb.jev': current,
      'nb.keys': { 'jev-decision': key },
    });
    await upgradeJevSettings();
    expect(data['nb.jev']).toEqual(current);
    expect(data['nb.keys']).toEqual({ 'jev-decision': key });
    expect(data).not.toHaveProperty('jev-settings');
  }
});

it('retains legacy credentials after a failed write and retries safely on the next call', async () => {
  const { data, area } = storage({ 'jev-settings': { apiKey: 'old-key' } });
  area.set.mockRejectedValueOnce(new Error('storage write failed'));
  await expect(upgradeJevSettings()).rejects.toThrow('storage write failed');
  expect(data).toHaveProperty('jev-settings');
  expect(data).not.toHaveProperty('nb.jev');
  expect(area.remove).not.toHaveBeenCalled();
  await upgradeJevSettings();
  expect(data['nb.jev']).toMatchObject({ enabled: false });
  expect(data['nb.keys']).toEqual({ 'jev-decision': 'old-key' });
  expect(data).not.toHaveProperty('jev-settings');
});

it('does not resurrect a cleared key when cleanup is retried after settings were written', async () => {
  const { data, area } = storage({ 'jev-settings': { apiKey: 'old-key' } });
  area.remove.mockRejectedValueOnce(new Error('cleanup failed'));
  await expect(upgradeJevSettings()).rejects.toThrow('cleanup failed');
  expect(data).toHaveProperty('nb.jev');
  data['nb.keys'] = {};
  await upgradeJevSettings();
  expect(data['nb.keys']).toEqual({});
  expect(data).not.toHaveProperty('jev-settings');
});

it('preserves routing effort choices with v0.3 levels and keeps explicit None', async () => {
  const { data } = storage({
    'jev-settings': {
      fastModel: { provider: 'openai', modelName: 'fast', reasoningEffort: 'xhigh' },
      capableModel: { provider: 'openai', modelName: 'capable', reasoningEffort: 'none' },
    },
    'nb.providers': [{ id: 'openai', models: [{ name: 'fast' }, { name: 'capable' }] }],
  });
  await upgradeJevSettings();
  expect(data['nb.jev']).toMatchObject({ fastReasoning: 'high', capableReasoning: 'none' });
});
