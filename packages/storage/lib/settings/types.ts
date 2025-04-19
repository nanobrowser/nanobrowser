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
  [ProviderTypeEnum.OpenAI]: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o3-mini'],
  [ProviderTypeEnum.Anthropic]: ['claude-3-7-sonnet-latest', 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'],
  [ProviderTypeEnum.DeepSeek]: ['deepseek-chat', 'deepseek-reasoner'],
  [ProviderTypeEnum.Gemini]: [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.5-pro-exp-03-25',
    // 'gemini-2.0-flash-thinking-exp-01-21', // TODO: not support function calling for now
  ],
  [ProviderTypeEnum.Grok]: ['grok-2', 'grok-2-vision'],
  [ProviderTypeEnum.Ollama]: [],
  [ProviderTypeEnum.AzureOpenAI]: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano'],
  [ProviderTypeEnum.OpenRouter]: [
    'openai/gpt-4o-2024-11-20',
    'openai/gpt-4.1',
    'openai/gpt-4.1-mini',
    'openai/gpt-4.1-nano',
    'openai/o4-mini',
    'anthropic/claude-3.5-sonnet',
    'anthropic/claude-3.7-sonnet',
    'google/gemini-2.0-flash-001',
    'deepseek/deepseek-chat-v3-0324:free',
  ],
  // Custom OpenAI providers don't have predefined models as they are user-defined
};

// Default parameters for each agent per provider, for providers not specified, use OpenAI parameters
export const llmProviderParameters = {
  [ProviderTypeEnum.OpenAI]: {
    [AgentNameEnum.Planner]: {
      temperature: 0.01,
      topP: 0.001,
    },
    [AgentNameEnum.Navigator]: {
      temperature: 0,
      topP: 0.001,
    },
    [AgentNameEnum.Validator]: {
      temperature: 0,
      topP: 0.001,
    },
  },
  [ProviderTypeEnum.Anthropic]: {
    [AgentNameEnum.Planner]: {
      temperature: 0.1,
      topP: 0.1,
    },
    [AgentNameEnum.Navigator]: {
      temperature: 0.1,
      topP: 0.1,
    },
    [AgentNameEnum.Validator]: {
      temperature: 0.05,
      topP: 0.1,
    },
  },
  [ProviderTypeEnum.Gemini]: {
    [AgentNameEnum.Planner]: {
      temperature: 0.01,
      topP: 0.1,
    },
    [AgentNameEnum.Navigator]: {
      temperature: 0.01,
      topP: 0.1,
    },
    [AgentNameEnum.Validator]: {
      temperature: 0.1,
      topP: 0.1,
    },
  },
  [ProviderTypeEnum.Grok]: {
    [AgentNameEnum.Planner]: {
      temperature: 0.7,
      topP: 0.9,
    },
    [AgentNameEnum.Navigator]: {
      temperature: 0.7,
      topP: 0.9,
    },
    [AgentNameEnum.Validator]: {
      temperature: 0.7,
      topP: 0.9,
    },
  },
  [ProviderTypeEnum.Ollama]: {
    [AgentNameEnum.Planner]: {
      temperature: 0,
      topP: 0.001,
    },
    [AgentNameEnum.Navigator]: {
      temperature: 0.01,
      topP: 0.001,
    },
    [AgentNameEnum.Validator]: {
      temperature: 0,
      topP: 0.001,
    },
  },
  [ProviderTypeEnum.AzureOpenAI]: {
    [AgentNameEnum.Planner]: {
      temperature: 0.01,
      topP: 0.001,
    },
    [AgentNameEnum.Navigator]: {
      temperature: 0,
      topP: 0.001,
    },
    [AgentNameEnum.Validator]: {
      temperature: 0,
      topP: 0.001,
    },
  },
  [ProviderTypeEnum.OpenRouter]: {
    [AgentNameEnum.Planner]: {
      temperature: 0.01,
      topP: 0.001,
    },
    [AgentNameEnum.Navigator]: {
      temperature: 0,
      topP: 0.001,
    },
    [AgentNameEnum.Validator]: {
      temperature: 0,
      topP: 0.001,
    },
  },
};
