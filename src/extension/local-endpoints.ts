// The local inference proxies this build ships with, added as OpenAI-compatible providers on the first worker start
// that has not added them yet. ether-10's agent lane becomes the default model when none is set. A provider the user
// removes stays removed: the seed runs once per SEED_VERSION. The proxies need no key.
import { providersStorage, settingsStorage } from '@src/store';
import type { ModelEntry, ProviderConfig } from '@src/store';

const SEED_KEY = 'nb.localEndpointsSeeded';
const SEED_VERSION = 1;

const model = (name: string, contextWindow: number, maxOutput: number): ModelEntry => ({
  name,
  overrides: { contextWindow, maxOutput },
});

// ether-10 (GLM-5.3 Flash, TP=2 with ether-11): context is prompt + output, enforced by the proxy, output capped at 131k.
const ETHER10_MODELS: ModelEntry[] = [
  model('dsv4-agent', 1_048_576, 131_072),
  model('dsv4-chat', 131_072, 131_072),
  model('dsv4-max', 1_048_576, 131_072),
  model('dsv4-code', 1_048_576, 131_072),
];

export const LOCAL_ENDPOINTS: ProviderConfig[] = [
  {
    id: 'ether10-lan',
    kind: 'openai-compatible',
    name: 'ether-10 GLM-5.3 (LAN)',
    baseUrl: 'http://192.168.146.34:8010/v1',
    models: ETHER10_MODELS,
  },
  {
    id: 'ether10-tailscale',
    kind: 'openai-compatible',
    name: 'ether-10 GLM-5.3 (Tailscale)',
    baseUrl: 'http://100.66.169.18:8020/v1',
    models: ETHER10_MODELS,
  },
  // ether-9 (Qwen3.8 27B on one RTX 4090): each session is capped at 100k, output at 64k.
  {
    id: 'ether9-agentic',
    kind: 'openai-compatible',
    name: 'ether-9 Qwen3.8 agentic',
    baseUrl: 'http://192.168.146.22:8080/v1',
    models: [model('agentic', 100_000, 65_536)],
  },
  {
    id: 'ether9-fast',
    kind: 'openai-compatible',
    name: 'ether-9 Qwen3.8 fast',
    baseUrl: 'http://192.168.146.22:8082/v1',
    models: [model('fast', 100_000, 65_536)],
  },
];

export const DEFAULT_LOCAL_MODEL = { providerId: 'ether10-lan', model: 'dsv4-agent' };

export async function seedLocalEndpoints(): Promise<void> {
  const stored = await chrome.storage.local.get(SEED_KEY);
  if ((stored[SEED_KEY] as number | undefined) === SEED_VERSION) return;
  await providersStorage.set(list => [
    ...list.filter(p => !LOCAL_ENDPOINTS.some(e => e.id === p.id)),
    ...LOCAL_ENDPOINTS,
  ]);
  await settingsStorage.set(s => (s.defaultModel ? s : { ...s, defaultModel: DEFAULT_LOCAL_MODEL }));
  await chrome.storage.local.set({ [SEED_KEY]: SEED_VERSION });
}
