// Test models and model lists for the Models page. Called from the options page directly: the page needs no
// worker command.
import { AwsClient } from 'aws4fetch';
import {
  CHAT_COMPLETIONS_KINDS,
  bedrockEndpoint,
  bedrockProblem,
  bedrockRegion,
  createModel,
  DEFAULT_BASE_URLS,
  openAICompatibleBaseUrl,
  parseBedrockKey,
  redactingFetch,
} from './providers';
import type { CreateModelOptions, ModelSpec, ProviderKind } from './providers';
import { isOriginRefused } from './errors';
import { refusesImages, refusesReasoning, streamTurn } from './stream';
import type { TurnRequest, TurnResult } from './stream';
import type { LearntFacts } from './profiles';
import { NOT_CHAT } from './catalogue';
import type { WireEffort } from './catalogue';

export interface ConnectionResult {
  ok: boolean;
  /** The model answered the one-tool request with a call to that tool. */
  toolCalling: boolean;
  error?: string;
  /** A local server refused the extension's origin: show the OLLAMA_ORIGINS or CORS fix. */
  originRefused?: boolean;
  ms: number;
  /** What the probes learnt, stored as the entry's `tested`; absent when they learnt nothing. */
  tested?: Omit<LearntFacts, 'at'>;
}

/** What the probes are asked to find out, beyond tool calling. */
export interface ProbeAsk {
  /** Whether the model reasons, when no source said; `undefined` when unknown. */
  reasons?: boolean;
  /** Whether None is accepted is still unknown: run the None probe for a model that reasons. */
  none?: boolean;
  /** None's value on the wire, through the row's map (`minimal` for GPT-5); `none` otherwise. */
  noneWire?: WireEffort;
  /** The model's vision is a guess: run the image probe. */
  image?: boolean;
}

/** The tool probe's reply was cut short before a tool call. */
export const CUT_SHORT =
  'The reply was cut short before the model called the test tool; nothing was changed. Test again.';

/** An 8 by 8 pixel red square, for the image probe. */
const PROBE_IMAGE =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGO4YGCAFTEMLQkA2ntMAeuWKpoAAAAASUVORK5CYII=';

const PROBE_TOOL = {
  report_status: {
    description: 'Report that the connection works.',
    parameters: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['ok'] } },
      required: ['status'],
      additionalProperties: false,
    },
  },
};

/**
 * The kinds the effort probe runs on: the chat-completions kinds, whose servers may take or refuse the field, and
 * Bedrock, where the vendor's row describes the model at its vendor while Bedrock and the SDK decide what reaches it.
 * On the Anthropic, OpenAI and Gemini cards the model's API or the SDK answers instead.
 */
const EFFORT_PROBE_KINDS: readonly ProviderKind[] = [...CHAT_COMPLETIONS_KINDS, 'bedrock'];

/**
 * Sends one request with one tool and checks that the reply is a call to it; then the probes, each one short request
 * without the run's fallback: the effort probe on the kinds above, the None probe and the image probe when `ask` says
 * the fact is unknown.
 */
