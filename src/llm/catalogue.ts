// Every model fact the extension knows, as data. No model-specific condition lives anywhere else. The file is pure
// TypeScript with type-only imports, so the smoke script (fixtures/smoke-models.mjs) runs it in Node without a build.
import type { LanguageModelCallOptions } from 'ai';
import type { ProviderKind } from './providers';

/** Whether a model reasons, and whether None is accepted on the wire. Absent means unknown. */
export type ReasoningSupport = 'none' | 'optional' | 'always';
/** The one setting the user sees. */
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';

/** The `reasoning` values the extension may send (never the SDK's `max`); the compiler holds each to the SDK's type. */
export const WIRE_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly NonNullable<LanguageModelCallOptions['reasoning']>[];
export type WireEffort = (typeof WIRE_EFFORTS)[number];

export const REASONING_EFFORTS: readonly ReasoningEffort[] = ['none', 'low', 'medium', 'high'];

export interface CatalogueRow {
  /** Stable; named by the catalogue's tests and the smoke report. */
  id: string;
  /**
   * Tested against the model name. An exact row sees the name with only an OpenRouter-style `vendor/` prefix removed;
   * a range or family row sees it cleaned (`cleanName`). A range row's regex has a named group `v`, the version.
   */
  match: RegExp;
  /** A range row: the first version it applies to, as `major.minor`. */
  since?: string;
  /** A family row: the facts of the vendor's newest models; its `reasoning` says only that the model reasons. */
  family?: true;
  /** The row applies on these kinds only; absent means every kind. */
  kinds?: ProviderKind[];
  contextWindow: number;
  maxOutput: number;
  vision: boolean;
  /** Absent means unknown. */
  reasoning?: ReasoningSupport;
  /** What an effort becomes on the wire where the vendor's scale differs; applied last. */
  wire?: Partial<Record<ReasoningEffort, WireEffort>>;
  /** The day the row was last checked, and against what: a URL, or an SDK package, version and function. */
  checked: string;
  source: string;
}

export interface CatalogueDefaults {
  /** The kinds that are always a local server; the OpenAI-compatible card is local or cloud by its host. */
  localKinds: ProviderKind[];
  local: { contextWindow: number; maxOutput: number; vision: boolean };
  /** An unknown name on a cloud endpoint: a new model of a vendor whose models see images. */
  cloud: { contextWindow: number; maxOutput: number; vision: boolean };
  /** Tokens the provider counts per token estimated at 4 characters, by kind. */
  countFactor: Partial<Record<ProviderKind, number>>;
}

export const defaults: CatalogueDefaults = {
  localKinds: ['ollama', 'lmstudio'],
  local: { contextWindow: 16_384, maxOutput: 4096, vision: false },
  cloud: { contextWindow: 128_000, maxOutput: 8192, vision: true },
  countFactor: { anthropic: 1.3 },
};

const cloud = (contextWindow: number, maxOutput: number, vision = true) => ({ contextWindow, maxOutput, vision });
const local = (contextWindow: number, vision = false) => ({ contextWindow, maxOutput: 4096, vision });
const D = '2026-10-10';
/** The local-server kinds: a row scoped to them says nothing about the same name on a cloud endpoint. */
const LOCAL: ProviderKind[] = ['ollama', 'lmstudio'];
const UNCHECKED = 'carried over from the old catalogue, unchecked';
const FAMILY = 'the vendor family: the facts of its newest models, for a name no other row fits';
/** A version group: `5`, `5.4`, or `4-6` as Anthropic writes 4.6. */
const V = String.raw`(?<v>\d+(?:[.-]\d{1,2})?)`;
const range = (pattern: string) => new RegExp(`^${pattern.replace('V', V)}$`);

/**
 * In table order, the first row that fits is the row: within each vendor the exceptions, then the version ranges,
 * newest first, then the family row. Windows and output limits are the models' maxima or documented endpoint limits
 * on the checked date; a source says where a number is a cautious fallback. A local server loads less, and detection
 * lowers the window. The request's own output cap is `requestOutputLimit`.
 */
