// One streaming model call per turn, with no automatic tool execution: the loop runs the tools itself. Retries are
// ours: rate limits, server errors and network failures get exponential backoff with jitter, honour Retry-After, and
// stop after 3 attempts. Once text has streamed, an error ends the turn with a message rather than retrying (pi-ai's
// model). The model's reasoning parts are read and discarded: no reasoning is stored or sent back.
import { jsonSchema, streamText, tool } from 'ai';
import type { JSONSchema7, ModelMessage, ToolSet } from 'ai';
import type { ChatModel } from './providers';
import type { WireEffort } from './catalogue';
import { errorText, getApiCallStatusCode, isRetryable, retryAfterMs, unwrapError } from './errors';
import { isContextOverflow } from './overflow';
import { withSlot } from './limiter';

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Reasoning tokens, counted inside `output` as the providers count them. */
  reasoning?: number;
  cost?: number;
}

export interface ToolDefinition {
  description: string;
  /** JSON Schema of the arguments. */
  parameters: unknown;
}

export interface ToolCallRequest {
  toolCallId: string;
  toolName: string;
  input: unknown;
  /** The SDK could not parse or validate the call (unknown tool, bad JSON, schema mismatch). */
  invalid?: string;
  /** Provider metadata to send back with the call in history (Gemini 3's thought signature). */
  providerOptions?: Record<string, unknown>;
}

export type TurnFinish = 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'error' | 'other' | 'aborted';

export interface TurnResult {
  text: string;
  toolCalls: ToolCallRequest[];
  finish: TurnFinish;
  /** Null when the server reported no usage. */
  usage: TokenUsage | null;
  error?: { message: string; status?: number; overflow: boolean; network?: boolean };
  durationMs: number;
  attempts: number;
  /**
   * The server refused the reasoning option with a 400 that names it, and the request was sent again without it. The
   * caller stops sending the option for the rest of its run.
   */
  reasoningDropped?: boolean;
  /** The server refused None's value and took Low's (`noneRetry`) instead: the model refuses None. */
  noneRefused?: boolean;
  /** The server refused the images, and the request was sent again with each replaced by a note. */
  imagesDropped?: boolean;
  /** The SDK dropped the reasoning option itself, with a warning and no error. */
  reasoningIgnored?: boolean;
}

