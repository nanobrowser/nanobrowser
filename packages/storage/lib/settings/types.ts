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
}

// 添加动态模型列表接口
export interface ModelInfo {
  id: string;
  created: number;
  owned_by: string;
}

export interface ModelsResponse {
  data: ModelInfo[];
}

// 修改现有的模型列表为动态获取
export const llmProviderModelNames = {
  [LLMProviderEnum.OpenAI]: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini', 'o3-mini', 'deepseek-r1'], // 会动态获取
  [LLMProviderEnum.Anthropic]: ['claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest'],
  [LLMProviderEnum.Gemini]: [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.0-pro-exp-02-05',
    // 'gemini-2.0-flash-thinking-exp-01-21', // TODO: not support function calling for now
  ],
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

// 添加获取模型列表的函数
export async function fetchOpenAIModels(apiKey: string, baseUrl?: string): Promise<string[]> {
  const url = baseUrl ? `${baseUrl}/models` : 'https://api.openai.com/v1/models';

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`);
    }

    const data: ModelsResponse = await response.json();

    // 过滤并返回支持的模型
    return data.data.map(model => model.id);
  } catch (error) {
    console.error('Error fetching OpenAI models:', error);
    return [];
  }
}
