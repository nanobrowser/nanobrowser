import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_JEV_SETTINGS, jevSettingsStorage, validateJevSettings } from '../jev';

describe('Jev settings', () => {
  it('starts disabled with the preserved confidence and timeout defaults', () => {
    expect(validateJevSettings(undefined)).toEqual({
      enabled: false,
      model: 'jev-latest',
      timeoutMs: 10_000,
      proceedThreshold: 0.8,
      completionThreshold: 0.9,
      selectionThreshold: 0.8,
      routingEnabled: false,
      system1Enabled: false,
    });
    expect(validateJevSettings({})).toEqual(DEFAULT_JEV_SETTINGS);
  });
});

it('normalizes routing references and excludes credentials or unrelated fields from configuration', () => {
  const settings = validateJevSettings({
    enabled: true,
    model: ' jev-custom ',
    routingEnabled: true,
    system1Enabled: true,
    fastModel: { providerId: ' fast-provider ', model: ' fast-model ', apiKey: 'private routing key' },
    capableModel: { providerId: ' capable-provider ', model: ' capable-model ' },
    apiKey: 'private Jev key',
    unrelated: 'discard this',
  });
  expect(settings).toEqual({
    ...DEFAULT_JEV_SETTINGS,
    enabled: true,
    model: 'jev-custom',
    routingEnabled: true,
    system1Enabled: true,
    fastModel: { providerId: 'fast-provider', model: 'fast-model' },
    capableModel: { providerId: 'capable-provider', model: 'capable-model' },
  });
  expect(JSON.stringify(settings)).not.toContain('private');
});

it('rejects invalid types, bounds and routing references with safe errors', () => {
  const invalid = [
    42,
    'private input',
    [],
    { enabled: 'private input' },
    { routingEnabled: 1 },
    { system1Enabled: null },
    { model: ' ' },
    { model: 3 },
    { timeoutMs: 999 },
    { timeoutMs: 60_001 },
    { timeoutMs: 1500.5 },
    { timeoutMs: Number.POSITIVE_INFINITY },
    { proceedThreshold: -0.01 },
    { completionThreshold: 1.01 },
    { selectionThreshold: Number.NaN },
    { fastModel: { providerId: ' ', model: 'model' } },
    { capableModel: { provider: 'legacy', modelName: 'model' } },
    { fastModel: null },
  ];
  for (const settings of invalid) {
    expect(() => validateJevSettings(settings)).toThrowError(
      /^Invalid Jev (settings|confidence threshold|routing model)\.$/,
    );
  }
  expect(validateJevSettings({ timeoutMs: 1_000, proceedThreshold: 0 })).toMatchObject({
    timeoutMs: 1_000,
    proceedThreshold: 0,
  });
  expect(validateJevSettings({ timeoutMs: 60_000, completionThreshold: 1 })).toMatchObject({
    timeoutMs: 60_000,
    completionThreshold: 1,
  });
});

it('fails closed to disabled defaults when persisted configuration is malformed', async () => {
  vi.stubGlobal('chrome', {
    storage: { local: { get: async () => ({ 'nb.jev': { enabled: true, proceedThreshold: -1 } }) } },
  });
  try {
    await expect(jevSettingsStorage.get()).resolves.toEqual(DEFAULT_JEV_SETTINGS);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('preserves optional routed reasoning choices within the v0.3 scale', () => {
  expect(validateJevSettings({ fastReasoning: 'low', capableReasoning: 'high' })).toMatchObject({
    fastReasoning: 'low',
    capableReasoning: 'high',
  });
  for (const reasoning of ['none', 'low', 'medium', 'high']) {
    expect(validateJevSettings({ fastReasoning: reasoning, capableReasoning: reasoning })).toMatchObject({
      fastReasoning: reasoning,
      capableReasoning: reasoning,
    });
  }
  expect(validateJevSettings({})).not.toHaveProperty('fastReasoning');
  for (const invalid of ['xhigh', '', null, 2]) {
    expect(() => validateJevSettings({ fastReasoning: invalid })).toThrow('Invalid Jev reasoning effort.');
    expect(() => validateJevSettings({ capableReasoning: invalid })).toThrow('Invalid Jev reasoning effort.');
  }
});
