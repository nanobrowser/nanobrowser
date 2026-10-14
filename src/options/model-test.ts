// Testing one model, shared by Settings → Providers and the welcome page: the model's API first, then, for the whole
// test, the probes of Test models. What was learnt is stored on the model's entry, unless the provider's address
// changed meanwhile, since it describes the old server.
import { detectContext, isCloudEndpoint, probeAsk, readModelInfo, testConnection } from '@src/llm';
import type { ConnectionResult, LearntFacts } from '@src/llm';
import { providersStorage } from '@src/store/settings';
import type { ModelEntry, ProviderConfig } from '@src/store/settings';
import { t } from '@src/ui/i18n';

export interface ModelTest {
  /** Absent when only the API was read. */
  result?: ConnectionResult;
  patch: Pick<ModelEntry, 'fromApi' | 'detectedContext' | 'noToolCalling'> & { tested?: Omit<LearntFacts, 'at'> };
}

/**
 * What to show when listing a provider's models failed: the server-setup fix when a local server refused the extension,
 * a plain line when the provider refused the key (401), else the provider's own reason.
 */
export function listProblem(error: unknown, local: boolean): { message: string; originRefused: boolean } {
  const e = error as Error & { status?: number; originRefused?: boolean };
  return { originRefused: !!e.originRefused && local, message: e.status === 401 ? t('models.keyRefused') : e.message };
}

/** Adding a model runs the whole test on a cloud endpoint, and reads only the API on a local one. */
export const wholeTestOnAdd = (provider: ProviderConfig) => isCloudEndpoint(provider.kind, provider.baseUrl);

export async function testModel(
  provider: ProviderConfig,
  modelName: string,
  apiKey: string,
  whole: boolean,
): Promise<ModelTest> {
  const spec = { kind: provider.kind, modelName, apiKey, baseUrl: provider.baseUrl };
  const at = new Date().toISOString();
  const api = await readModelInfo(spec);
  const patch: ModelTest['patch'] = { fromApi: api ? { ...api, at } : undefined };
  if (provider.kind === 'ollama' || provider.kind === 'lmstudio') patch.detectedContext = await detectContext(spec);
  if (!whole) return { patch };
  // The probes ask only what no source said: the stored overrides and answers, and what the API said just now.
  const stored = provider.models.find(m => m.name === modelName);
  const ask = probeAsk({ ...spec, overrides: stored?.overrides, tested: stored?.tested, fromApi: patch.fromApi });
  const result = await testConnection(spec, {}, ask);
  if (result.ok) {
    patch.noToolCalling = !result.toolCalling;
    if (result.tested) patch.tested = result.tested;
  }
  return { result, patch };
}

/**
 * Stores a test's patch on the model's entry, reading the list fresh. `tested` keeps its other answers: a field changes
 * only with a new answer to the same question. The old `reasoningSupport` field goes.
 */
export async function saveTest(providerId: string, baseUrl: string | undefined, modelName: string, test: ModelTest) {
  const { tested, ...rest } = test.patch;
  await providersStorage.set(list =>
    list.map(p =>
      p.id !== providerId || (p.baseUrl ?? '') !== (baseUrl ?? '')
        ? p
        : {
            ...p,
            models: p.models.map(m => {
              if (m.name !== modelName) return m;
              // A whole test supersedes the old `reasoningSupport` probe value; reading the API alone does not.
              const { reasoningSupport, ...model } = m;
              const kept = test.result || !reasoningSupport ? model : { ...model, reasoningSupport };
              const merged =
                tested && Object.keys(tested).length
                  ? { ...m.tested, ...tested, at: new Date().toISOString() }
                  : m.tested;
              return { ...kept, ...rest, ...(merged ? { tested: merged } : {}) };
            }),
          },
    ),
  );
}
