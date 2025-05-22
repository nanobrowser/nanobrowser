// Agent name, used to identify the agent in the settings
export enum AgentNameEnum {
  Planner = 'planner',
  Navigator = 'navigator',
  Validator = 'validator',
}

// Provider type, types before CustomOpenAI are built-in providers, CustomOpenAI is a custom provider
// For built-in providers, we will create ChatModel instances with its respective LangChain ChatModel classes
// For custom providers, we will create ChatModel instances with the ChatOpenAI class
export enum ProviderTypeEnum {
  OpenAI = 'openai',
  Anthropic = 'anthropic',
  DeepSeek = 'deepseek',
  Gemini = 'gemini',
  Grok = 'grok',
  Ollama = 'ollama',
  AzureOpenAI = 'azure_openai',
  OpenRouter = 'openrouter',
  CustomOpenAI = 'custom_openai',
}

// Default supported models for each built-in provider
export const llmProviderModelNames = {
  [ProviderTypeEnum.OpenAI]: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3'],
  [ProviderTypeEnum.Anthropic]: ['claude-3-7-sonnet-latest', 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'],
  [ProviderTypeEnum.DeepSeek]: ['deepseek-chat', 'deepseek-reasoner'],
  [ProviderTypeEnum.Gemini]: [
    'gemini-2.5-flash-preview-05-20',
    'gemini-2.5-pro-preview-05-06',
    'gemini-2.0-flash',
    // 'gemini-2.0-flash-thinking-exp-01-21', // TODO: not support function calling for now
  ],
  [ProviderTypeEnum.Grok]: ['grok-3', 'grok-3-fast', 'grok-3-mini', 'grok-3-mini-fast'],
  [ProviderTypeEnum.Ollama]: ['qwen3:14b', 'falcon3:10b', 'qwen2.5-coder:14b', 'mistral-small:24b'],
  [ProviderTypeEnum.AzureOpenAI]: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3'],
  [ProviderTypeEnum.OpenRouter]: [
    'openai/gpt-4.1',
    'openai/gpt-4.1-mini',
    'openai/o4-mini',
    'openai/gpt-4o-2024-11-20',
    'google/gemini-2.5-flash-preview',
  ],
  // Custom OpenAI providers don't have predefined models as they are user-defined
};

// Default parameters for each agent per provider, for providers not specified, use OpenAI parameters
export const llmProviderParameters = {
  [ProviderTypeEnum.OpenAI]: {
    [AgentNameEnum.Planner]: {
      temperature: 0.7,
      topP: 0.9,
    },
    [AgentNameEnum.Navigator]: {
      temperature: 0.3,
      topP: 0.85,
    },
    [AgentNameEnum.Validator]: {
      temperature: 0.1,
      topP: 0.8,
    },
  },
  [ProviderTypeEnum.Anthropic]: {
    [AgentNameEnum.Planner]: {
      temperature: 0.3,
      topP: 0.6,
    },
    [AgentNameEnum.Navigator]: {
      temperature: 0.2,
      topP: 0.5,
    },
    [AgentNameEnum.Validator]: {
      temperature: 0.1,
      topP: 0.5,
    },
  },
  [ProviderTypeEnum.Gemini]: {
    [AgentNameEnum.Planner]: {
      temperature: 0.7,
      topP: 0.9,
    },
    [AgentNameEnum.Navigator]: {
      temperature: 0.3,
      topP: 0.85,
    },
    [AgentNameEnum.Validator]: {
      temperature: 0.1,
      topP: 0.8,
    },
  },
  [ProviderTypeEnum.Grok]: {
    [AgentNameEnum.Planner]: {
      temperature: 0.7,
      topP: 0.9,
    },
    [AgentNameEnum.Navigator]: {
      temperature: 0.3,
      topP: 0.85,
    },
    [AgentNameEnum.Validator]: {
      temperature: 0.1,
      topP: 0.8,
    },
  },
  [ProviderTypeEnum.Ollama]: {
    [AgentNameEnum.Planner]: {
      temperature: 0.3,
      topP: 0.9,
    },
    [AgentNameEnum.Navigator]: {
      temperature: 0.1,
      topP: 0.85,
    },
    [AgentNameEnum.Validator]: {
      temperature: 0.1,
      topP: 0.8,
    },
  },
  [ProviderTypeEnum.AzureOpenAI]: {
    [AgentNameEnum.Planner]: {
      temperature: 0.7,
      topP: 0.9,
    },
    [AgentNameEnum.Navigator]: {
      temperature: 0.3,
      topP: 0.85,
    },
    [AgentNameEnum.Validator]: {
      temperature: 0.1,
      topP: 0.8,
    },
  },
  [ProviderTypeEnum.OpenRouter]: {
    [AgentNameEnum.Planner]: {
      temperature: 0.7,
      topP: 0.9,
    },
    [AgentNameEnum.Navigator]: {
      temperature: 0.3,
      topP: 0.85,
    },
    [AgentNameEnum.Validator]: {
      temperature: 0.1,
      topP: 0.8,
    },
  },
};