export async function testConnection(
  spec: ModelSpec,
  options: CreateModelOptions = {},
  ask: ProbeAsk = {},
): Promise<ConnectionResult> {
  const probe: TurnRequest = {
    // Room for a model that reasons by default to think before it calls the tool.
    chat: createModel({ ...spec, maxOutputTokens: 1024 }, options),
    system: 'You are testing a tool connection. Call the tool report_status with status "ok". Do not write text.',
    messages: [{ role: 'user', content: 'Call report_status now.' }],
    tools: PROBE_TOOL,
    retry: { attempts: 1, baseMs: 0, maxMs: 0 },
  };
  const result = await streamTurn(probe);
  if (result.error) {
    const local = spec.kind === 'ollama' || spec.kind === 'lmstudio' || spec.kind === 'openai-compatible';
    return {
      ok: false,
      toolCalling: false,
      error: result.error.message,
      originRefused: local && (result.error.status === 403 || result.error.status === undefined),
      ms: result.durationMs,
    };
  }
  const toolCalling = result.toolCalls.some(c => c.toolName === 'report_status' && !c.invalid);
  // A reply cut short before any tool call says nothing about tool calling: the model may have spent its output on
  // reasoning. Reported as a failed test, so nothing is stored and a model that worked keeps working.
  if (!toolCalling && result.finish === 'length') {
    return { ok: false, toolCalling: false, error: CUT_SHORT, ms: result.durationMs };
  }
  const tested: Omit<LearntFacts, 'at'> = {};
  const once = (request: Partial<TurnRequest>) => streamTurn({ ...probe, ...request, fallback: false });
  const refused = (r: TurnResult) => !!r.error && refusesReasoning(r.error.status, r.error.message);

  // The effort probe: Low, then Medium, then High, to the first accepted. "Reasons: no" when all are refused, since a
  // model can refuse one level and take another, or when the SDK drops the option itself, which it decides by model and
  // not by level; reasoning tokens in an accepted reply mean it reasons.
  if (EFFORT_PROBE_KINDS.includes(spec.kind)) {
    let allRefused = true;
    for (const level of ['low', 'medium', 'high'] as const) {
      const r = await once({ reasoning: level });
      if (refused(r)) continue;
      allRefused = false;
      if (!r.error && r.reasoningIgnored) tested.reasons = false;
      else if (!r.error && (r.usage?.reasoning ?? 0) > 0) tested.reasons = true;
      break;
    }
    if (allRefused) tested.reasons = false;
  }

  // The None probe: None itself, not through the send rule; it counts only if the value reached the wire.
  if (ask.none && (tested.reasons ?? ask.reasons) === true) {
    const r = await once({ reasoning: ask.noneWire ?? 'none' });
    if (refused(r)) tested.acceptsNone = false;
    else if (!r.error && !r.reasoningIgnored) tested.acceptsNone = true;
  }

  // The image probe, for a model whose vision is a guess.
  if (ask.image) {
    const r = await once({
      tools: undefined,
      system: 'Answer in one word.',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What colour is this square?' },
            { type: 'file', data: PROBE_IMAGE, mediaType: 'image/png' },
          ],
        },
      ],
    });
    if (r.error && refusesImages(r.error.status, r.error.message)) tested.vision = false;
    else if (!r.error) tested.vision = true;
  }

  return { ok: true, toolCalling, ms: result.durationMs, ...(Object.keys(tested).length ? { tested } : {}) };
}

export interface ModelList {
  /** The models the agent can likely use, newest first where the list gives a date. */
  models: string[];
  /** The rest, behind "Show all": deprecated, or not a chat model the agent can use. */
  hidden: string[];
}

type ListEntry = Record<string, unknown>;

/**
 * Whether a listed model is hidden: its vendor marks it deprecated, its entry says the agent cannot use it, or its name
 * is a specialist model's. Each field is read only where a vendor sends it. Bedrock runs a model by its own id only
 * when it lists ON_DEMAND; the others run through an inference profile or provisioned throughput.
 */
function hiddenEntry(name: string, m: ListEntry): boolean {
  const deprecated =
    !!m.shutdown_date || !!m.expiration_date || (typeof m.lifecycle === 'string' && m.lifecycle !== 'active');
  const params = m.supported_parameters;
  const methods = m.supportedGenerationMethods;
  const unusable =
    (Array.isArray(params) && !params.includes('tools')) ||
    (Array.isArray(methods) && !methods.includes('generateContent')) ||
    (Array.isArray(m.inferenceTypesSupported) && !m.inferenceTypesSupported.includes('ON_DEMAND'));
  return deprecated || unusable || NOT_CHAT.test(name);
}

