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

const { llmProviderStore, migrateRetiredDeepSeekModelName, migrateRetiredDeepSeekModelNames } =
  await import('../llmProviders');
const { agentModelStore } = await import('../agentModels');
const { AgentNameEnum } = await import('../types');

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

describe('DeepSeek retired model migration (#356)', () => {
  it('maps retired names to deepseek-flash and leaves others alone', () => {
    expect(migrateRetiredDeepSeekModelName('deepseek-chat')).toBe('deepseek-flash');
    expect(migrateRetiredDeepSeekModelName('deepseek-reasoner')).toBe('deepseek-flash');
    expect(migrateRetiredDeepSeekModelName('deepseek-v4-flash')).toBe('deepseek-flash');
    expect(migrateRetiredDeepSeekModelName('deepseek-v4-flash-vision-exp')).toBe('deepseek-flash');
    expect(migrateRetiredDeepSeekModelName('deepseek-v4-pro')).toBe('deepseek-v4-pro');
    expect(migrateRetiredDeepSeekModelName('deepseek-flash')).toBe('deepseek-flash');
  });

  it('dedupes migrated provider model lists', () => {
    expect(
      migrateRetiredDeepSeekModelNames(['deepseek-chat', 'deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-flash']),
    ).toEqual(['deepseek-flash', 'deepseek-v4-pro']);
  });

  it('migrates retired names when reading a saved DeepSeek provider', async () => {
    store['llm-api-keys'] = {
      providers: {
        deepseek: {
          apiKey: 'sk-ds',
          name: 'DeepSeek',
          type: 'deepseek',
          modelNames: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-pro'],
        },
      },
    };
    const providers = await llmProviderStore.getAllProviders();
    expect(providers.deepseek.modelNames).toEqual(['deepseek-flash', 'deepseek-v4-pro']);
    // Migration is in-memory until the next save
    const saved = store['llm-api-keys'] as { providers: { deepseek: { modelNames: string[] } } };
    expect(saved.providers.deepseek.modelNames).toEqual(['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-pro']);
  });

  it('migrates retired planner/navigator model names on read', async () => {
    store['agent-models'] = {
      agents: {
        planner: { provider: 'deepseek', modelName: 'deepseek-chat' },
        navigator: { provider: 'deepseek', modelName: 'deepseek-v4-flash' },
      },
    };
    const planner = await agentModelStore.getAgentModel(AgentNameEnum.Planner);
    const navigator = await agentModelStore.getAgentModel(AgentNameEnum.Navigator);
    expect(planner?.modelName).toBe('deepseek-flash');
    expect(navigator?.modelName).toBe('deepseek-flash');
    const all = await agentModelStore.getAllAgentModels();
    expect(all.planner.modelName).toBe('deepseek-flash');
    expect(all.navigator.modelName).toBe('deepseek-flash');
  });

  it('does not rewrite custom-provider model names that look retired', async () => {
    store['agent-models'] = {
      agents: {
        planner: { provider: 'my-proxy', modelName: 'deepseek-chat' },
      },
    };
    const planner = await agentModelStore.getAgentModel(AgentNameEnum.Planner);
    expect(planner?.modelName).toBe('deepseek-chat');
  });
});
