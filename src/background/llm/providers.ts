import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogle } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import {
  type ProviderConfig,
  type ModelConfig,
  type ReasoningEffort,
  ProviderTypeEnum,
  QWEN_BASE_URL,
  getDefaultReasoningEffort,
  getProviderTypeByProviderId,
  normalizeReasoningEffort,
} from '@extension/storage';
import type { ChatModel, StructuredMode } from './types';

const maxTokens = 1024 * 4;
const defaultOpenRouterBaseUrl = 'https://openrouter.ai/api/v1';
const defaultOllamaBaseUrl = 'http://localhost:11434/v1';

export interface CreateChatModelOptions {
  /** Custom fetch, used by tests to inspect requests */
  fetch?: typeof fetch;
}

/** A reasoning effort that is sent; 'none' sends nothing */
type SentReasoningEffort = Exclude<ReasoningEffort, 'none'>;

// O series, GPT-5 or GPT-6 models that support reasoning
export function isOpenAIReasoningModel(modelName: string): boolean {
  let modelNameWithoutProvider = modelName;
  if (modelName.startsWith('openai/')) {
    modelNameWithoutProvider = modelName.substring(7);
  }
  return (
    modelNameWithoutProvider.startsWith('o') ||
    (modelNameWithoutProvider.startsWith('gpt-5') && !modelNameWithoutProvider.startsWith('gpt-5-chat')) ||
    modelNameWithoutProvider.startsWith('gpt-6')
  );
}

// Llama models don't support json_schema response format or reliable tool calling
function isLlamaModel(modelName: string): boolean {
  return modelName.includes('Llama-4') || modelName.includes('Llama-3.3') || modelName.includes('llama-3.3');
}

/**
 * Decide how structured output is requested, matching the mechanism LangChain used per provider.
 */
export function getStructuredMode(provider: string, modelName: string): StructuredMode {
  if (isLlamaModel(modelName)) {
    return 'text';
  }
  switch (provider) {
    // Not native: newer Claude models reject forced tool use, so the SDK would replace jsonTool with strict
    // structured outputs, whose limits (24 optional parameters) the navigator schema exceeds
    case ProviderTypeEnum.Anthropic:
    case ProviderTypeEnum.Grok:
    case ProviderTypeEnum.DeepSeek:
      return 'tool';
    // DashScope implements response_format json_object but not the json_schema of native structured outputs,
    // so the reply is read as text and parsed, with JSON Output keeping it syntactically valid
    case ProviderTypeEnum.Qwen:
      return 'text';
    default:
      return 'native';
  }
}

/**
 * The reasoning effort to send, or undefined for none. A model without a saved effort uses its provider's default:
 * none for OpenRouter, Ollama and custom OpenAI-compatible providers, low for the others.
 */
export function getReasoningEffort(
  providerConfig: ProviderConfig,
  modelConfig: ModelConfig,
): SentReasoningEffort | undefined {
  const saved = normalizeReasoningEffort(modelConfig.reasoningEffort);
  const effort =
    saved ?? getDefaultReasoningEffort(providerConfig.type ?? getProviderTypeByProviderId(modelConfig.provider));
  return effort === 'none' ? undefined : effort;
}

// The grok-4.20 reasoning and non-reasoning models reject reasoning effort, matching supportsReasoningEffort
// in @ai-sdk/xai 5.0.14 (not exported); recheck on upgrades.
function acceptsGrokReasoningEffort(modelName: string): boolean {
  return !/^grok-4\.20(-\d{4})?-(non-)?reasoning$/.test(modelName);
}

// xhigh came with gpt-5.2, so earlier GPT-5 models and the o-series top out at high
function acceptsOpenAIXhigh(modelName: string): boolean {
  return /gpt-6/.test(modelName) || /gpt-5\.([2-9]|\d{2,})/.test(modelName);
}

// Map xhigh to high on OpenAI reasoning models that don't support it
function getOpenAIReasoningEffort(modelName: string, effort: SentReasoningEffort) {
  return effort === 'xhigh' && !acceptsOpenAIXhigh(modelName) ? ('high' as const) : effort;
}