interface BedrockModel {
  modelId?: string;
  inputModalities?: string[];
  outputModalities?: string[];
  inferenceTypesSupported?: string[];
  modelLifecycle?: { status?: string };
  inferenceAPIsSupported?: { converse?: { sync?: boolean } };
}

interface BedrockProfile {
  inferenceProfileId?: string;
  status?: string;
  models?: Array<{ modelArn?: string }>;
}

/**
 * A signed GET to the Bedrock control plane of the card's region, with the card's key; throws with AWS's message, the
 * key hidden, when the request fails.
 */
export function bedrockRequest(
  spec: Pick<ModelSpec, 'apiKey' | 'baseUrl'>,
  fetchFn: typeof fetch,
): (path: string) => Promise<Record<string, unknown>> {
  const problem = bedrockProblem(spec.baseUrl, spec.apiKey);
  if (problem) throw new Error(problem);
  const region = bedrockRegion(spec.baseUrl)!;
  const creds = parseBedrockKey(spec.apiKey);
  const send = redactingFetch(spec.apiKey, fetchFn);
  const aws = creds.apiKey
    ? null
    : new AwsClient({
        accessKeyId: creds.accessKeyId!,
        secretAccessKey: creds.secretAccessKey!,
        ...(creds.sessionToken ? { sessionToken: creds.sessionToken } : {}),
        service: 'bedrock',
        region,
      });
  return async (path: string) => {
    const url = `${bedrockEndpoint('bedrock', region)}${path}`;
    let response: Response;
    try {
      response = aws
        ? await send(await aws.sign(url))
        : await send(url, { headers: { authorization: `Bearer ${creds.apiKey}` } });
    } catch (error) {
      throw Object.assign(new Error(`Could not reach bedrock.${region}.amazonaws.com`), {
        originRefused: isOriginRefused(error),
      });
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: unknown; Message?: unknown } | null;
      const text = body?.message ?? body?.Message;
      const reason = typeof text === 'string' ? text : response.statusText;
      throw Object.assign(new Error(`${response.status} ${reason}`.trim()), {
        status: response.status,
        // An AWS 403 is a refused key or a missing permission, never the browser's origin.
        originRefused: false,
      });
    }
    return (await response.json()) as Record<string, unknown>;
  };
}

/**
 * Bedrock's text models, from ListFoundationModels, and the inference profiles that run them, from
 * ListInferenceProfiles. Most newer models run only through a profile (`global.` or a geography such as `apac.`), so
 * each profile is listed before its model, and a model Bedrock does not run on demand by its own id is hidden. A key
 * that may not list the profiles still gets the models.
 */
async function bedrockEntries(
  spec: Pick<ModelSpec, 'apiKey' | 'baseUrl'>,
  fetchFn: typeof fetch,
): Promise<Array<[string, ListEntry]>> {
  const get = bedrockRequest(spec, fetchFn);

  const models = ((await get('/foundation-models')).modelSummaries as BedrockModel[] | undefined) ?? [];
  const text = models.filter(model => {
    if (!model.modelId) return false;
    if (model.inferenceAPIsSupported?.converse?.sync === false) return false;
    const input = model.inputModalities;
    const output = model.outputModalities;
    return !(input && !input.includes('TEXT')) && !(output && !output.includes('TEXT'));
  });
  const lifecycle = (model: BedrockModel) => {
    const status = model.modelLifecycle?.status;
    // ACTIVE or LEGACY.
    return typeof status === 'string' ? { lifecycle: status.toLowerCase() } : {};
  };

  const profiles: BedrockProfile[] = [];
  try {
    let token: string | undefined;
    // A few pages at most: a region has tens of system-defined profiles.
    for (let page = 0; page < 10; page++) {
      const query = `?typeEquals=SYSTEM_DEFINED&maxResults=1000${token ? `&nextToken=${encodeURIComponent(token)}` : ''}`;
      const body = await get(`/inference-profiles${query}`);
      profiles.push(...((body.inferenceProfileSummaries as BedrockProfile[] | undefined) ?? []));
      token = typeof body.nextToken === 'string' && body.nextToken ? body.nextToken : undefined;
      if (!token) break;
    }
  } catch {
    // The key may list models but not profiles (bedrock:ListInferenceProfiles); the models alone are listed.
  }

  const entries: Array<[string, ListEntry]> = [];
  for (const model of text) {
    for (const profile of profiles) {
      const id = profile.inferenceProfileId;
      const runs = profile.models?.[0]?.modelArn?.split('/').pop();
      if (!id || runs !== model.modelId || (profile.status && profile.status !== 'ACTIVE')) continue;
      entries.push([id, lifecycle(model)]);
    }
    entries.push([
      model.modelId!,
      {
        ...(model.inferenceTypesSupported ? { inferenceTypesSupported: model.inferenceTypesSupported } : {}),
        ...lifecycle(model),
      },
    ]);
  }
  return entries;
}

