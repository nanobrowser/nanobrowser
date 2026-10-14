// The scripted model: a fake provider that returns prepared replies, so the loop can be tested with no network and no
// randomness. Each `doStream` call takes the next reply, or asks a function for it; every request is recorded, so tests
// can check what the model was sent.
import type { LanguageModel } from 'ai';
import type { ChatModel } from './providers';

export interface ScriptedReply {
  text?: string;
  toolCalls?: Array<{ name: string; input: unknown; id?: string }>;
  /** Default: 'tool-calls' when there are calls, else 'stop'. */
  finish?: 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'error' | 'other';
  usage?: { input: number; output: number; reasoning?: number };
  /** Rejected before anything streams, as a provider's HTTP error would be. */
  error?: unknown;
  /** Sent as an error part after the text, as a stream cut off part way. */
  streamError?: unknown;
  /** Waits this long before finishing; aborting the request ends the wait. */
  delayMs?: number;
}

/** A request as the provider received it. */
export interface ScriptedCall {
  prompt: Array<{ role: string; content: unknown }>;
  tools: Array<{ name: string; description?: string }>;
  toolChoice?: unknown;
  maxOutputTokens?: number;
  /** The SDK's reasoning option as the provider received it. */
  reasoning?: string;
}

type Script = ScriptedReply[] | ((call: ScriptedCall, index: number) => ScriptedReply | Promise<ScriptedReply>);

export class ScriptedModel {
  readonly calls: ScriptedCall[] = [];
  #script: Script;

  constructor(script: Script) {
    this.#script = script;
  }

  /** Adds replies to the end of a list script. */
  push(...replies: ScriptedReply[]): void {
    if (Array.isArray(this.#script)) this.#script.push(...replies);
  }

  #next(call: ScriptedCall): ScriptedReply | Promise<ScriptedReply> {
    const index = this.calls.length - 1;
    if (typeof this.#script === 'function') return this.#script(call, index);
    const reply = this.#script[index];
    if (!reply) throw new Error(`scripted model: no reply left for request ${index + 1}`);
    return reply;
  }

  /** The model as the AI SDK takes it (a LanguageModelV4). */
  get model(): LanguageModel {
    const doStream = async (options: {
      prompt: ScriptedCall['prompt'];
      tools?: Array<{ name: string; description?: string }>;
      toolChoice?: unknown;
      maxOutputTokens?: number;
      reasoning?: string;
      abortSignal?: AbortSignal;
    }) => {
      const call: ScriptedCall = {
        prompt: options.prompt,
        tools: (options.tools ?? []).map(t => ({ name: t.name, description: t.description })),
        toolChoice: options.toolChoice,
        maxOutputTokens: options.maxOutputTokens,
        ...(options.reasoning ? { reasoning: options.reasoning } : {}),
      };
      this.calls.push(call);
      const reply = await this.#next(call);
      if (reply.error !== undefined) throw reply.error;
      const signal = options.abortSignal;
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          if (reply.text) {
            controller.enqueue({ type: 'text-start', id: 't' });
            controller.enqueue({ type: 'text-delta', id: 't', delta: reply.text });
            controller.enqueue({ type: 'text-end', id: 't' });
          }
          if (reply.streamError !== undefined) {
            controller.enqueue({ type: 'error', error: reply.streamError });
            controller.close();
            return;
          }
          (reply.toolCalls ?? []).forEach((c, i) =>
            controller.enqueue({
              type: 'tool-call',
              toolCallId: c.id ?? `call_${i + 1}`,
              toolName: c.name,
              input: typeof c.input === 'string' ? c.input : JSON.stringify(c.input ?? {}),
            }),
          );
          if (reply.delayMs) {
            await new Promise<void>(resolve => {
              const timer = setTimeout(resolve, reply.delayMs);
              signal?.addEventListener('abort', () => {
                clearTimeout(timer);
                resolve();
              });
            });
          }
          const unified = reply.finish ?? (reply.toolCalls?.length ? 'tool-calls' : 'stop');
          controller.enqueue({
            type: 'finish',
            finishReason: { unified, raw: unified },
            usage: {
              inputTokens: {
                total: reply.usage?.input ?? 100,
                noCache: reply.usage?.input ?? 100,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: {
                total: reply.usage?.output ?? 10,
                text: (reply.usage?.output ?? 10) - (reply.usage?.reasoning ?? 0),
                reasoning: reply.usage?.reasoning ?? 0,
              },
            },
          });
          controller.close();
        },
      });
      return { stream };
    };
    return {
      specificationVersion: 'v4',
      provider: 'scripted',
      modelId: 'scripted',
      supportedUrls: {},
      doGenerate: () => Promise.reject(new Error('scripted model: only streaming is supported')),
      doStream,
    } as unknown as LanguageModel;
  }

  chat(overrides: Partial<ChatModel['spec']> = {}): ChatModel {
    return { spec: { kind: 'openai-compatible', modelName: 'scripted', ...overrides }, model: this.model };
  }
}
