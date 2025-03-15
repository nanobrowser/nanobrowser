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
  Groq = 'groq',
  Grok = 'grok',
}

export const llmProviderModelNames = {
  [LLMProviderEnum.OpenAI]: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini', 'o3-mini', 'deepseek-r1'],
  [LLMProviderEnum.Anthropic]: ['claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest'],
  [LLMProviderEnum.Gemini]: [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.0-pro-exp-02-05',
    // 'gemini-2.0-flash-thinking-exp-01-21', // TODO: not support function calling for now
  ],
  [LLMProviderEnum.Groq]: [
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768',
    'llama2-70b-4096',
    'llama-2-70b-4096',
    'gemma-7b-it',
  ],
  [LLMProviderEnum.Grok]: ['grok-2', 'grok-2-vision'],
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
