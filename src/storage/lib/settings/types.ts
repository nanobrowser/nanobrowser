// Agent name, used to identify the agent in the settings
export enum AgentNameEnum {
  Planner = 'planner',
  Navigator = 'navigator',
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
  Qwen = 'qwen',
  CustomOpenAI = 'custom_openai',
}

// Default supported models for each built-in provider
export const llmProviderModelNames = {
  [ProviderTypeEnum.OpenAI]: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna'],
  [ProviderTypeEnum.Anthropic]: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-haiku-4-5'],
  [ProviderTypeEnum.DeepSeek]: ['deepseek-flash', 'deepseek-v4-pro'],
  [ProviderTypeEnum.Gemini]: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'],
  [ProviderTypeEnum.Grok]: ['grok-4.7'],
  [ProviderTypeEnum.Ollama]: ['qwen3.8', 'qwen3.8:27b-mlx'],
  [ProviderTypeEnum.AzureOpenAI]: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o'],
  [ProviderTypeEnum.OpenRouter]: ['google/gemini-2.5-pro', 'google/gemini-2.5-flash', 'openai/gpt-4o-2024-11-20'],
  [ProviderTypeEnum.Qwen]: ['qwen3-max', 'qwen-max', 'qwen-plus', 'qwen-turbo'],
  // Custom OpenAI providers don't have predefined models as they are user-defined
};
