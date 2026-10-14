// What a vendor's model API says about a model: read when the model is tested, before any probe, at no cost in tokens.
// One parser reads the fields any of the APIs return; a field the API does not state is left out, for the next source
// to say.
import { openAICompatibleBaseUrl } from './providers';
import type { ModelSpec } from './providers';
import type { LearntFacts } from './profiles';

export type ApiFacts = Omit<LearntFacts, 'at'>;

type Json = Record<string, unknown>;

const obj = (v: unknown): Json | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined;
const positive = (...values: unknown[]) => values.find((v): v is number => typeof v === 'number' && v > 0);
const bool = (...values: unknown[]) => values.find((v): v is boolean => typeof v === 'boolean');
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : undefined);

/**
 * The facts in one model's record, whichever vendor wrote it: Anthropic, Gemini, OpenRouter, an OpenAI-compatible
 * server's list (DeepSeek, Kimi, Mistral), Ollama's `/api/show` or LM Studio's `/api/v0/models`.
 */
export function factsFrom(record: Json): ApiFacts {
  const caps = obj(record.capabilities);
  const capList = list(record.capabilities);
  const thinking = obj(caps?.thinking);
  const effort = obj(caps?.effort);
  const reasoning = obj(record.reasoning);
  const efforts = list(reasoning?.supported_efforts);
  const levels = list(obj(record.effort)?.supported_levels);
  const modalities = list(record.input_modalities) ?? list(obj(record.architecture)?.input_modalities);
  const params = list(record.supported_parameters);

  const facts: ApiFacts = {};
  const contextWindow = positive(
    record.max_input_tokens,
    record.inputTokenLimit,
    record.context_window,
    record.context_length,
    record.max_context_length,
  );
  if (contextWindow) facts.contextWindow = contextWindow;
  const maxOutput = positive(
    record.max_tokens,
    record.outputTokenLimit,
    record.max_output_tokens,
    obj(record.top_provider)?.max_completion_tokens,
  );
  if (maxOutput) facts.maxOutput = maxOutput;

  const vision = bool(
    obj(caps?.image_input)?.supported,
    record.supports_image_in,
    caps?.vision,
    modalities ? modalities.includes('image') : undefined,
    capList ? capList.includes('vision') : undefined,
    record.type === 'vlm' ? true : record.type === 'llm' ? false : undefined,
  );
  if (vision !== undefined) facts.vision = vision;

  // "Reasons" only from a field about an effort or thinking; a bare `reasoning` parameter is not enough.
  const reasons = bool(
    thinking || effort ? thinking?.supported === true || effort?.supported === true : undefined,
    record.thinking,
    record.supports_reasoning,
    levels ? levels.length > 0 : undefined,
    efforts?.length || params?.includes('reasoning_effort') ? true : undefined,
    capList ? capList.includes('thinking') : undefined,
  );
  if (reasons !== undefined) facts.reasons = reasons;

  // None only where the API says so: Anthropic's disabled thinking, OpenRouter's `none` or its mandatory flag.
  // Anthropic's "cannot be disabled" is not read as None refused: the SDK sends None to Sonnet 5.5 as its between-tools
  // mode, which the API takes; the row or the None probe decides.
  const acceptsNone = bool(
    obj(obj(thinking?.types)?.disabled)?.supported === true ? true : undefined,
    efforts?.includes('none') ? true : reasoning?.mandatory === true ? false : undefined,
  );
  if (acceptsNone !== undefined) facts.acceptsNone = acceptsNone;
  return facts;
}

/**
 * Reads the model's API. Null when the kind has none that says anything (OpenAI), the request fails, or the model is
 * not in the answer.
 */
export async function readModelInfo(
  spec: Pick<ModelSpec, 'kind' | 'modelName' | 'apiKey' | 'baseUrl'>,
  fetchFn: typeof fetch = fetch,
): Promise<ApiFacts | null> {
  const get = async (url: string, init?: RequestInit): Promise<Json | null> => {
    try {
      const response = await fetchFn(url, init);
      return response.ok ? ((await response.json()) as Json) : null;
    } catch {
      return null;
    }
  };
  const { kind, modelName } = spec;
  const id = encodeURIComponent(modelName);
  const fromList = (body: Json | null) =>
    (body?.data as Json[] | undefined)?.find(m => m.id === modelName || m.name === modelName) ?? null;
  let record: Json | null = null;
  switch (kind) {
    case 'openai':
      return null;
    case 'anthropic':
      record = await get(`${spec.baseUrl || 'https://api.anthropic.com/v1'}/models/${id}`, {
        headers: {
          'x-api-key': spec.apiKey ?? '',
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
      });
      break;
    case 'gemini':
      record = await get(`${spec.baseUrl || 'https://generativelanguage.googleapis.com/v1beta'}/models/${id}`, {
        headers: { 'x-goog-api-key': spec.apiKey ?? '' },
      });
      break;
    case 'ollama': {
      const root = (openAICompatibleBaseUrl(kind, spec.baseUrl) ?? '').replace(/\/v1$/, '');
      record = await get(`${root}/api/show`, { method: 'POST', body: JSON.stringify({ model: modelName }) });
      // The window is detection's, which reads the loaded one.
      if (record) record = { capabilities: record.capabilities };
      break;
    }
    case 'lmstudio': {
      const root = (openAICompatibleBaseUrl(kind, spec.baseUrl) ?? '').replace(/\/v1$/, '');
      const model = fromList(await get(`${root}/api/v0/models`));
      record = model ? { type: model.type } : null;
      break;
    }
    default: {
      const base = openAICompatibleBaseUrl(kind, spec.baseUrl);
      if (!base) return null;
      record = fromList(
        await get(`${base}/models`, spec.apiKey ? { headers: { authorization: `Bearer ${spec.apiKey}` } } : undefined),
      );
    }
  }
  return record ? factsFrom(record) : null;
}
