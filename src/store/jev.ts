// Jev settings contain no credentials. Its API key is stored separately under JEV_KEY_ID in nb.keys.
import { REASONING_EFFORTS } from '../llm/catalogue';
import type { ReasoningEffort } from '../llm/catalogue';
import type { ModelRef } from './types';
import { createStorage } from './storage';

export interface JevSettings {
  enabled: boolean;
  model: string;
  timeoutMs: number;
  proceedThreshold: number;
  completionThreshold: number;
  selectionThreshold: number;
  routingEnabled: boolean;
  system1Enabled: boolean;
  fastModel?: ModelRef;
  capableModel?: ModelRef;
  fastReasoning?: ReasoningEffort;
  capableReasoning?: ReasoningEffort;
}

export const JEV_KEY_ID = 'jev-decision';
export const DEFAULT_JEV_SETTINGS: JevSettings = {
  enabled: false,
  model: 'jev-latest',
  timeoutMs: 10_000,
  proceedThreshold: 0.8,
  completionThreshold: 0.9,
  selectionThreshold: 0.8,
  routingEnabled: false,
  system1Enabled: false,
};

/** Missing fields retain their defaults, including the disabled state. */
export function validateJevSettings(stored: unknown): JevSettings {
  if (stored !== undefined && (!stored || typeof stored !== 'object' || Array.isArray(stored))) {
    throw new Error('Invalid Jev settings.');
  }
  const settings = { ...DEFAULT_JEV_SETTINGS, ...stored } as JevSettings;
  if (
    typeof settings.enabled !== 'boolean' ||
    typeof settings.routingEnabled !== 'boolean' ||
    typeof settings.system1Enabled !== 'boolean' ||
    typeof settings.model !== 'string' ||
    !settings.model.trim() ||
    !Number.isInteger(settings.timeoutMs) ||
    settings.timeoutMs < 1_000 ||
    settings.timeoutMs > 60_000
  ) {
    throw new Error('Invalid Jev settings.');
  }
  for (const threshold of [settings.proceedThreshold, settings.completionThreshold, settings.selectionThreshold]) {
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      throw new Error('Invalid Jev confidence threshold.');
    }
  }
  const normalizeModel = (value: unknown): ModelRef | undefined => {
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object') throw new Error('Invalid Jev routing model.');
    const model = value as Partial<ModelRef>;
    if (
      typeof model.providerId !== 'string' ||
      !model.providerId.trim() ||
      typeof model.model !== 'string' ||
      !model.model.trim()
    ) {
      throw new Error('Invalid Jev routing model.');
    }
    return { providerId: model.providerId.trim(), model: model.model.trim() };
  };
  const normalizeReasoning = (value: unknown): ReasoningEffort | undefined => {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !REASONING_EFFORTS.includes(value as ReasoningEffort)) {
      throw new Error('Invalid Jev reasoning effort.');
    }
    return value as ReasoningEffort;
  };
  const fastReasoning = normalizeReasoning(settings.fastReasoning);
  const capableReasoning = normalizeReasoning(settings.capableReasoning);
  const fastModel = normalizeModel(settings.fastModel);
  const capableModel = normalizeModel(settings.capableModel);
  return {
    enabled: settings.enabled,
    model: settings.model.trim(),
    timeoutMs: settings.timeoutMs,
    proceedThreshold: settings.proceedThreshold,
    completionThreshold: settings.completionThreshold,
    selectionThreshold: settings.selectionThreshold,
    routingEnabled: settings.routingEnabled,
    system1Enabled: settings.system1Enabled,
    ...(fastModel ? { fastModel } : {}),
    ...(capableModel ? { capableModel } : {}),
    ...(fastReasoning ? { fastReasoning } : {}),
    ...(capableReasoning ? { capableReasoning } : {}),
  };
}

export const jevSettingsStorage = createStorage<JevSettings>('nb.jev', DEFAULT_JEV_SETTINGS, {
  liveUpdate: true,
  merge: stored => {
    try {
      return validateJevSettings(stored);
    } catch {
      // Invalid persisted values must never turn on optional model calls.
      return { ...DEFAULT_JEV_SETTINGS };
    }
  },
});