/** The models a provider lists, split into the likely and the hidden. Throws with the server's message when the request fails. */
export async function listModels(
  spec: Pick<ModelSpec, 'kind' | 'apiKey' | 'baseUrl'>,
  fetchFn: typeof fetch = fetch,
): Promise<ModelList> {
  const get = async (url: string, headers: Record<string, string> = {}) => {
    let response: Response;
    try {
      response = await fetchFn(url, { headers });
    } catch (error) {
      throw Object.assign(new Error(`Could not reach ${new URL(url).host}`), { originRefused: isOriginRefused(error) });
    }
    if (!response.ok) {
      // The provider's own reason when its body has one (`{ error: { message } }`), else the status line.
      const body = (await response.json().catch(() => null)) as { error?: { message?: unknown } } | null;
      const reason = typeof body?.error?.message === 'string' ? body.error.message : response.statusText;
      throw Object.assign(new Error(`${response.status} ${reason}`.trim()), {
        status: response.status,
        originRefused: response.status === 403,
      });
    }
    return response.json() as Promise<Record<string, unknown>>;
  };
  let entries: Array<[string, ListEntry]>;
  switch (spec.kind) {
    case 'anthropic': {
      const body = await get(`${spec.baseUrl || 'https://api.anthropic.com/v1'}/models?limit=100`, {
        'x-api-key': spec.apiKey ?? '',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      });
      entries = ((body.data as ListEntry[]) ?? []).map(m => [String(m.id), m]);
      break;
    }
    case 'gemini': {
      const base = spec.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
      const body = await get(`${base}/models?pageSize=200`, { 'x-goog-api-key': spec.apiKey ?? '' });
      // No release date: Gemini's own models first, newest version first (`gemini-3.8-flash` before
      // `gemini-2.5-flash`, an unversioned `-latest` alias above them), then the others (Gemma) by name.
      const gemini = (name: string) => name.startsWith('gemini-');
      const version = (name: string) => Number(/-(\d+(?:\.\d+)?)/.exec(name)?.[1] ?? Infinity);
      entries = ((body.models as ListEntry[]) ?? [])
        .map((m): [string, ListEntry] => [String(m.name).replace(/^models\//, ''), m])
        .sort(
          ([a], [b]) =>
            Number(gemini(b)) - Number(gemini(a)) ||
            (gemini(a) ? version(b) - version(a) || 0 : 0) ||
            b.localeCompare(a, 'en', { numeric: true }),
        );
      break;
    }
    case 'ollama': {
      const server = (spec.baseUrl?.trim() || DEFAULT_BASE_URLS.ollama!).replace(/\/+$/, '').replace(/\/v1$/, '');
      const body = await get(`${server}/api/tags`);
      entries = ((body.models as ListEntry[]) ?? []).map(m => [String(m.name), m]);
      break;
    }
    case 'bedrock': {
      entries = await bedrockEntries(spec, fetchFn);
      break;
    }
    default: {
      const base =
        spec.kind === 'openai'
          ? spec.baseUrl || 'https://api.openai.com/v1'
          : openAICompatibleBaseUrl(spec.kind, spec.baseUrl);
      const body = await get(`${base}/models`, spec.apiKey ? { authorization: `Bearer ${spec.apiKey}` } : {});
      entries = ((body.data as ListEntry[]) ?? [])
        .map((m): [string, ListEntry] => [String(m.id), m])
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    }
  }
  // Newest first where the list gives a date (OpenAI, Anthropic, OpenRouter and most OpenAI-compatible servers);
  // a model without one keeps its place after them. Gemini's list is by name instead, and Ollama's keeps its order.
  const released = (m: ListEntry) =>
    typeof m.created === 'number'
      ? m.created * 1000
      : typeof m.created_at === 'string'
        ? Date.parse(m.created_at)
        : NaN;
  const time = (m: ListEntry) => (Number.isNaN(released(m)) ? -Infinity : released(m));
  entries.sort(([, a], [, b]) => time(b) - time(a) || 0);
  const list: ModelList = { models: [], hidden: [] };
  for (const [name, m] of entries) (hiddenEntry(name, m) ? list.hidden : list.models).push(name);
  return list;
}

/** What a local server says of a model's window: the number, and whether it is the window the server has loaded. */
export interface DetectedContext {
  window?: number;
  loaded: boolean;
}

/**
 * The context window a local server reports for a model (WebBrain's table): the window it loaded, from Ollama's
 * `/api/ps` or LM Studio's `/api/v0/models` (`loaded_context_length`); else, for Ollama, what it would load, from
 * `/api/show`. Undefined when the server does not answer, so what was stored before is kept. A loaded window is the
 * model's window; any other number only lowers it.
 */
export async function detectContext(
  spec: Pick<ModelSpec, 'kind' | 'baseUrl' | 'modelName'>,
  fetchFn: typeof fetch = fetch,
): Promise<DetectedContext | undefined> {
  const root = (openAICompatibleBaseUrl(spec.kind, spec.baseUrl) ?? '').replace(/\/v1$/, '');
  const json = async (url: string, init?: RequestInit) => {
    try {
      const response = await fetchFn(url, init);
      return response.ok ? ((await response.json()) as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const positive = (n: unknown) => (typeof n === 'number' && n > 0 ? n : undefined);
  if (spec.kind === 'ollama') {
    const ps = await json(`${root}/api/ps`);
    if (!ps) return undefined;
    const loaded = (ps.models as Array<{ name?: string; model?: string; context_length?: number }> | undefined)?.find(
      m => m.name === spec.modelName || m.model === spec.modelName,
    );
    if (positive(loaded?.context_length)) return { window: loaded!.context_length, loaded: true };
    const show = await json(`${root}/api/show`, { method: 'POST', body: JSON.stringify({ model: spec.modelName }) });
    if (!show) return { loaded: false };
    // A num_ctx in the model's parameters is what the server loads; otherwise the model's own maximum.
    const numCtx = /(?:^|\n)\s*num_ctx\s+(\d+)/.exec(String(show.parameters ?? ''))?.[1];
    if (numCtx) return { window: Number(numCtx), loaded: false };
    const info = (show.model_info ?? {}) as Record<string, unknown>;
    const key = Object.keys(info).find(k => k.endsWith('.context_length'));
    const window = key ? positive(info[key]) : undefined;
    return window ? { window, loaded: false } : { loaded: false };
  }
  if (spec.kind === 'lmstudio') {
    const models = await json(`${root}/api/v0/models`);
    if (!models) return undefined;
    const model = (models.data as Array<{ id?: string; loaded_context_length?: number }> | undefined)?.find(
      m => m.id === spec.modelName,
    );
    const window = positive(model?.loaded_context_length);
    return window ? { window, loaded: true } : { loaded: false };
  }
  return undefined;
}
