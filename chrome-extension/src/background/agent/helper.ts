import { type ProviderConfig, type ModelConfig, ProviderTypeEnum } from '@extension/storage';
import { ChatOpenAI, AzureChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatXAI } from '@langchain/xai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOllama } from '@langchain/ollama';
import { ChatDeepSeek } from '@langchain/deepseek';

const maxTokens = 1024 * 4;

function isOpenAIOModel(modelName: string): boolean {
  return modelName.startsWith('openai/o') || modelName.startsWith('o');
}

function createOpenAIChatModel(
  providerConfig: ProviderConfig,
  modelConfig: ModelConfig,
  // Add optional extra fetch options for headers etc.
  extraFetchOptions?: { headers?: Record<string, string> },
): BaseChatModel {
  const args: {
    model: string;
    apiKey?: string;
    // Configuration should align with ClientOptions from @langchain/openai
    configuration?: {
      baseURL?: string;
      defaultHeaders?: Record<string, string>;
      // Add other ClientOptions if needed, e.g.?
      // dangerouslyAllowBrowser?: boolean;
    };
    modelKwargs?: {
      max_completion_tokens: number;
      reasoning_effort?: 'low' | 'medium' | 'high';
    };
    topP?: number;
    temperature?: number;
    maxTokens?: number;
  } = {
    model: modelConfig.modelName,
    apiKey: providerConfig.apiKey,
    // Initialize configuration object
    configuration: {},
  };

  if (providerConfig.baseUrl) {
    // Set baseURL inside configuration
    args.configuration!.baseURL = providerConfig.baseUrl;
  }

  // Always add custom headers for OpenRouter to identify Nanobrowser
  if (providerConfig.type === ProviderTypeEnum.OpenRouter) {
    args.configuration!.defaultHeaders = {
      ...(args.configuration!.defaultHeaders || {}),
      'HTTP-Referer': 'https://nanobrowser.ai',
      'X-Title': 'Nanobrowser',
      ...(extraFetchOptions?.headers || {}),
    };
  } else if (extraFetchOptions?.headers) {
    args.configuration!.defaultHeaders = {
      ...(args.configuration!.defaultHeaders || {}),
      ...extraFetchOptions.headers,
    };
  }

  // custom provider may have no api key
  if (providerConfig.apiKey) {
    args.apiKey = providerConfig.apiKey;
  }

  // O series models have different parameters
  if (isOpenAIOModel(modelConfig.modelName)) {
    args.modelKwargs = {
      max_completion_tokens: maxTokens,
    };

    // Add reasoning_effort parameter for o-series models if specified
    if (modelConfig.reasoningEffort) {
      args.modelKwargs.reasoning_effort = modelConfig.reasoningEffort;
    }
  } else {
    args.topP = (modelConfig.parameters?.topP ?? 0.1) as number;
    args.temperature = (modelConfig.parameters?.temperature ?? 0.1) as number;
    args.maxTokens = maxTokens;
  }
  // Log args being passed to ChatOpenAI constructor inside the helper
  console.log('[createOpenAIChatModel] Args passed to new ChatOpenAI:', args);
  return new ChatOpenAI(args);
}

// Function to extract instance name from Azure endpoint URL
function extractInstanceNameFromUrl(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    const hostnameParts = parsedUrl.hostname.split('.');
    // Expecting format like instance-name.openai.azure.com
    if (hostnameParts.length >= 4 && hostnameParts[1] === 'openai' && hostnameParts[2] === 'azure') {
      return hostnameParts[0];
    }
  } catch (e) {
    console.error('Error parsing Azure endpoint URL:', e);
  }
  return null;
}

