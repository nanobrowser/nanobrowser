import { describe, it, expect, vi } from 'vitest';
import { ProviderTypeEnum, llmProviderModelNames, llmProviderParameters, AgentNameEnum } from '@extension/storage';
import {
  getProviderTypeByProviderId,
  getDefaultDisplayNameFromProviderId,
  getDefaultProviderConfig,
  getDefaultAgentModelParams,
} from '@extension/storage/lib/settings/llmProviders';

// Mock ChatOpenAI to capture constructor args
const mockChatOpenAI = vi.fn();
vi.mock('@langchain/openai', () => ({
  ChatOpenAI: mockChatOpenAI,
  AzureChatOpenAI: vi.fn(),
}));
vi.mock('@langchain/anthropic', () => ({ ChatAnthropic: vi.fn() }));
vi.mock('@langchain/google-genai', () => ({ ChatGoogleGenerativeAI: vi.fn() }));
vi.mock('@langchain/xai', () => ({ ChatXAI: vi.fn() }));
vi.mock('@langchain/groq', () => ({ ChatGroq: vi.fn() }));
vi.mock('@langchain/cerebras', () => ({ ChatCerebras: vi.fn() }));
vi.mock('@langchain/ollama', () => ({ ChatOllama: vi.fn() }));
vi.mock('@langchain/deepseek', () => ({ ChatDeepSeek: vi.fn() }));

describe('MiniMax Provider - Type Registration', () => {
  it('should have MiniMax in ProviderTypeEnum', () => {
    expect(ProviderTypeEnum.MiniMax).toBe('minimax');
  });

  it('should have MiniMax models defined', () => {
    const models = llmProviderModelNames[ProviderTypeEnum.MiniMax];
    expect(models).toBeDefined();
    expect(models).toContain('MiniMax-M3');
    expect(models).toContain('MiniMax-M2.7');
    expect(models).toContain('MiniMax-M2.7-highspeed');
    expect(models).toHaveLength(3);
  });

  it('should have MiniMax-M3 as the first (default) model', () => {
    const models = llmProviderModelNames[ProviderTypeEnum.MiniMax];
    expect(models[0]).toBe('MiniMax-M3');
    expect(models[1]).toBe('MiniMax-M2.7');
    expect(models[2]).toBe('MiniMax-M2.7-highspeed');
  });

  it('should have MiniMax parameters for Planner agent', () => {
    const params = llmProviderParameters[ProviderTypeEnum.MiniMax];
    expect(params).toBeDefined();
    expect(params[AgentNameEnum.Planner]).toBeDefined();
    expect(params[AgentNameEnum.Planner].temperature).toBe(0.7);
    expect(params[AgentNameEnum.Planner].topP).toBe(0.9);
  });

  it('should have MiniMax parameters for Navigator agent', () => {
    const params = llmProviderParameters[ProviderTypeEnum.MiniMax];
    expect(params[AgentNameEnum.Navigator]).toBeDefined();
    expect(params[AgentNameEnum.Navigator].temperature).toBe(0.3);
    expect(params[AgentNameEnum.Navigator].topP).toBe(0.85);
  });

  it('should have MiniMax parameters with temperature > 0', () => {
    const params = llmProviderParameters[ProviderTypeEnum.MiniMax];
    // MiniMax requires temperature in (0, 1], verify defaults are valid
    expect(params[AgentNameEnum.Planner].temperature).toBeGreaterThan(0);
    expect(params[AgentNameEnum.Planner].temperature).toBeLessThanOrEqual(1);
    expect(params[AgentNameEnum.Navigator].temperature).toBeGreaterThan(0);
    expect(params[AgentNameEnum.Navigator].temperature).toBeLessThanOrEqual(1);
  });
});

describe('MiniMax Provider - Configuration', () => {
  it('should resolve provider type correctly', () => {
    expect(getProviderTypeByProviderId('minimax')).toBe(ProviderTypeEnum.MiniMax);
  });

  it('should return display name "MiniMax"', () => {
    expect(getDefaultDisplayNameFromProviderId('minimax')).toBe('MiniMax');
  });

  it('should return default config with correct baseUrl', () => {
    const config = getDefaultProviderConfig('minimax');
    expect(config.baseUrl).toBe('https://api.minimax.io/v1');
    expect(config.type).toBe(ProviderTypeEnum.MiniMax);
    expect(config.name).toBe('MiniMax');
    expect(config.apiKey).toBe('');
  });

  it('should include MiniMax models in default config', () => {
    const config = getDefaultProviderConfig('minimax');
    expect(config.modelNames).toBeDefined();
    expect(config.modelNames).toContain('MiniMax-M3');
    expect(config.modelNames).toContain('MiniMax-M2.7');
    expect(config.modelNames).toContain('MiniMax-M2.7-highspeed');
  });

  it('should return correct default agent model params', () => {
    const plannerParams = getDefaultAgentModelParams('minimax', AgentNameEnum.Planner);
    expect(plannerParams.temperature).toBe(0.7);
    expect(plannerParams.topP).toBe(0.9);

    const navigatorParams = getDefaultAgentModelParams('minimax', AgentNameEnum.Navigator);
    expect(navigatorParams.temperature).toBe(0.3);
    expect(navigatorParams.topP).toBe(0.85);
  });
});

