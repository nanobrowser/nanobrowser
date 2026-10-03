import { beforeEach, describe, expect, it, vi } from 'vitest';

// base.ts reads globalThis.chrome when it is imported, so the mock must exist before the import
const store = vi.hoisted(() => {
  const data: Record<string, unknown> = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (keys: string[]) => Object.fromEntries(keys.filter(k => k in data).map(k => [k, data[k]])),
        set: async (items: Record<string, unknown>) => Object.assign(data, items),
        onChanged: { addListener: () => undefined },
      },
    },
  });
  return data;
});

const { llmProviderStore, getDefaultProviderConfig, getDefaultDisplayNameFromProviderId } =
  await import('../llmProviders');
const { ProviderTypeEnum } = await import('../types');

describe('built-in Tongyi QWen provider', () => {
  it('is named and typed so the settings UI offers it', () => {
    expect(getDefaultDisplayNameFromProviderId(ProviderTypeEnum.Qwen)).toBe('Tongyi QWen');
    expect(getDefaultProviderConfig(ProviderTypeEnum.Qwen)).toMatchObject({
      name: 'Tongyi QWen',
      type: ProviderTypeEnum.Qwen,
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    });
  });

  it('starts with the DashScope models prefilled', () => {
    const config = getDefaultProviderConfig(ProviderTypeEnum.Qwen);

    expect(config.modelNames?.length).toBeGreaterThan(0);
  });
});

describe('llmProviderStore.getAllProviders', () => {
  beforeEach(() => {
    store['llm-api-keys'] = {
      providers: {
        openai: { apiKey: 'sk-openai', name: 'OpenAI', type: 'openai', modelNames: ['gpt-5.5'] },
        cerebras: { apiKey: 'csk-secret', name: 'Cerebras', type: 'cerebras', modelNames: ['llama-3.3-70b'] },
        llama: { apiKey: 'llm-secret', name: 'Llama', type: 'llama', modelNames: ['Llama-4-Maverick'] },
        groq: { apiKey: 'gsk-secret', name: 'Groq', type: 'groq', modelNames: ['llama-3.3-70b-versatile'] },
      },
    };
  });

  it('deletes the saved configs of removed providers', async () => {
    const providers = await llmProviderStore.getAllProviders();

    expect(Object.keys(providers)).toEqual(['openai']);
    const saved = store['llm-api-keys'] as { providers: Record<string, unknown> };
    expect(Object.keys(saved.providers)).toEqual(['openai']);
    expect(JSON.stringify(saved)).not.toContain('secret');
  });

  it('leaves storage untouched when no removed provider is saved', async () => {
    const saved = { providers: { openai: { apiKey: 'sk-openai', name: 'OpenAI', type: 'openai', modelNames: [] } } };
    store['llm-api-keys'] = saved;
    const providers = await llmProviderStore.getAllProviders();

    expect(Object.keys(providers)).toEqual(['openai']);
    expect(store['llm-api-keys']).toBe(saved);
  });
});