export interface RetryPolicy {
  attempts: number;
  baseMs: number;
  maxMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { attempts: 3, baseMs: 1000, maxMs: 30_000 };

export interface TurnRequest {
  chat: ChatModel;
  system: string;
  messages: ModelMessage[];
  tools?: Record<string, ToolDefinition>;
  /** Only these tools may be called, e.g. `done` alone for the salvage call. */
  toolChoice?: 'auto' | 'none' | 'required';
  maxOutputTokens?: number;
  /** The SDK's reasoning option, from the send rule; left out when undefined. */
  reasoning?: WireEffort;
  /** When `reasoning` is None's value: Low's, to try once if the server refuses None. */
  noneRetry?: WireEffort;
  /** False for Test models's probes: a refusal comes back as the error, with nothing sent again. */
  fallback?: false;
  signal?: AbortSignal;
  onTextDelta?: (delta: string) => void;
  retry?: RetryPolicy;
  /** For tests: how a retry waits. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export function toToolSet(tools: Record<string, ToolDefinition>): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, t]) => [
      name,
      tool({ description: t.description, inputSchema: jsonSchema(t.parameters as JSONSchema7) }),
    ]),
  );
}

function sleepFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function backoffMs(attempt: number, policy: RetryPolicy, error: unknown, random = Math.random): number {
  const asked = retryAfterMs(error);
  if (asked !== undefined) return Math.min(asked, policy.maxMs);
  const exp = policy.baseMs * 2 ** (attempt - 1);
  return Math.min(policy.maxMs, exp / 2 + random() * (exp / 2));
}

export function toUsage(usage: {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number };
  outputTokenDetails?: { reasoningTokens?: number };
  raw?: unknown;
}): TokenUsage | null {
  if (usage.inputTokens === undefined && usage.outputTokens === undefined) return null;
  // Cost only when the provider reports it.
  const cost = (usage.raw as { cost?: unknown } | undefined)?.cost;
  const reasoning = usage.outputTokenDetails?.reasoningTokens;
  return {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    cacheRead: usage.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWrite: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
    ...(reasoning ? { reasoning } : {}),
    ...(typeof cost === 'number' && cost >= 0 ? { cost } : {}),
  };
}

/**
 * A 400 that names the reasoning option: the server did not take it, the field or that value. On every kind, because
 * a first-party model can be guessed too.
 */
export function refusesReasoning(status: number | undefined, message: string): boolean {
  return status === 400 && /reasoning|thinking|effort/i.test(message);
}

/** A 400 that names an image: the model does not take images. */
export function refusesImages(status: number | undefined, message: string): boolean {
  return status === 400 && /image|vision|multimodal/i.test(message);
}

/** The note an image is replaced with when the model refused images. */
export const IMAGE_NOT_SENT = '[An image was here; this model does not take images.]';

const isImagePart = (part: unknown) => {
  const p = part as { type?: string; mediaType?: string };
  return p?.type === 'image' || (p?.type === 'file' && !!p.mediaType?.startsWith('image/'));
};

/** The messages with each image replaced by a short note; null when there was none. */
export function withoutImages(messages: ModelMessage[]): ModelMessage[] | null {
  let found = false;
  const out = messages.map(m => {
    if (!Array.isArray(m.content)) return m;
    const content = (m.content as unknown[]).map(part => {
      if (!isImagePart(part)) return part;
      found = true;
      return { type: 'text', text: IMAGE_NOT_SENT };
    });
    return { ...m, content } as ModelMessage;
  });
  return found ? out : null;
}

/** Runs one turn: streams the reply, collects its tool calls, retries before anything streamed. */
export async function streamTurn(request: TurnRequest): Promise<TurnResult> {
  const { maxConcurrent, baseUrl, kind } = request.chat.spec;
  if (!maxConcurrent) return streamTurnNow(request);
  try {
    return await withSlot(`${kind} ${baseUrl ?? ''}`, maxConcurrent, () => streamTurnNow(request), request.signal);
  } catch {
    return { text: '', toolCalls: [], finish: 'aborted', usage: null, durationMs: 0, attempts: 0 };
  }
}

async function streamTurnNow(request: TurnRequest): Promise<TurnResult> {
  const policy = request.retry ?? DEFAULT_RETRY;
  const sleep = request.sleep ?? sleepFor;
  const start = Date.now();
  const tools = request.tools && Object.keys(request.tools).length ? toToolSet(request.tools) : undefined;
  let attempt = 0;
  let reasoning = request.reasoning;
  let reasoningDropped = false;
  let noneRetry = request.noneRetry;
  let noneRefused = false;
  let messages = request.messages;
  let imagesDropped = false;
  let reasoningIgnored = false;
  for (;;) {
    attempt++;
    let text = '';
    let started = false;
    const toolCalls: ToolCallRequest[] = [];
    let finish: TurnFinish = 'other';
    let usage: TokenUsage | null = null;
    let failure: unknown;
    try {
      const result = streamText({
        model: request.chat.model,
        system: request.system,
        messages,
        tools,
        toolChoice: tools ? (request.toolChoice ?? 'auto') : undefined,
        maxOutputTokens: request.maxOutputTokens ?? request.chat.spec.maxOutputTokens,
        ...(reasoning ? { reasoning } : {}),
        maxRetries: 0,
        abortSignal: request.signal,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        providerOptions: request.chat.providerOptions as any,
        onError: () => undefined,
      });
      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'text-delta':
            started = true;
            text += part.text;
            request.onTextDelta?.(part.text);
            break;
          // Reasoning is discarded, but it has started the reply: an error after it is not retried.
          case 'reasoning-delta':
            started = true;
            break;
          case 'tool-call': {
            started = true;
            const invalid = 'invalid' in part && part.invalid ? errorText(part.error) : undefined;
            toolCalls.push({
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input,
              invalid,
              ...(part.providerMetadata ? { providerOptions: part.providerMetadata } : {}),
            });
            break;
          }
          case 'start-step':
            if (part.warnings.some(w => /reasoning|effort|thinking/i.test(JSON.stringify(w)))) reasoningIgnored = true;
            break;
          case 'finish-step':
            usage = toUsage(part.usage);
            break;
          case 'finish':
            finish = part.finishReason;
            usage = usage ?? toUsage(part.totalUsage);
            break;
          case 'abort':
            finish = 'aborted';
            break;
          case 'error':
            failure = part.error;
            break;
        }
      }
    } catch (error) {
      failure = error;
    }
    if (request.signal?.aborted) {
      return { text, toolCalls: [], finish: 'aborted', usage, durationMs: Date.now() - start, attempts: attempt };
    }
    if (failure === undefined) {
      const cost = usage && usage.cost === undefined ? await request.chat.takeCost?.() : undefined;
      if (usage && cost !== undefined) usage = { ...usage, cost };
      return {
        text,
        toolCalls,
        finish,
        usage,
        durationMs: Date.now() - start,
        attempts: attempt,
        ...(reasoningDropped ? { reasoningDropped } : {}),
        ...(noneRefused && !reasoningDropped ? { noneRefused } : {}),
        ...(imagesDropped ? { imagesDropped } : {}),
        ...(reasoningIgnored ? { reasoningIgnored } : {}),
      };
    }
    // The same request once more, not counted as an attempt: at Low's value when None's was refused, without the option
    // when a value was refused, or without its images when they were.
    const status = getApiCallStatusCode(failure);
    const fallback = !started && request.fallback !== false;
    if (fallback && reasoning !== undefined && refusesReasoning(status, errorText(failure))) {
      if (noneRetry !== undefined) {
        reasoning = noneRetry;
        noneRetry = undefined;
        noneRefused = true;
      } else {
        reasoning = undefined;
        reasoningDropped = true;
      }
      attempt--;
      continue;
    }
    const stripped = fallback && refusesImages(status, errorText(failure)) ? withoutImages(messages) : null;
    if (stripped) {
      messages = stripped;
      imagesDropped = true;
      attempt--;
      continue;
    }
    if (!started && attempt < policy.attempts && isRetryable(failure)) {
      await sleep(backoffMs(attempt, policy, failure), request.signal);
      if (request.signal?.aborted) {
        return { text, toolCalls: [], finish: 'aborted', usage, durationMs: Date.now() - start, attempts: attempt };
      }
      continue;
    }
    return {
      text,
      // A reply that failed part way runs none of its calls.
      toolCalls: [],
      finish: 'error',
      usage,
      error: {
        message: errorText(failure),
        status: getApiCallStatusCode(failure),
        overflow: isContextOverflow(failure),
        // fetch rejects with a TypeError when the network fails.
        network: unwrapError(failure) instanceof TypeError,
      },
      durationMs: Date.now() - start,
      attempts: attempt,
      ...(reasoningDropped ? { reasoningDropped } : {}),
      ...(imagesDropped ? { imagesDropped } : {}),
    };
  }
}