describe('MiniMax Provider - createChatModel', () => {
  it('should create ChatOpenAI instance for MiniMax provider', async () => {
    // Dynamic import after mocks are set up
    const { createChatModel } = await import('../helper');

    const providerConfig = {
      apiKey: 'test-minimax-key',
      baseUrl: 'https://api.minimax.io/v1',
      name: 'MiniMax',
      type: ProviderTypeEnum.MiniMax,
      modelNames: ['MiniMax-M3'],
    };

    const modelConfig = {
      provider: ProviderTypeEnum.MiniMax,
      modelName: 'MiniMax-M3',
      parameters: { temperature: 0.7, topP: 0.9 },
    };

    createChatModel(providerConfig, modelConfig);

    expect(mockChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'MiniMax-M3',
        apiKey: 'test-minimax-key',
        temperature: 0.7,
        topP: 0.9,
        configuration: expect.objectContaining({
          baseURL: 'https://api.minimax.io/v1',
        }),
      }),
    );
  });

  it('should clamp temperature=0 to 0.01 for MiniMax', async () => {
    const { createChatModel } = await import('../helper');
    mockChatOpenAI.mockClear();

    const providerConfig = {
      apiKey: 'test-key',
      baseUrl: 'https://api.minimax.io/v1',
      type: ProviderTypeEnum.MiniMax,
    };

    const modelConfig = {
      provider: ProviderTypeEnum.MiniMax,
      modelName: 'MiniMax-M2.7',
      parameters: { temperature: 0, topP: 0.5 },
    };

    createChatModel(providerConfig, modelConfig);

    expect(mockChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.01,
      }),
    );
  });

  it('should keep valid temperature values unchanged for MiniMax', async () => {
    const { createChatModel } = await import('../helper');
    mockChatOpenAI.mockClear();

    const providerConfig = {
      apiKey: 'test-key',
      baseUrl: 'https://api.minimax.io/v1',
      type: ProviderTypeEnum.MiniMax,
    };

    const modelConfig = {
      provider: ProviderTypeEnum.MiniMax,
      modelName: 'MiniMax-M2.7-highspeed',
      parameters: { temperature: 0.5, topP: 0.85 },
    };

    createChatModel(providerConfig, modelConfig);

    expect(mockChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'MiniMax-M2.7-highspeed',
        temperature: 0.5,
      }),
    );
  });

  it('should clamp temperature>1 to 1.0 for MiniMax', async () => {
    const { createChatModel } = await import('../helper');
    mockChatOpenAI.mockClear();

    const providerConfig = {
      apiKey: 'test-key',
      baseUrl: 'https://api.minimax.io/v1',
      type: ProviderTypeEnum.MiniMax,
    };

    const modelConfig = {
      provider: ProviderTypeEnum.MiniMax,
      modelName: 'MiniMax-M2.7',
      parameters: { temperature: 1.5, topP: 0.9 },
    };

    createChatModel(providerConfig, modelConfig);

    expect(mockChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 1.0,
      }),
    );
  });
});

describe('MiniMax Provider - Integration Smoke Tests', () => {
  it('should not interfere with other providers in the enum', () => {
    // Verify existing providers are unaffected
    expect(ProviderTypeEnum.OpenAI).toBe('openai');
    expect(ProviderTypeEnum.Anthropic).toBe('anthropic');
    expect(ProviderTypeEnum.DeepSeek).toBe('deepseek');
    expect(ProviderTypeEnum.Gemini).toBe('gemini');
    expect(ProviderTypeEnum.CustomOpenAI).toBe('custom_openai');
  });

  it('should not affect CustomOpenAI as default provider type', () => {
    expect(getProviderTypeByProviderId('unknown_provider')).toBe(ProviderTypeEnum.CustomOpenAI);
  });

  it('should have MiniMax between Llama and CustomOpenAI in getDefaultProviderConfig', () => {
    // MiniMax should use the shared built-in provider config path
    const minimaxConfig = getDefaultProviderConfig('minimax');
    const llamaConfig = getDefaultProviderConfig('llama');
    const customConfig = getDefaultProviderConfig('custom_anything');

    // All should have apiKey
    expect(minimaxConfig.apiKey).toBe('');
    expect(llamaConfig.apiKey).toBe('');
    expect(customConfig.apiKey).toBe('');

    // MiniMax should have its own baseUrl
    expect(minimaxConfig.baseUrl).toBe('https://api.minimax.io/v1');
    expect(llamaConfig.baseUrl).toBe('https://api.llama.com/v1');
    expect(customConfig.baseUrl).toBe('');
  });

  it('should handle MiniMax with default parameters when none specified', async () => {
    const { createChatModel } = await import('../helper');
    mockChatOpenAI.mockClear();

    const providerConfig = {
      apiKey: 'test-key',
      baseUrl: 'https://api.minimax.io/v1',
      type: ProviderTypeEnum.MiniMax,
    };

    const modelConfig = {
      provider: ProviderTypeEnum.MiniMax,
      modelName: 'MiniMax-M3',
      // No parameters - should use defaults
    };

    createChatModel(providerConfig, modelConfig);

    expect(mockChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        // Default temperature from createOpenAIChatModel is 0.1, clamped by MiniMax case
        temperature: 0.1,
      }),
    );
  });
});