/**
 * Settings and provider options shared by the OpenAI chat-completions family (OpenAI, Azure, custom endpoints).
 * Reasoning models get a reasoning effort; other models get one only from custom endpoints (`anyModelReasons`),
 * since OpenAI and Azure reject it for them. `strictJsonSchema: false` keeps the navigator's dynamic schema
 * (optional action keys) acceptable.
 */
function getOpenAIFamilyOptions(
  modelName: string,
  effort: SentReasoningEffort | undefined,
  { anyModelReasons }: { anyModelReasons: boolean },
): Pick<ChatModel, 'settings' | 'providerOptions'> {
  const reasoningModel = isOpenAIReasoningModel(modelName);
  // Custom endpoints serving other models get the chosen effort as is
  const reasoningEffort = !effort
    ? undefined
    : reasoningModel
      ? getOpenAIReasoningEffort(modelName, effort)
      : anyModelReasons
        ? effort
        : undefined;
  return {
    settings: { maxOutputTokens: maxTokens },
    providerOptions: {
      openai: {
        ...(reasoningModel ? { forceReasoning: true } : {}),
        strictJsonSchema: false,
        ...(reasoningEffort ? { reasoningEffort } : {}),
      },
    },
  };
}

/**
 * The OpenAI-compatible endpoint of an Ollama server. New configs default to `http://localhost:11434/v1`;
 * configs saved before Ollama used `/v1` hold the server URL, so `/v1` is added unless the URL ends with it.
 */
