// Settings, provider configurations and API keys in chrome.storage.local. Keys sit under a key of their own: they
// are never exported and never logged.
import type { ProviderKind } from '../llm/providers';
import { resolveProfile } from '../llm/profiles';
import type { LearntFacts } from '../llm/profiles';
import type { ReasoningEffort, ReasoningSupport } from '../llm/catalogue';
import { createStorage } from './storage';
import type { LivePair, ModelRef, PermissionMode } from './types';

export type UiLanguage = 'auto' | 'en' | 'zh_CN' | 'zh_TW';
export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  defaultMode: PermissionMode;
  defaultModel: ModelRef | null;
  /** The effort for new conversations on a model that reasons; the latest choice in a picker. */
  reasoning: ReasoningEffort;
  turnCap: number;
  /** Custom instructions; at most CUSTOM_INSTRUCTIONS_MAX characters reach the prompt. */
  customInstructions: string;
  theme: Theme;
  uiLanguage: UiLanguage;
  /** 'auto': answer in the language of the user's message. */
  responseLanguage: string;
  /** The voice model for voice input, from an OpenAI or Gemini provider; null until one is chosen. */
  voiceModel: ModelRef | null;
  /** The language spoken for voice input, as a BCP 47 tag; 'auto' lets the voice model detect it. */
  dictationLanguage: string;
  /** The first-use notice for Auto mode was shown. */
  autoNoticeShown: boolean;
  /** What to do with the tabs the agent opened when a conversation ends. */
  agentTabsOnEnd: 'ask' | 'close' | 'keep';
  onboarded: boolean;
  /** The anonymous daily ping that counts active users. */
  analyticsPing: boolean;
  /** The daily usage counts. */
  analyticsStats: boolean;
  /** A glowing border on the pages a working run acts on. */
  pageBorder: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultMode: 'ask',
  defaultModel: null,
  reasoning: 'medium',
  turnCap: 100,
  customInstructions: '',
  theme: 'system',
  uiLanguage: 'auto',
  responseLanguage: 'auto',
  voiceModel: null,
  dictationLanguage: 'auto',
  autoNoticeShown: false,
  agentTabsOnEnd: 'ask',
  onboarded: false,
  analyticsPing: true,
  analyticsStats: true,
  pageBorder: true,
};

/** Stored settings over the defaults, so a field added later has its default. */
export function mergeSettings(stored: unknown): Settings {
  return { ...DEFAULT_SETTINGS, ...(stored && typeof stored === 'object' ? (stored as Partial<Settings>) : {}) };
}

export const settingsStorage = createStorage<Settings>('nb.settings', DEFAULT_SETTINGS, {
  liveUpdate: true,
  merge: mergeSettings,
});

export type { ProviderKind };

/** Overrides of a model's profile; Settings has no control for them, the checks set them. */
export interface ProfileOverrides {
  contextWindow?: number;
  maxOutput?: number;
  vision?: boolean;
}

export interface ModelEntry {
  name: string;
  overrides?: ProfileOverrides;
  /** Detected from a local server; only ever lowers the window. */
  detectedContext?: number;
  /** Test models found no tool calling; the model cannot be chosen for the agent. */
  noToolCalling?: boolean;
  /** What the model's API said at the last test; replaced whole at each test. */
  fromApi?: LearntFacts;
  /** What a probe or a run's fallback found; a field changes only with a new answer. */
  tested?: LearntFacts;
  /** An older version's probe value, read once as `tested` and not written again. */
  reasoningSupport?: ReasoningSupport;
}

/**
 * The two records of what was learnt about a model, with an older version's `reasoningSupport` read as `tested`:
 * `none` as "reasons: no", `optional` as "reasons", since that probe never proved None.
 */
export function learnt(model: ModelEntry): { fromApi?: LearntFacts; tested?: LearntFacts } {
  const legacy =
    model.reasoningSupport && model.tested?.reasons === undefined
      ? { reasons: model.reasoningSupport !== 'none', at: '' }
      : undefined;
  const tested = legacy ? { ...legacy, ...model.tested } : model.tested;
  return { ...(model.fromApi ? { fromApi: model.fromApi } : {}), ...(tested ? { tested } : {}) };
}

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  name: string;
  baseUrl?: string;
  models: ModelEntry[];
}

export const providersStorage = createStorage<ProviderConfig[]>('nb.providers', [], { liveUpdate: true });

