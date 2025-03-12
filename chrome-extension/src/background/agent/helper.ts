import { type ProviderConfig, LLMProviderEnum, AgentNameEnum } from '@extension/storage';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

// create a chat model based on the agent name, the model name and provider
export function createChatModel(
  agentName: string,
  providerName: LLMProviderEnum,
  providerConfig: ProviderConfig,
  modelName: string,
): BaseChatModel {
  const maxTokens = 2000;
  const maxCompletionTokens = 5000;
  let temperature = 0;
  let topP = 0.001;
  switch (providerName) {
    case LLMProviderEnum.OpenAI: {
      if (agentName === AgentNameEnum.Planner) {
        temperature = 0.02;
      }
      const args: any = {
        model: modelName,
        apiKey: providerConfig.apiKey,
        configuration: {},
      };
      if (providerConfig.baseUrl) {
        args.configuration = {
          baseURL: providerConfig.baseUrl,
        };
      }

      // O series models have different parameters
      if (modelName.startsWith('o')) {
        args.modelKwargs = {
          max_completion_tokens: maxCompletionTokens,
        };
      } else {
        args.topP = topP;
        args.temperature = temperature;
        args.maxTokens = maxTokens;
      }
      return new ChatOpenAI(args);
    }
    case LLMProviderEnum.Anthropic: {
      temperature = 0.1;
      topP = 0.1;
      const args = {
        model: modelName,
        apiKey: providerConfig.apiKey,
        maxTokens,
        temperature,
        topP,
        clientOptions: {},
      };
      if (providerConfig.baseUrl) {
        args.clientOptions = {
          baseURL: providerConfig.baseUrl,
        };
      }
      return new ChatAnthropic(args);
    }
    case LLMProviderEnum.Gemini: {
      temperature = 0.5;
      topP = 0.8;
      const args = {
        model: modelName,
        apiKey: providerConfig.apiKey,
        temperature,
        topP,
      };
      return new ChatGoogleGenerativeAI(args);
    }
    case LLMProviderEnum.DeepSeek: {
      // DeepSeek支持OpenAI兼容的API，所以我们可以使用ChatOpenAI
      temperature = 0.3;
      topP = 0.5;
      const args: any = {
        model: modelName,
        apiKey: providerConfig.apiKey,
        temperature,
        topP,
        maxTokens,
        configuration: {},
      };
      
      // 如果提供了自定义的baseUrl，则使用它
      if (providerConfig.baseUrl) {
        args.configuration = {
          baseURL: providerConfig.baseUrl,
        };
      } else {
        // 默认使用DeepSeek的API端点
        args.configuration = {
          baseURL: 'https://api.deepseek.com/v1',
        };
      }
      
      // 确保不使用json_schema响应格式
      args.jsonMode = false;
      
      return new ChatOpenAI(args);
    }
    default: {
      throw new Error(`Provider ${providerName} not supported yet`);
    }
  }
}