// create a chat model based on the agent name, the model name and provider
export function createChatModel(providerConfig: ProviderConfig, modelConfig: ModelConfig): BaseChatModel {
  const temperature = (modelConfig.parameters?.temperature ?? 0.1) as number;
  const topP = (modelConfig.parameters?.topP ?? 0.1) as number;

  switch (modelConfig.provider) {
    case ProviderTypeEnum.OpenAI: {
      // Call helper without extra options
      return createOpenAIChatModel(providerConfig, modelConfig, undefined);
    }
    case ProviderTypeEnum.Anthropic: {
      const args = {
        model: modelConfig.modelName,
        apiKey: providerConfig.apiKey,
        maxTokens,
        temperature,
        topP,
        clientOptions: {},
      };
      return new ChatAnthropic(args);
    }
    case ProviderTypeEnum.DeepSeek: {
      const args = {
        model: modelConfig.modelName,
        apiKey: providerConfig.apiKey,
        temperature,
        topP,
      };
      return new ChatDeepSeek(args) as BaseChatModel;
    }
    case ProviderTypeEnum.Gemini: {
      const args = {
        model: modelConfig.modelName,
        apiKey: providerConfig.apiKey,
        temperature,
        topP,
      };
      return new ChatGoogleGenerativeAI(args);
    }
    case ProviderTypeEnum.Grok: {
      const args = {
        model: modelConfig.modelName,
        apiKey: providerConfig.apiKey,
        temperature,
        topP,
        maxTokens,
        configuration: {},
      };
      return new ChatXAI(args) as BaseChatModel;
    }
    case ProviderTypeEnum.Ollama: {
      const args: {
        model: string;
        apiKey?: string;
        baseUrl: string;
        modelKwargs?: { max_completion_tokens: number };
        topP?: number;
        temperature?: number;
        maxTokens?: number;
        numCtx: number;
      } = {
        model: modelConfig.modelName,
        // required but ignored by ollama
        apiKey: providerConfig.apiKey === '' ? 'ollama' : providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl ?? 'http://localhost:11434',
        topP,
        temperature,
        maxTokens,
        // ollama usually has a very small context window, so we need to set a large number for agent to work
        // It was set to 128000 in the original code, but it will cause ollama reload the models frequently if you have multiple models working together
        // not sure why, but setting it to 64000 seems to work fine
        // TODO: configure the context window size in model config
        numCtx: 64000,
      };
      return new ChatOllama(args);
    }
    case ProviderTypeEnum.AzureOpenAI: {
      // Validate necessary fields first
      if (
        !providerConfig.baseUrl ||
        !providerConfig.azureDeploymentNames ||
        providerConfig.azureDeploymentNames.length === 0 ||
        !providerConfig.azureApiVersion ||
        !providerConfig.apiKey
      ) {
        throw new Error(
          'Azure configuration is incomplete. Endpoint, Deployment Name, API Version, and API Key are required. Please check settings.',
        );
      }

      // Instead of always using the first deployment name, use the model name from modelConfig
      // which contains the actual model selected in the UI
      const deploymentName = modelConfig.modelName;

      // Validate that the selected model exists in the configured deployments
      if (!providerConfig.azureDeploymentNames.includes(deploymentName)) {
        console.warn(
          `[createChatModel] Selected deployment "${deploymentName}" not found in available deployments. ` +
            `Available: ${JSON.stringify(providerConfig.azureDeploymentNames)}. Using the model anyway.`,
        );
      }

      // Extract instance name from the endpoint URL
      const instanceName = extractInstanceNameFromUrl(providerConfig.baseUrl);
      if (!instanceName) {
        throw new Error(
          `Could not extract Instance Name from Azure Endpoint URL: ${providerConfig.baseUrl}. Expected format like https://<your-instance-name>.openai.azure.com/`,
        );
      }

      // Check if the Azure deployment is using an "o" series model (GPT-4o, etc.)
      const isOSeriesModel = isOpenAIOModel(deploymentName);

      // Use AzureChatOpenAI with specific parameters
      const args = {
        azureOpenAIApiInstanceName: instanceName, // Derived from endpoint
        azureOpenAIApiDeploymentName: deploymentName,
        azureOpenAIApiKey: providerConfig.apiKey,
        azureOpenAIApiVersion: providerConfig.azureApiVersion,
        // For Azure, the model name should be the deployment name itself
        model: deploymentName, // Set model = deployment name to fix Azure requests
        // For O series models, use modelKwargs instead of temperature/topP
        ...(isOSeriesModel
          ? {
              modelKwargs: {
                max_completion_tokens: maxTokens,
                // Add reasoning_effort parameter for Azure o-series models if specified
                ...(modelConfig.reasoningEffort ? { reasoning_effort: modelConfig.reasoningEffort } : {}),
              },
            }
          : {
              temperature,
              topP,
              maxTokens,
            }),
        // DO NOT pass baseUrl or configuration here
      };
      console.log('[createChatModel] Azure args passed to AzureChatOpenAI:', args);
      return new AzureChatOpenAI(args);
    }
    case ProviderTypeEnum.OpenRouter: {
      // Call the helper function, passing OpenRouter headers via the third argument
      console.log('[createChatModel] Calling createOpenAIChatModel for OpenRouter');
      return createOpenAIChatModel(providerConfig, modelConfig, {
        headers: {
          'HTTP-Referer': 'nanobrowser-extension',
          'X-Title': 'NanoBrowser Extension',
        },
      });
    }
    default: {
      // Handles CustomOpenAI
      // by default, we think it's a openai-compatible provider
      // Pass undefined for extraFetchOptions for default/custom cases
      console.log('[createChatModel] Calling createOpenAIChatModel for default/custom provider');
      return createOpenAIChatModel(providerConfig, modelConfig, undefined);
    }
  }
}
