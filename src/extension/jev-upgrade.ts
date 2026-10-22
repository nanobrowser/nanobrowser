// The optional Jev prereleases kept a key beside their settings. Move it separately after the main provider upgrade.
import { JEV_KEY_ID, validateJevSettings } from '@src/store/jev';
import type { ModelRef } from '@src/store/types';
import type { ReasoningEffort } from '@src/llm/catalogue';

const LEGACY_KEY = 'jev-settings';
const CONFIG_KEY = 'nb.jev';
const KEYS_KEY = 'nb.keys';
const PROVIDERS_KEY = 'nb.providers';
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

function routingModel(value: unknown, providers: unknown): ModelRef | undefined {
  const old = record(value);
  if (!old || typeof old.provider !== 'string' || typeof old.modelName !== 'string' || !Array.isArray(providers))
    return undefined;
  const providerId = old.provider.trim();
  const model = old.modelName.trim();
  const provider = providers.map(record).find(item => item?.id === providerId);
  if (!provider || !Array.isArray(provider.models) || !provider.models.some(item => record(item)?.name === model))
    return undefined;
  return { providerId, model };
}

function routingEffort(value: unknown): ReasoningEffort | undefined {
  switch (value) {
    case 'none':
    case 'low':
    case 'medium':
    case 'high':
      return value;
    case 'xhigh':
      return 'high';
    case 'minimal':
    case 'minimal/none':
      return 'low';
    default:
      return undefined;
  }
}
/** One atomic write precedes cleanup; a failed write leaves the old record for the next worker start. */
export async function upgradeJevSettings(): Promise<void> {
  const area = chrome.storage.local;
  const stored = await area.get([LEGACY_KEY, CONFIG_KEY, KEYS_KEY, PROVIDERS_KEY]);
  const legacy = record(stored[LEGACY_KEY]);
  if (!legacy) return;
  const patch: Record<string, unknown> = {};
  if (stored[CONFIG_KEY] === undefined) {
    const fields = [
      'enabled',
      'model',
      'timeoutMs',
      'proceedThreshold',
      'completionThreshold',
      'selectionThreshold',
      'routingEnabled',
      'system1Enabled',
    ];
    const candidate = Object.fromEntries(
      fields.filter(key => Object.hasOwn(legacy, key)).map(key => [key, legacy[key]]),
    );
    const fastModel = routingModel(legacy.fastModel, stored[PROVIDERS_KEY]);
    const capableModel = routingModel(legacy.capableModel, stored[PROVIDERS_KEY]);
    if (fastModel) {
      candidate.fastModel = fastModel;
      const effort = routingEffort(record(legacy.fastModel)?.reasoningEffort);
      if (effort !== undefined) candidate.fastReasoning = effort;
    }
    if (capableModel) {
      candidate.capableModel = capableModel;
      const effort = routingEffort(record(legacy.capableModel)?.reasoningEffort);
      if (effort !== undefined) candidate.capableReasoning = effort;
    }
    try {
      patch[CONFIG_KEY] = validateJevSettings(candidate);
    } catch {
      // Retain malformed legacy data without enabling calls or blocking the main upgrade.
      return;
    }
  }
  const keys = record(stored[KEYS_KEY]) ?? {};
  // Once the new configuration exists, a missing key can mean the user cleared it.
  if (
    stored[CONFIG_KEY] === undefined &&
    !Object.hasOwn(keys, JEV_KEY_ID) &&
    typeof legacy.apiKey === 'string' &&
    legacy.apiKey.trim()
  ) {
    patch[KEYS_KEY] = { ...keys, [JEV_KEY_ID]: legacy.apiKey.trim() };
  }
  await area.set(patch);
  await area.remove(LEGACY_KEY);
}
