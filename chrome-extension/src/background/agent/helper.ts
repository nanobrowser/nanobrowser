import { type ProviderConfig, type ModelConfig, ProviderTypeEnum } from '@extension/storage';
import { ChatOpenAI, AzureChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatXAI } from '@langchain/xai';
import { ChatGroq } from '@langchain/groq';
import { ChatCerebras } from '@langchain/cerebras';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOllama } from '@langchain/ollama';
import { ChatDeepSeek } from '@langchain/deepseek';
import { AIMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';

const maxTokens = 1024 * 4;

// Custom ChatLlama class to handle Llama API response format
class ChatLlama extends ChatOpenAI {
  constructor(args: any) {
    super(args);
  }

  // Override the completionWithRetry method to intercept and transform the response
  async completionWithRetry(request: any, options?: any): Promise<any> {
    try {
      // Make the request using the parent's implementation
      // ChatOpenAI typing does not expose completionWithRetry, call the implementation via prototype to satisfy TS
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (ChatOpenAI.prototype as any).completionWithRetry.call(this, request, options);

      // Check if this is a Llama API response format
      if (response?.completion_message?.content?.text) {
        // Transform Llama API response to OpenAI format
        const transformedResponse = {
          id: response.id || 'llama-response',
          object: 'chat.completion',
          created: Date.now(),
          model: request.model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: response.completion_message.content.text,
              },
              finish_reason: response.completion_message.stop_reason || 'stop',
            },
          ],
          usage: {
            prompt_tokens: response.metrics?.find((m: any) => m.metric === 'num_prompt_tokens')?.value || 0,
            completion_tokens: response.metrics?.find((m: any) => m.metric === 'num_completion_tokens')?.value || 0,
            total_tokens: response.metrics?.find((m: any) => m.metric === 'num_total_tokens')?.value || 0,
          },
        };

        return transformedResponse;
      }

      return response;
    } catch (error: any) {
      console.error(`[ChatLlama] Error during API call:`, error);
      throw error;
    }
  }
}

// O series models or GPT-5 models that support reasoning
function isOpenAIReasoningModel(modelName: string): boolean {
  let modelNameWithoutProvider = modelName;
  if (modelName.startsWith('openai/')) {
    modelNameWithoutProvider = modelName.substring(7);
  }
  return (
    modelNameWithoutProvider.startsWith('o') ||
    (modelNameWithoutProvider.startsWith('gpt-5') && !modelNameWithoutProvider.startsWith('gpt-5-chat'))
  );
}

// Function to check if a model is an Anthropic Opus model
function isAnthropicOpusModel(modelName: string): boolean {
  // Extract the model name without provider prefix if present
  let modelNameWithoutProvider = modelName;
  if (modelName.startsWith('anthropic/')) {
    modelNameWithoutProvider = modelName.substring(10);
  }
  return modelNameWithoutProvider.startsWith('claude-opus');
}

