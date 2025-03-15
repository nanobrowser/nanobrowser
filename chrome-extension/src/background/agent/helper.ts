import { type ProviderConfig, LLMProviderEnum, AgentNameEnum } from '@extension/storage';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatGroq } from '@langchain/groq';
import { ChatXAI } from '@langchain/xai';
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
    case LLMProviderEnum.Groq: {
      temperature = 0.7;
      const args: any = {
        model: modelName,
        apiKey: providerConfig.apiKey,
        temperature,
        maxTokens,
        configuration: {},
        modelKwargs: {
          stop: [],
          stream: false,
        },
      };
      if (providerConfig.baseUrl) {
        args.configuration = {
          baseURL: providerConfig.baseUrl,
        };
      }
      return new ChatGroq(args);
    }
    case LLMProviderEnum.Grok: {
      temperature = 0.7;
      topP = 0.9;
      const args: any = {
        model: modelName,
        apiKey: providerConfig.apiKey,
        temperature,
        topP,
        maxTokens,
        configuration: {},
      };
      if (providerConfig.baseUrl) {
        args.configuration = {
          baseURL: providerConfig.baseUrl,
        };
      }
      return new ChatXAI(args);
    }
    default: {
      throw new Error(`Provider ${providerName} not supported yet`);
    }
  }
}