/** API keys by provider id. Never exported, never logged, never sent anywhere but to their provider. */
export const keysStorage = createStorage<Record<string, string>>('nb.keys', {}, { liveUpdate: true });

export const LOCAL_KINDS: ReadonlySet<ProviderKind> = new Set(['ollama', 'lmstudio']);

/**
 * A provider with a new base URL. What was learnt about its models describes the old server, so the detected window,
 * the tool-calling mark and the reasoning probe's value are cleared.
 */
export function withBaseUrl(provider: ProviderConfig, baseUrl: string): ProviderConfig {
  if ((provider.baseUrl ?? '') === baseUrl) return provider;
  return {
    ...provider,
    baseUrl,
    models: provider.models.map(({ name, overrides }) => ({ name, ...(overrides ? { overrides } : {}) })),
  };
}

/**
 * Keeps facts a run learnt about a model in its `tested` record, unless the provider's base URL changed since, since
 * they describe the server the run talked to.
 */
export async function learnFacts(
  providerId: string,
  baseUrl: string | undefined,
  modelName: string,
  facts: Omit<LearntFacts, 'at'>,
): Promise<void> {
  await providersStorage.set(list =>
    list.map(p =>
      p.id !== providerId || (p.baseUrl ?? '') !== (baseUrl ?? '')
        ? p
        : {
            ...p,
            models: p.models.map(m =>
              m.name === modelName ? { ...m, tested: { ...m.tested, ...facts, at: new Date().toISOString() } } : m,
            ),
          },
    ),
  );
}

/** A live conversation's pair in `chrome.storage.session`; only the worker writes it. */
export const liveKey = (conversationId: string) => `nb.live.${conversationId}`;

export async function getLive(conversationId: string): Promise<LivePair | undefined> {
  const key = liveKey(conversationId);
  return (await chrome.storage.session.get(key))[key] as LivePair | undefined;
}

export async function setLive(conversationId: string, pair: LivePair): Promise<void> {
  await chrome.storage.session.set({ [liveKey(conversationId)]: pair });
}

export async function removeLive(conversationId: string): Promise<void> {
  await chrome.storage.session.remove(liveKey(conversationId));
}

export function findProvider(providers: ProviderConfig[], id: string): ProviderConfig | null {
  return providers.find(p => p.id === id) ?? null;
}

export function findModel(
  providers: ProviderConfig[],
  ref: ModelRef | null | undefined,
): { provider: ProviderConfig; model: ModelEntry } | null {
  if (!ref) return null;
  const provider = providers.find(p => p.id === ref.providerId);
  const model = provider?.models.find(m => m.name === ref.model);
  return provider && model ? { provider, model } : null;
}

/**
 * The model a conversation uses: the first of `wanted` that is configured and passed the tool test, else the first
 * such model. Null only when there is none. The panel's picker follows the same rule.
 */
export function usableModel(
  providers: ProviderConfig[],
  ...wanted: Array<ModelRef | null | undefined>
): ModelRef | null {
  for (const ref of wanted) {
    const found = findModel(providers, ref);
    if (found && !found.model.noToolCalling) return { providerId: found.provider.id, model: found.model.name };
  }
  for (const p of providers) {
    const m = p.models.find(x => !x.noToolCalling);
    if (m) return { providerId: p.id, model: m.name };
  }
  return null;
}

/** Whether a configured model reasons: what Test models learnt, else the catalogue. */
export function capabilityOf(
  providers: ProviderConfig[],
  ref: ModelRef | null | undefined,
): ReasoningSupport | undefined {
  const found = findModel(providers, ref);
  if (!found) return undefined;
  return resolveProfile({
    kind: found.provider.kind,
    modelName: found.model.name,
    baseUrl: found.provider.baseUrl,
    ...learnt(found.model),
  }).reasoning;
}

/** A site's rule: one map, keyed with `siteOf`, one rule per site. */
export type SiteRule = 'allow' | 'ask' | 'block';

export interface SiteRuleEntry {
  rule: SiteRule;
  setAt: string;
}

export const siteRulesStorage = createStorage<Record<string, SiteRuleEntry>>('nb.siteRules', {}, { liveUpdate: true });

/**
 * The policy for a classified write: a site's rule decides, otherwise the mode. A pure function of two values.
 */
export function decideWrite(mode: PermissionMode, rule: 'allow' | 'ask' | undefined): 'run' | 'ask' {
  if (rule) return rule === 'allow' ? 'run' : 'ask';
  return mode === 'auto' ? 'run' : 'ask';
}