function createOpenAIChatModel(
  providerConfig: ProviderConfig,
  modelConfig: ModelConfig,
  // Add optional extra fetch options for headers etc.
  extraFetchOptions: { headers?: Record<string, string> } | undefined,
): BaseChatModel {
  const args: {
    model: string;
    apiKey?: string;
    // Configuration should align with ClientOptions from @langchain/openai
    configuration?: Record<string, unknown>;
    modelKwargs?: {
      max_completion_tokens: number;
      reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high';
    };
    topP?: number;
    temperature?: number;
    maxTokens?: number;
  } = {
    model: modelConfig.modelName,
    apiKey: providerConfig.apiKey,
  };

  const configuration: Record<string, unknown> = {};

  // Handle base URL with custom query parameters
  // NOTE: LangChain ChatOpenAI automatically appends "/chat/completions" which causes issues with query params
  // We need a special approach for deployment URLs with query parameters
  if (providerConfig.baseUrl) {
    let fullUrl = providerConfig.baseUrl;

    // Check if we have query parameters that need special handling
    if (providerConfig.customQuery && Object.keys(providerConfig.customQuery).length > 0) {
      // For deployment URLs with query parameters, we need to use a custom fetch function
      // to override LangChain's URL construction

      // Create the correct final URL manually
      let correctUrl = providerConfig.baseUrl;

      // Add REST endpoint if provided
      if (providerConfig.restEndpoint) {
        const baseEndsWithSlash = correctUrl.endsWith('/');
        const endpointStartsWithSlash = providerConfig.restEndpoint.startsWith('/');

        if (baseEndsWithSlash && endpointStartsWithSlash) {
          correctUrl = correctUrl + providerConfig.restEndpoint.substring(1);
        } else if (!baseEndsWithSlash && !endpointStartsWithSlash) {
          correctUrl = correctUrl + '/' + providerConfig.restEndpoint;
        } else {
          correctUrl = correctUrl + providerConfig.restEndpoint;
        }
      }

      // Add query parameters
      const url = new URL(correctUrl);
      Object.entries(providerConfig.customQuery).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
      correctUrl = url.toString();

      console.log('[createOpenAIChatModel] Using custom fetch to override URL construction:', {
        baseUrl: providerConfig.baseUrl,
        restEndpoint: providerConfig.restEndpoint,
        queryParams: providerConfig.customQuery,
        correctUrl: correctUrl,
      });

      // Override the fetch function to use our correct URL
      configuration.fetch = async (url: string, init?: RequestInit) => {
        // Replace LangChain's constructed URL with our correct URL
        console.log('[CustomFetch] LangChain wanted to use:', url);
        console.log('[CustomFetch] Using instead:', correctUrl);
        return fetch(correctUrl, init);
      };

      // Set baseURL to just the base part (LangChain will append /chat/completions, but our fetch will override it)
      configuration.baseURL = providerConfig.baseUrl;
    } else {
      // No query parameters, use the simpler approach
      const url = new URL(fullUrl);
      fullUrl = url.toString();
      configuration.baseURL = fullUrl;
    }

    console.log('[createOpenAIChatModel] Final URL configuration:', {
      baseUrl: providerConfig.baseUrl,
      restEndpoint: providerConfig.restEndpoint,
      queryParams: providerConfig.customQuery,
      finalUrl: configuration.baseURL,
      usingCustomFetch: !!configuration.fetch,
    });
  }

  if (extraFetchOptions?.headers) {
    configuration.defaultHeaders = extraFetchOptions.headers;
  }
  args.configuration = configuration;

  // custom provider may have no api key
  if (providerConfig.apiKey) {
    args.apiKey = providerConfig.apiKey;
  }

  // O series models have different parameters
  if (isOpenAIReasoningModel(modelConfig.modelName)) {
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
  console.log('[createOpenAIChatModel] About to create ChatOpenAI with configuration:', {
    model: args.model,
    baseURL: configuration.baseURL,
    headers: configuration.defaultHeaders,
    fullArgs: args,
  });
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

// Function to check if a provider ID is an Azure provider
function isAzureProvider(providerId: string): boolean {
  return providerId === ProviderTypeEnum.AzureOpenAI || providerId.startsWith(`${ProviderTypeEnum.AzureOpenAI}_`);
}

// Function to create an Azure OpenAI chat model
function createAzureChatModel(providerConfig: ProviderConfig, modelConfig: ModelConfig): BaseChatModel {
  const temperature = (modelConfig.parameters?.temperature ?? 0.1) as number;
  const topP = (modelConfig.parameters?.topP ?? 0.1) as number;

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
  const isOSeriesModel = isOpenAIReasoningModel(deploymentName);

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
  // console.log('[createChatModel] Azure args passed to AzureChatOpenAI:', args);
  return new AzureChatOpenAI(args);
}

// create a chat model based on the agent name, the model name and provider
export function createChatModel(providerConfig: ProviderConfig, modelConfig: ModelConfig): BaseChatModel {
  const temperature = (modelConfig.parameters?.temperature ?? 0.1) as number;
  const topP = (modelConfig.parameters?.topP ?? 0.1) as number;

  // Debug logging to help identify the issue
  console.log('[createChatModel] Configuration:', {
    provider: modelConfig.provider,
    modelName: modelConfig.modelName,
    providerType: providerConfig.type,
    baseUrl: providerConfig.baseUrl,
  });

  // Check if the provider is an Azure provider with a custom ID (e.g. azure_openai_2)
  const isAzure = isAzureProvider(modelConfig.provider);

  // If this is any type of Azure provider, handle it with the dedicated function
  if (isAzure) {
    return createAzureChatModel(providerConfig, modelConfig);
  }

  switch (modelConfig.provider) {
    case ProviderTypeEnum.OpenAI: {
      // Call helper with custom headers if available
      const extraHeaders = providerConfig.customHeaders ? { headers: providerConfig.customHeaders } : undefined;
      return createOpenAIChatModel(providerConfig, modelConfig, extraHeaders);
    }
    case ProviderTypeEnum.Anthropic: {
      // For Opus models, only include temperature, not topP
      const args = isAnthropicOpusModel(modelConfig.modelName)
        ? {
            model: modelConfig.modelName,
            apiKey: providerConfig.apiKey,
            maxTokens,
            temperature,
            clientOptions: {
              ...(providerConfig.customHeaders && { defaultHeaders: providerConfig.customHeaders }),
            },
          }
        : {
            model: modelConfig.modelName,
            apiKey: providerConfig.apiKey,
            maxTokens,
            temperature,
            topP,
            clientOptions: {
              ...(providerConfig.customHeaders && { defaultHeaders: providerConfig.customHeaders }),
            },
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
        configuration: {
          ...(providerConfig.customHeaders && { defaultHeaders: providerConfig.customHeaders }),
        },
      };
      return new ChatXAI(args) as BaseChatModel;
    }
    case ProviderTypeEnum.Groq: {
      const args = {
        model: modelConfig.modelName,
        apiKey: providerConfig.apiKey,
        temperature,
        topP,
        maxTokens,
      };
      return new ChatGroq(args);
    }
    case ProviderTypeEnum.Cerebras: {
      const args = {
        model: modelConfig.modelName,
        apiKey: providerConfig.apiKey,
        temperature,
        topP,
        maxTokens,
      };
      return new ChatCerebras(args);
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
    case ProviderTypeEnum.OpenRouter: {
      // Call the helper function, passing OpenRouter headers via the third argument
      console.log('[createChatModel] Calling createOpenAIChatModel for OpenRouter');
      const openRouterHeaders = {
        'HTTP-Referer': 'https://nanobrowser.ai',
        'X-Title': 'Nanobrowser',
        // Merge with custom headers if provided
        ...providerConfig.customHeaders,
      };
      return createOpenAIChatModel(providerConfig, modelConfig, {
        headers: openRouterHeaders,
      });
    }
    case ProviderTypeEnum.Llama: {
      // Llama API has a different response format, use custom ChatLlama class
      const args: {
        model: string;
        apiKey?: string;
        configuration?: Record<string, unknown>;
        topP?: number;
        temperature?: number;
        maxTokens?: number;
      } = {
        model: modelConfig.modelName,
        apiKey: providerConfig.apiKey,
        topP: (modelConfig.parameters?.topP ?? 0.1) as number,
        temperature: (modelConfig.parameters?.temperature ?? 0.1) as number,
        maxTokens,
      };

      const configuration: Record<string, unknown> = {};
      if (providerConfig.baseUrl) {
        let finalUrl = providerConfig.baseUrl;

        // Add REST endpoint if provided (e.g., '/chat/completions')
        if (providerConfig.restEndpoint) {
          // Ensure no double slashes
          const baseEndsWithSlash = finalUrl.endsWith('/');
          const endpointStartsWithSlash = providerConfig.restEndpoint.startsWith('/');

          if (baseEndsWithSlash && endpointStartsWithSlash) {
            finalUrl = finalUrl + providerConfig.restEndpoint.substring(1);
          } else if (!baseEndsWithSlash && !endpointStartsWithSlash) {
            finalUrl = finalUrl + '/' + providerConfig.restEndpoint;
          } else {
            finalUrl = finalUrl + providerConfig.restEndpoint;
          }
        }

        // If custom query parameters are provided, append them to the URL
        if (providerConfig.customQuery && Object.keys(providerConfig.customQuery).length > 0) {
          const url = new URL(finalUrl);
          Object.entries(providerConfig.customQuery).forEach(([key, value]) => {
            url.searchParams.set(key, value);
          });
          finalUrl = url.toString();
        }

        console.log('[createChatModel] Llama Final URL construction:', {
          baseUrl: providerConfig.baseUrl,
          restEndpoint: providerConfig.restEndpoint,
          queryParams: providerConfig.customQuery,
          finalUrl: finalUrl,
        });

        configuration.baseURL = finalUrl;
      }
      // Add custom headers if provided
      if (providerConfig.customHeaders) {
        configuration.defaultHeaders = providerConfig.customHeaders;
      }
      args.configuration = configuration;

      return new ChatLlama(args);
    }
    default: {
      // by default, we think it's a openai-compatible provider
      console.log('[createChatModel] Creating CustomOpenAI model:', {
        provider: modelConfig.provider,
        modelName: modelConfig.modelName,
        providerType: providerConfig.type,
        baseUrl: providerConfig.baseUrl,
        restEndpoint: providerConfig.restEndpoint,
        hasApiKey: !!providerConfig.apiKey,
        hasCustomHeaders: !!providerConfig.customHeaders,
        hasCustomQuery: !!providerConfig.customQuery,
      });

      // For deployment URLs (like Azure-style deployments), handle them specially
      const adjustedConfig = { ...providerConfig };
      let adjustedModelConfig = { ...modelConfig };

      // Check if this looks like a deployment URL pattern
      if (providerConfig.baseUrl && providerConfig.baseUrl.includes('/deployments/')) {
        console.log('[createChatModel] Deployment-style URL detected:', {
          originalUrl: providerConfig.baseUrl,
          restEndpoint: providerConfig.restEndpoint,
        });

        // For deployment URLs, we might need to extract model name from URL
        // But now we'll let the user configure the exact structure with restEndpoint
        // Example: baseUrl = "https://example.com/api/openai/deployments/model-name"
        //          restEndpoint = "/chat/completions"
        //          Final URL = "https://example.com/api/openai/deployments/model-name/chat/completions?params"

        // Extract model name from deployment URL if it follows the pattern
        const deploymentMatch = providerConfig.baseUrl.match(/\/deployments\/([^/?]+)/);
        if (deploymentMatch) {
          const deploymentModel = deploymentMatch[1];
          console.log('[createChatModel] Extracted model from deployment URL:', deploymentModel);

          // Clean the model name - remove common prefixes if needed
          const cleanModel = deploymentModel.replace(/^(google-|microsoft-|openai-)/i, '');
          adjustedModelConfig = {
            ...adjustedModelConfig,
            modelName: cleanModel,
          };
        }
      }

      // Pass custom headers if available
      const extraHeaders = providerConfig.customHeaders ? { headers: providerConfig.customHeaders } : undefined;
      console.log('[createChatModel] Calling createOpenAIChatModel with:', {
        adjustedConfig: {
          baseUrl: adjustedConfig.baseUrl,
          restEndpoint: adjustedConfig.restEndpoint,
          customQuery: adjustedConfig.customQuery,
        },
        adjustedModelConfig: adjustedModelConfig,
        extraHeaders: extraHeaders,
      });
      return createOpenAIChatModel(adjustedConfig, adjustedModelConfig, extraHeaders);
    }
  }
}