export function getOllamaBaseUrl(baseUrl?: string): string {
  const url = (baseUrl?.trim() || defaultOllamaBaseUrl).replace(/\/+$/, '');
  return url.endsWith('/v1') ? url : `${url}/v1`;
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

function createAzureChatModel(
  providerConfig: ProviderConfig,
  modelConfig: ModelConfig,
  options: CreateChatModelOptions,
): ChatModel {
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

  // The model name from modelConfig is the deployment selected in the UI
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

  const azure = createAzure({
    resourceName: instanceName,
    apiKey: providerConfig.apiKey,
    apiVersion: providerConfig.azureApiVersion,
    useDeploymentBasedUrls: true,
    fetch: options.fetch,
  });

  return {
    provider: modelConfig.provider,
    modelName: deploymentName,
    model: azure.chat(deploymentName),
    ...getOpenAIFamilyOptions(deploymentName, getReasoningEffort(providerConfig, modelConfig), {
      anyModelReasons: false,
    }),
    structuredMode: getStructuredMode(modelConfig.provider, deploymentName),
  };
}

/**
 * Create a chat model handle from the stored provider and model settings.
 * The provider is chosen by the provider id (`modelConfig.provider`), as before the AI SDK migration.
 */
export function createChatModel(
  providerConfig: ProviderConfig,
  modelConfig: ModelConfig,
  options: CreateChatModelOptions = {},
): ChatModel {
  if (isAzureProvider(modelConfig.provider)) {
    return createAzureChatModel(providerConfig, modelConfig, options);
  }

  const { provider, modelName } = modelConfig;
  const effort = getReasoningEffort(providerConfig, modelConfig);
  const apiKey = providerConfig.apiKey;
  const fetch = options.fetch;
  const base = { provider, modelName, structuredMode: getStructuredMode(provider, modelName) };

  switch (provider) {
    case ProviderTypeEnum.Anthropic: {
      const anthropic = createAnthropic({
        apiKey,
        // The service worker sends an Origin header, so Anthropic requires this opt-in for browser access
        headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
        fetch,
      });
      return {
        ...base,
        model: anthropic(modelName),
        settings: { maxOutputTokens: maxTokens, reasoning: effort },
        // Claude rejects a forced tool choice while thinking
        autoToolChoice: effort !== undefined,
      };
    }
    case ProviderTypeEnum.DeepSeek: {
      const deepseek = createDeepSeek({ apiKey, fetch });
      // V4 models think by default, even without an effort. DeepSeek rejects a forced tool choice (HTTP 400)
      // while thinking is on, so the output is parsed from text, with JSON Output guaranteeing valid JSON
      return {
        ...base,
        model: deepseek(modelName),
        settings: { reasoning: effort },
        structuredMode: 'text',
        jsonOutput: true,
      };
    }
    case ProviderTypeEnum.Gemini: {
      const google = createGoogle({ apiKey, fetch });
      return {
        ...base,
        model: google(modelName),
        settings: { reasoning: effort },
      };
    }
    case ProviderTypeEnum.Grok: {
      const xai = createXai({ apiKey, fetch });
      return {
        ...base,
        model: xai(modelName),
        settings: { maxOutputTokens: maxTokens },
        providerOptions: {
          xai: {
            // The Responses API stores prompts and responses for 30 days by default; history is kept locally instead
            store: false,
            // xAI defaults to high effort, which is slow for every agent step. The effort is sent as is, since
            // the AI SDK's reasoning setting maps xhigh to high on grok-4.7
            ...(effort && acceptsGrokReasoningEffort(modelName) ? { reasoningEffort: effort } : {}),
          },
        },
      };
    }
    case ProviderTypeEnum.Ollama: {
      // The OpenAI-compatible API can't set num_ctx per request, so the context length comes from the server.
      // Models that reject response formats (MLX runner) fall back to tool mode in generateStructured.
      const ollama = createOpenAI({
        apiKey: apiKey || 'ollama',
        baseURL: getOllamaBaseUrl(providerConfig.baseUrl),
        fetch,
      });
      return {
        ...base,
        model: ollama.chat(modelName),
        settings: { maxOutputTokens: maxTokens },
        providerOptions: { openai: { strictJsonSchema: false, ...(effort ? { reasoningEffort: effort } : {}) } },
      };
    }
    case ProviderTypeEnum.OpenRouter: {
      const openrouter = createOpenRouter({
        apiKey,
        baseURL: providerConfig.baseUrl || defaultOpenRouterBaseUrl,
        headers: {
          'HTTP-Referer': 'https://nanobrowser.ai',
          'X-Title': 'Nanobrowser',
        },
        fetch,
      });
      // The OpenRouter provider ignores the AI SDK's reasoning setting, so the effort goes in its provider options
      return {
        ...base,
        model: openrouter.chat(modelName, { structuredOutputs: { strict: false } }),
        settings: { maxOutputTokens: maxTokens },
        providerOptions: effort ? { openrouter: { reasoning: { effort } } } : undefined,
      };
    }
    case ProviderTypeEnum.Qwen: {
      // Tongyi QWen is served by Alibaba Cloud DashScope over an OpenAI-compatible chat completions API
      const qwen = createOpenAI({
        apiKey,
        baseURL: providerConfig.baseUrl || QWEN_BASE_URL,
        fetch,
      });
      // getStructuredMode returns 'text' for Qwen, and JSON Output requests response_format json_object, the only
      // structured output DashScope supports. No reasoning effort is sent: the endpoint does not document it.
      return {
        ...base,
        model: qwen.chat(modelName),
        settings: { maxOutputTokens: maxTokens },
        structuredMode: 'text',
        jsonOutput: true,
      };
    }
    default: {
      // OpenAI and any custom id are treated as OpenAI-compatible chat completions endpoints
      const openai = createOpenAI({
        apiKey,
        ...(providerConfig.baseUrl ? { baseURL: providerConfig.baseUrl } : {}),
        fetch,
      });
      return {
        ...base,
        model: openai.chat(modelName),
        ...getOpenAIFamilyOptions(modelName, effort, {
          anyModelReasons:
            (providerConfig.type ?? getProviderTypeByProviderId(provider)) === ProviderTypeEnum.CustomOpenAI,
        }),
      };
    }
  }
}

/**
 * Gemini model used for speech-to-text transcription
 */
export function createSpeechToTextModel(provider: string, apiKey: string, modelName: string): ChatModel {
  const google = createGoogle({ apiKey });
  return {
    provider,
    modelName,
    model: google(modelName),
    settings: {},
    structuredMode: 'native',
  };
}
