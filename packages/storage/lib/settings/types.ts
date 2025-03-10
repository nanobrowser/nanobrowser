export enum AgentNameEnum {
  Planner = 'planner',
  Navigator = 'navigator',
  Validator = 'validator',
}

// Enum for supported LLM providers
export enum LLMProviderEnum {
  OpenAI = 'openai',
  Anthropic = 'anthropic',
  Gemini = 'gemini',
  OpenRouter = 'openrouter',
}

export const llmProviderModelNames: Record<LLMProviderEnum, string[]> = {
  [LLMProviderEnum.OpenAI]: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini', 'o3-mini'],
  [LLMProviderEnum.Anthropic]: ['claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest'],
  [LLMProviderEnum.Gemini]: [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.0-pro-exp-02-05',
    // 'gemini-2.0-flash-thinking-exp-01-21', // TODO: not support function calling for now
  ],
  [LLMProviderEnum.OpenRouter]: [], // Will be populated dynamically from the API
};

/**
 * Creates a mapping of LLM model names to their corresponding providers.
 *
 * This function takes the llmProviderModelNames object and converts it into a new object
 * where each model name is mapped to its corresponding provider.
 */
export const llmModelNamesToProvider = Object.fromEntries(
  Object.entries(llmProviderModelNames).flatMap(([provider, models]) => models.map(model => [model, provider])),
);