// One row per line, so a change to a model is a one-line diff.
// prettier-ignore
export const rows: CatalogueRow[] = [
  // Anthropic: https://platform.claude.com/docs/en/models/overview, api.anthropic.com/v1/models, and @ai-sdk/anthropic 4.0.71
  { id: 'claude-fable', match: /^claude-fable-/, ...cloud(1_000_000, 128_000), reasoning: 'always', checked: D, source: 'https://platform.claude.com/docs/en/models/overview' },
  { id: 'claude-opus-4-legacy', match: /^claude-opus-4(?:[-.]1|-0)?(?:-\d{8})?$/, ...cloud(200_000, 32_000), reasoning: 'optional', checked: D, source: '@ai-sdk/anthropic@4.0.71 getModelCapabilities (Opus 4 and 4.1)' },
  { id: 'claude-3', match: /^claude-3-(opus|sonnet|haiku)|^claude-3-5-/, ...cloud(200_000, 8192), reasoning: 'none', checked: D, source: 'https://platform.claude.com/docs/en/about-claude/models/overview (Claude 3 and 3.5 have no extended thinking)' },
  { id: 'claude-opus-5-5', match: range('claude-opus-V'), since: '5.5', ...cloud(1_000_000, 128_000), reasoning: 'always', checked: D, source: 'https://api.anthropic.com/v1/models/claude-opus-5-5 (thinking.types.disabled false)' },
  { id: 'claude-sonnet-5-5-openrouter', match: range('claude-sonnet-V'), since: '5.5', kinds: ['openrouter'], ...cloud(1_000_000, 128_000), reasoning: 'always', checked: D, source: 'https://openrouter.ai/api/v1/models (Claude Sonnet 5.5 reasoning.mandatory)' },
  { id: 'claude-sonnet-5-5', match: range('claude-sonnet-V'), since: '5.5', ...cloud(1_000_000, 128_000), reasoning: 'optional', checked: D, source: '@ai-sdk/anthropic@4.0.71 getModelCapabilities' },
  { id: 'claude-5', match: range('claude-(?:opus|sonnet|haiku)-V'), since: '5', ...cloud(1_000_000, 128_000), reasoning: 'optional', checked: D, source: '@ai-sdk/anthropic@4.0.71 getModelCapabilities' },
  { id: 'claude-4-6-plus', match: range('claude-(?:opus|sonnet)-V'), since: '4.6', ...cloud(1_000_000, 128_000), reasoning: 'optional', checked: D, source: 'https://api.anthropic.com/v1/models (max_input_tokens, max_tokens, thinking.types.disabled)' },
  { id: 'claude-4', match: range('claude-(?:opus|sonnet|haiku)-V'), since: '4', ...cloud(200_000, 64_000), reasoning: 'optional', checked: D, source: 'https://platform.claude.com/docs/en/models/overview' },
  { id: 'claude-family', match: /^claude-/, family: true, ...cloud(200_000, 64_000), reasoning: 'always', checked: D, source: FAMILY },
  // OpenAI: https://developers.openai.com/api/docs/models/<id>, and @ai-sdk/openai 4.0.83 getOpenAILanguageModelCapabilities
  { id: 'o1-mini', match: /^o1-mini(?:-|$)/, ...cloud(128_000, 65_536, false), checked: D, source: 'https://developers.openai.com/api/docs/models/o1-mini (limits and modalities; effort support unverified for this deprecated model)' },
  { id: 'o1-preview', match: /^o1-preview(?:-|$)/, ...cloud(128_000, 32_768, false), checked: D, source: 'https://developers.openai.com/api/docs/models/o1-preview (limits and modalities; effort support unverified for this deprecated model)' },
  { id: 'o1', match: /^o1(?:-|$)/, ...cloud(200_000, 100_000), reasoning: 'always', checked: D, source: 'https://developers.openai.com/api/docs/models/o1' },
  { id: 'o3-mini', match: /^o3-mini(?:-|$)/, ...cloud(200_000, 100_000, false), reasoning: 'always', checked: D, source: 'https://developers.openai.com/api/docs/models/o3-mini' },
  { id: 'gpt-5-base', match: /^gpt-5(-mini|-nano)?(-\d{4}-\d{2}-\d{2})?$/, ...cloud(400_000, 128_000), reasoning: 'optional', wire: { none: 'minimal' }, checked: D, source: 'https://developers.openai.com/api/docs/guides/reasoning' },
  { id: 'gpt-5-pro', match: /^gpt-5-pro(?:-\d{4}-\d{2}-\d{2})?$/, ...cloud(400_000, 128_000), reasoning: 'none', checked: D, source: 'https://developers.openai.com/api/docs/models/gpt-5-pro (high only; no effort choice)' },
  { id: 'gpt-5-chat', match: /^gpt-5(\.\d+)?-chat/, ...cloud(128_000, 16_384), reasoning: 'none', checked: D, source: 'https://developers.openai.com/api/docs/models/gpt-5-chat-latest' },
  { id: 'gpt-6-sol-luna', match: /^gpt-6-(sol|luna)$/, ...cloud(1_050_000, 128_000), reasoning: 'optional', checked: D, source: 'https://developers.openai.com/api/docs/models/gpt-6-sol; @ai-sdk/openai@4.0.83 getOpenAILanguageModelCapabilities (exact undated names)' },
  { id: 'gpt-4-1', match: /^gpt-4\.1/, ...cloud(1_047_576, 32_768), reasoning: 'none', checked: D, source: 'https://developers.openai.com/api/docs/models/gpt-4.1' },
  { id: 'gpt-4o', match: /^gpt-4o/, ...cloud(128_000, 16_384), reasoning: 'none', checked: D, source: 'https://developers.openai.com/api/docs/models/gpt-4o' },
  { id: 'gpt-old', match: /^gpt-(3\.5|4)(-turbo|-\d{4})?(-|$)/, ...cloud(128_000, 4096, false), reasoning: 'none', checked: D, source: 'https://developers.openai.com/api/docs/models (GPT-3.5 and GPT-4 do not reason)' },
  { id: 'gpt-oss-cloud', match: /^gpt-oss/, kinds: ['openai', 'openrouter', 'openai-compatible'], ...cloud(131_072, 131_072, false), reasoning: 'optional', checked: D, source: 'https://openrouter.ai/api/v1/models (gpt-oss: text in, reasoning effort low to high)' },
  { id: 'o-series', match: range('oV(?:-(?:mini|pro))?'), since: '3', ...cloud(200_000, 100_000), reasoning: 'always', checked: D, source: 'https://developers.openai.com/api/docs/models/o3' },
  { id: 'gpt-5-4-pro', match: range('gpt-V-pro'), since: '5.4', ...cloud(1_050_000, 128_000), reasoning: 'always', wire: { low: 'medium' }, checked: D, source: 'https://developers.openai.com/api/docs/models/gpt-5.4-pro; https://developers.openai.com/api/docs/models/gpt-5.5-pro' },
  { id: 'gpt-5-2-pro', match: range('gpt-V-pro'), since: '5.2', ...cloud(400_000, 128_000), reasoning: 'always', wire: { low: 'medium' }, checked: D, source: 'https://developers.openai.com/api/docs/models/gpt-5.2-pro' },
  { id: 'gpt-5-codex', match: range('gpt-V-codex(?:-(?:mini|max))?'), since: '5', ...cloud(400_000, 128_000), reasoning: 'always', checked: D, source: 'https://developers.openai.com/api/docs/models/gpt-5.3-codex' },
  { id: 'gpt-6', match: range('gpt-V(?:-[a-z]+)*'), since: '6', ...cloud(1_050_000, 128_000), reasoning: 'always', checked: D, source: 'https://developers.openai.com/api/docs/models/gpt-6.1-sol; @ai-sdk/openai@4.0.83 getOpenAILanguageModelCapabilities' },
  { id: 'gpt-5-4-plus', match: range('gpt-V(?:-(?:sol|luna|terra))?'), since: '5.4', ...cloud(1_050_000, 128_000), reasoning: 'optional', checked: D, source: 'https://developers.openai.com/api/docs/models/gpt-5.6-sol' },
  { id: 'gpt-5', match: range('gpt-V(?:-[a-z]+)*'), since: '5', ...cloud(400_000, 128_000), reasoning: 'optional', checked: D, source: 'https://developers.openai.com/api/docs/guides/reasoning' },
  { id: 'openai-family', match: /^(gpt-|o\d)/, family: true, ...cloud(400_000, 128_000), reasoning: 'always', checked: D, source: FAMILY },
  // Google: https://ai.google.dev/gemini-api/docs/thinking, and @ai-sdk/google 4.0.87 resolveThinkingConfig
  { id: 'gemini-media', match: /^gemini-.*-(image|tts|native-audio|live|embedding)/, ...cloud(1_048_576, 8192), reasoning: 'none', checked: D, source: 'https://ai.google.dev/gemini-api/docs/models (image, speech and live models, not chat models)' },
  { id: 'gemini-3-pro-preview', match: /^gemini-3-pro-preview(?:-\d{4}-\d{2}-\d{2})?$/, ...cloud(1_048_576, 65_536), reasoning: 'always', wire: { medium: 'high' }, checked: D, source: 'https://ai.google.dev/gemini-api/docs/models/gemini-3-pro-preview' },
  { id: 'gemini-pro-latest', match: /^gemini-pro-latest$/, ...cloud(1_048_576, 65_536), reasoning: 'always', checked: D, source: 'https://ai.google.dev/gemini-api/docs/models (an alias of the newest Pro)' },
  { id: 'gemini-flash-latest', match: /^gemini-flash-latest$/, ...cloud(1_048_576, 65_536), reasoning: 'always', checked: D, source: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash (an alias of 3.8 Flash; minimal refused)' },
  { id: 'gemini-flash-lite-latest', match: /^gemini-flash-lite-latest$/, ...cloud(1_048_576, 65_536), reasoning: 'optional', checked: D, source: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite (an alias of 3.5 Flash-Lite)' },
  { id: 'gemini-old', match: /^gemini-(1\.5|2\.0)/, ...cloud(1_048_576, 8192), reasoning: 'none', checked: D, source: 'https://ai.google.dev/gemini-api/docs/models' },
  { id: 'gemini-3-pro', match: range('gemini-V-pro(?:-preview)?(?:-customtools)?'), since: '3.1', ...cloud(1_048_576, 65_536), reasoning: 'always', checked: D, source: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview; https://ai.google.dev/gemini-api/docs/thinking' },
  { id: 'gemini-flash-3-7-plus', match: range('gemini-V-flash'), since: '3.7', ...cloud(1_048_576, 65_536), reasoning: 'always', checked: D, source: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash; https://ai.google.dev/gemini-api/docs/thinking (minimal refused by the API)' },
  { id: 'gemini-3', match: range('gemini-V-flash(?:-lite)?'), since: '3', ...cloud(1_048_576, 65_536), reasoning: 'optional', checked: D, source: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite; https://ai.google.dev/gemini-api/docs/thinking' },
  { id: 'gemini-2-5-pro', match: range('gemini-V-pro'), since: '2.5', ...cloud(1_048_576, 65_536), reasoning: 'always', checked: D, source: 'https://ai.google.dev/gemini-api/docs/thinking' },
  { id: 'gemini-2-5', match: range('gemini-V-flash(?:-lite)?'), since: '2.5', ...cloud(1_048_576, 65_536), reasoning: 'optional', checked: D, source: 'https://ai.google.dev/gemini-api/docs/thinking' },
  { id: 'gemini-family', match: /^gemini-/, family: true, ...cloud(1_048_576, 65_536), reasoning: 'always', checked: D, source: FAMILY },
  // xAI, reached through OpenRouter or the OpenAI-compatible card (chat completions)
  { id: 'grok-4-3', match: /^grok-4\.3(?:-|$)/, ...cloud(1_000_000, 32_000), reasoning: 'optional', checked: D, source: 'https://docs.x.ai/developers/models/grok-4.3 (32000 output is a conservative fallback, not a verified maximum)' },
  { id: 'grok-4-7-openrouter', match: /^grok-4\.7(?:-|$)/, kinds: ['openrouter'], ...cloud(500_000, 450_000), reasoning: 'always', checked: D, source: 'https://openrouter.ai/api/v1/models/x-ai/grok-4.7/endpoints' },
  { id: 'grok-4-7', match: /^grok-4\.7(?:-|$)/, ...cloud(500_000, 500_000), reasoning: 'always', checked: D, source: 'https://docs.x.ai/developers/grok-4-7 (no independent output limit; bounded by context)' },
  { id: 'grok-no-effort', match: /^grok-(4\.20|4(-|$)|3)/, ...cloud(256_000, 16_384), reasoning: 'none', checked: D, source: 'https://ai-sdk.dev/providers/ai-sdk-providers/xai' },
  { id: 'grok-4-5-to-7', match: range('grok-V(?:-[a-z]+)*'), since: '4.5', ...cloud(500_000, 32_000), reasoning: 'always', checked: D, source: 'https://docs.x.ai/developers/model-capabilities/text/reasoning (32000 output is a conservative fallback, not a verified maximum)' },
  { id: 'grok-family', match: /^grok-/, family: true, ...cloud(256_000, 16_384), reasoning: 'always', checked: D, source: FAMILY },
  // DeepSeek
  { id: 'deepseek-4-1-flash-openrouter', match: /^deepseek-v4\.1-flash(?:-|:|$)/, kinds: ['openrouter'], ...cloud(1_048_576, 943_718), reasoning: 'optional', wire: { medium: 'high' }, checked: D, source: 'https://openrouter.ai/api/v1/models (DeepSeek V4.1 Flash top_provider and reasoning)' },
  { id: 'deepseek-pro-0813-openrouter', match: /^deepseek-v4-pro-0813(?:-|:|$)/, kinds: ['openrouter'], ...cloud(1_024_000, 384_000, false), reasoning: 'optional', wire: { low: 'high', medium: 'high', high: 'xhigh' }, checked: D, source: 'https://openrouter.ai/api/v1/models (DeepSeek V4 Pro 0813 top_provider and reasoning)' },
  { id: 'deepseek-flash', match: /^deepseek-(v4(\.\d+)?-)?flash/, ...cloud(1_000_000, 384_000), reasoning: 'always', checked: D, source: 'https://api-docs.deepseek.com/quick_start/pricing/' },
  { id: 'deepseek-v4', match: /^deepseek-v4/, ...cloud(1_000_000, 384_000, false), reasoning: 'always', checked: D, source: 'https://api-docs.deepseek.com/guides/thinking_mode/' },
  { id: 'deepseek-r1', match: /^deepseek-r1/, ...cloud(128_000, 32_000, false), reasoning: 'always', checked: D, source: 'https://api-docs.deepseek.com/guides/thinking_mode/' },
  { id: 'deepseek-chat', match: /^deepseek-(chat|v3)/, ...cloud(128_000, 8192, false), reasoning: 'none', checked: D, source: 'https://api-docs.deepseek.com/quick_start/pricing/' },
  { id: 'deepseek-family', match: /^deepseek-/, family: true, ...cloud(1_000_000, 384_000), reasoning: 'always', checked: D, source: FAMILY },
  // Moonshot (Kimi) and Zhipu (GLM)
  { id: 'kimi-k3-openrouter', match: /^kimi-k3(?:-|:|$)/, kinds: ['openrouter'], ...cloud(1_048_576, 943_718), reasoning: 'optional', wire: { medium: 'high' }, checked: D, source: 'https://openrouter.ai/api/v1/models (Kimi K3 top_provider and reasoning)' },
  { id: 'kimi-k3', match: /^kimi-k3/, ...cloud(1_000_000, 32_000), reasoning: 'always', wire: { medium: 'high' }, checked: D, source: 'https://platform.kimi.ai/docs/guide/kimi-k3-quickstart; https://platform.kimi.ai/docs/guide/use-reasoning-effort (output maximum unpublished; 32000 is a conservative fallback)' },
  { id: 'kimi-family', match: /^kimi-/, family: true, ...cloud(1_000_000, 32_000), reasoning: 'always', checked: D, source: FAMILY },
  { id: 'glm-5-3-flash', match: /^glm-5\.3-flash(?:x)?(?:-|$)/, ...cloud(1_000_000, 128_000), reasoning: 'always', wire: { medium: 'high' }, checked: D, source: 'https://docs.z.ai/guides/vlm/glm-5.3-flash' },
  { id: 'glm-5-3', match: /^glm-5\.3/, ...cloud(1_000_000, 128_000, false), reasoning: 'always', wire: { medium: 'high' }, checked: D, source: 'https://docs.z.ai/guides/llm/glm-5.3' },
  { id: 'glm-family', match: /^glm-/, family: true, ...cloud(1_000_000, 128_000), reasoning: 'always', checked: D, source: FAMILY },
  // Qwen on the cloud (QwenCloud through the OpenAI-compatible card, and OpenRouter); local Qwen is below
  { id: 'qwen3-8-max-openrouter', match: /^qwen3\.8-max(?:-(?:0902|prime|\d{8}))?$/, kinds: ['openrouter'], ...cloud(1_000_000, 131_072), reasoning: 'always', checked: D, source: 'https://openrouter.ai/api/v1/models (Qwen3.8 Max 0902 and Prime reasoning); https://openrouter.ai/api/v1/models/qwen/qwen3.8-max/endpoints' },
  { id: 'qwen3-8-2-4t-openrouter', match: /^qwen3\.8-2\.4t-a95b(?:-\d{8})?$/, kinds: ['openrouter'], ...cloud(1_048_576, 131_072, false), reasoning: 'always', wire: { high: 'xhigh' }, checked: D, source: 'https://openrouter.ai/api/v1/models (Qwen3.8 2.4T A95B top_provider, modalities and reasoning)' },
  { id: 'qwen3-8-27b-openrouter', match: /^qwen3\.8-27b(?:-\d{8})?$/, kinds: ['openrouter'], ...cloud(1_000_000, 131_072), reasoning: 'optional', wire: { high: 'xhigh' }, checked: D, source: 'https://openrouter.ai/api/v1/models (Qwen3.8 27B top_provider, modalities and reasoning)' },
  { id: 'qwen3-8-omni-openrouter', match: /^qwen3\.8-omni-flash(?:-\d{8})?$/, kinds: ['openrouter'], ...cloud(1_000_000, 131_072), reasoning: 'none', checked: D, source: 'https://openrouter.ai/api/v1/models (Qwen3.8 Omni Flash: budget control, no supported_efforts or reasoning_effort parameter)' },
  { id: 'qwen3-8-omni', match: /^qwen3\.8-omni-flash(?:-\d{8})?$/, kinds: ['openai-compatible'], ...cloud(1_000_000, 32_000), reasoning: 'optional', wire: { high: 'xhigh' }, checked: D, source: 'https://docs.qwencloud.com/developer-guides/getting-started/vision-models; https://docs.qwencloud.com/api-reference/chat/openai-chat (output maximum unpublished; 32000 is a conservative fallback)' },
  { id: 'qwen3-8-2-4t', match: /^qwen3\.8-2\.4t-a95b(?:-\d{8})?$/, kinds: ['openai-compatible'], ...cloud(1_000_000, 131_072, false), reasoning: 'optional', checked: D, source: 'https://docs.qwencloud.com/developer-guides/getting-started/text-generation-models; https://docs.qwencloud.com/api-reference/chat/openai-chat' },
  { id: 'qwen3-8-cloud', match: /^qwen3\.8-(max(?:-0902)?|flash)(?:-\d{8})?$/, kinds: ['openai-compatible', 'openrouter'], ...cloud(1_000_000, 131_072), reasoning: 'optional', checked: D, source: 'https://docs.qwencloud.com/developer-guides/getting-started/latest-model; https://docs.qwencloud.com/api-reference/chat/openai-chat' },
  // Mistral
  { id: 'mistral-cloud', match: /^(mistral-large(-24\d\d|-2512)?$|mistral-medium-(3|3\.1|25\d\d)$)/, ...cloud(128_000, 8192), reasoning: 'none', checked: D, source: 'https://openrouter.ai/api/v1/models (no reasoning parameter); Large 4 and Medium 3.5 reason and reach the family row' },
  // Local servers (checked on Ollama; LM Studio takes the same rows): thinking is a switch, mapped from
  // reasoning_effort. The thinking models are scoped to the local kinds, so a cloud endpoint serving the same name
  // (DashScope's qwen3.5-plus, OpenRouter's gpt-oss) does not get a local window.
  { id: 'qwen3-vl-local', match: /^qwen3(\.\d)?-?vl/i, kinds: LOCAL, ...local(262_144, true), reasoning: 'optional', checked: D, source: 'https://ollama.com/library/qwen3-vl; https://docs.ollama.com/api/openai-compatibility' },
  { id: 'qwen3-5-local', match: /^qwen3\.[5-9]/i, kinds: LOCAL, ...local(262_144, true), reasoning: 'optional', checked: D, source: 'https://ollama.com/library/qwen3.5' },
  { id: 'qwen3-local', match: /^qwen3/i, kinds: LOCAL, ...local(32_768), reasoning: 'optional', checked: D, source: 'https://docs.ollama.com/api/openai-compatibility' },
  { id: 'gpt-oss', match: /^gpt-oss/i, kinds: LOCAL, ...local(131_072), reasoning: 'optional', checked: D, source: 'https://ollama.com/library/gpt-oss; https://docs.ollama.com/api/openai-compatibility' },
  { id: 'qwen2-5', match: /^qwen2\.5/i, ...local(32_768), reasoning: 'none', checked: D, source: UNCHECKED },
  { id: 'gemma3', match: /^gemma3/i, ...local(32_768, true), reasoning: 'none', checked: D, source: UNCHECKED },
  { id: 'llama3', match: /^llama3\.[123]/i, ...local(32_768), reasoning: 'none', checked: D, source: UNCHECKED },
  { id: 'mistral-local', match: /^(mistral|ministral|devstral)/i, kinds: LOCAL, ...local(32_768), reasoning: 'none', checked: D, source: UNCHECKED },
  // The families of the cloud vendors whose rows are above only for some models
  { id: 'qwen-family', match: /^qwen/i, family: true, ...cloud(1_000_000, 32_000), reasoning: 'always', checked: D, source: FAMILY },
  { id: 'mistral-family', match: /^(mistral|magistral|ministral|devstral|codestral|pixtral)-/i, family: true, ...cloud(128_000, 8192), reasoning: 'always', checked: D, source: FAMILY },
];

/**
 * Names that never belong to a chat model the agent can use: image, video, music, speech, audio, embedding, robotics
 * and other specialist models. Each word stands as its own part of the name, so `gpt-image-2` and `nomic-embed-text`
 * match and a chat model that merely contains the letters does not.
 */
export const NOT_CHAT =
  /(?:^|[-_./:])(?:embed|embedding|embeddings|rerank|tts|whisper|transcribe|moderation|image|nano-banana|sora|veo|lyria|realtime|live|audio|search|computer-use|deep-research|robotics)(?=$|[-_./:\d])/i;

/** The model name as the exact rows match it: without an OpenRouter-style `vendor/` prefix. */
export function bareName(modelName: string): string {
  return modelName.includes('/') ? modelName.slice(modelName.lastIndexOf('/') + 1) : modelName;
}

/**
 * The name as the range and family rows match it: without the prefix, an OpenRouter variant such as `:free`, a trailing
 * date, or a trailing `-preview`, `-latest` or `-exp`.
 */
export function cleanName(modelName: string): string {
  let name = bareName(modelName).replace(/:[a-z-]+$/i, '');
  for (let before = ''; before !== name;) {
    before = name;
    name = name.replace(/-(\d{8}|\d{4}-\d{2}-\d{2})$/, '').replace(/-(preview|latest|exp)$/i, '');
  }
  return name;
}

/** Whether `version` (`5.4`, `4-6`) is at least `since` (`5.4`), part by part. */
export function atLeast(version: string, since: string): boolean {
  const [a = 0, b = 0] = version.split(/[.-]/).map(Number);
  const [c = 0, d = 0] = since.split('.').map(Number);
  return a !== c ? a > c : b >= d;
}

/**
 * Whether a provider is a cloud endpoint: every kind but Ollama and LM Studio, and the OpenAI-compatible card only at a
 * public host, not at localhost, a private network address or a `.local` name.
 */
export function isCloudEndpoint(kind: ProviderKind, baseUrl?: string): boolean {
  if (defaults.localKinds.includes(kind)) return false;
  if (kind !== 'openai-compatible') return true;
  let host: string;
  try {
    host = new URL(baseUrl ?? '').hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost')) return false;
  const ip = host.split('.').map(Number);
  if (ip.length === 4 && ip.every(n => Number.isInteger(n) && n >= 0 && n < 256)) {
    const [a, b] = ip;
    return !(
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b < 32) ||
      (a === 192 && b === 168)
    );
  }
  return true;
}

/**
 * The row for a model on a kind of provider: the first that fits, or undefined. Family rows apply on a cloud
 * endpoint only; `cloud` says whether this one is (by default, every kind but Ollama and LM Studio).
 */
export function findRow(
  kind: ProviderKind,
  modelName: string,
  table: CatalogueRow[] = rows,
  cloud = !defaults.localKinds.includes(kind),
): CatalogueRow | undefined {
  const bare = bareName(modelName);
  const clean = cleanName(modelName);
  return table.find(r => {
    if (r.kinds && !r.kinds.includes(kind)) return false;
    if (r.family) return cloud && r.match.test(clean);
    if (r.since === undefined) return r.match.test(bare);
    const v = r.match.exec(clean)?.groups?.v;
    return v !== undefined && atLeast(v, r.since);
  });
}

/**
 * The send rule: what the SDK's `reasoning` option is given for an effort, or undefined when nothing is sent. In this
 * order: a model that takes no effort gets nothing; an unknown model at None gets nothing; an `always` model's None
 * becomes Low; then the row's map, if any.
 */
export function sendRule(
  capability: ReasoningSupport | undefined,
  effort: ReasoningEffort,
  wire?: Partial<Record<ReasoningEffort, WireEffort>>,
): WireEffort | undefined {
  if (capability === 'none') return undefined;
  if (capability === undefined && effort === 'none') return undefined;
  const level: ReasoningEffort = capability === 'always' && effort === 'none' ? 'low' : effort;
  return wire?.[level] ?? level;
}
