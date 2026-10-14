// One run of the agent in a conversation. `runChat` has no tools: one model call, its reply written as a message entry.
// Chrome is reached only through what is passed in.
import { streamTurn } from '@src/llm';
import type { ChatModel, LearntFacts, ModelProfile, ReasoningEffort, TurnResult, WireEffort } from '@src/llm';
import { requestOutputLimit, wireEffort } from '@src/llm/profiles';
import { activeBranch, appendEntry, newId } from '@src/store/conversations';
import type { ModelRef, RunStatus, Usage } from '@src/store/types';
import { ZERO_USAGE } from '@src/store/types';
import type { AgentEvent } from '@src/ui/protocol';
import { toModelMessages } from './context';
import { assistantDisplay } from './display';

export interface ResolvedModel {
  ref: ModelRef;
  chat: ChatModel;
  profile: ModelProfile;
  /** The conversation's effort for this run. */
  reasoning: ReasoningEffort;
  /**
   * The server refused the reasoning option: nothing is sent for the rest
   * of the run, by every call that reads this handle. Never stored.
   */
  reasoningDropped?: boolean;
  /**
   * Keeps what a run learnt about the model on its entry: None refused,
   * images refused. Set by the worker; absent in tests.
   */
  learn?: (facts: Omit<LearntFacts, 'at'>) => void;
}

/** What a call sends about reasoning: the run's effort, or another (the summary's None), as the model takes it. */
export function sentEffort(model: ResolvedModel, effort: ReasoningEffort = model.reasoning): WireEffort | undefined {
  return model.reasoningDropped ? undefined : wireEffort(model.profile, effort);
}

/** What a call sends, with Low's value to try once if the server refuses None's. */
export function turnEffort(
  model: ResolvedModel,
  effort: ReasoningEffort = model.reasoning,
): { reasoning?: WireEffort; noneRetry?: WireEffort } {
  const reasoning = sentEffort(model, effort);
  const low = effort === 'none' && reasoning !== undefined ? sentEffort(model, 'low') : undefined;
  return { reasoning, ...(low && low !== reasoning ? { noneRetry: low } : {}) };
}

/**
 * What a reply taught the run: a refused level stops the option for the run; a refused None makes the model `always`
 * for the run and is kept; refused images take vision away for the run and are kept.
 */
export function learnFrom(model: ResolvedModel, reply: TurnResult): void {
  if (reply.reasoningDropped) model.reasoningDropped = true;
  if (reply.noneRefused) {
    model.profile = { ...model.profile, reasoning: 'always' };
    model.learn?.({ acceptsNone: false });
  }
  if (reply.imagesDropped && model.profile.vision) {
    model.profile = { ...model.profile, vision: false };
    model.learn?.({ vision: false });
  }
}

export interface RunOptions {
  conversationId: string;
  runId: string;
  model: ResolvedModel;
  system: string;
  signal: AbortSignal;
  emit: (event: AgentEvent) => void;
}

export interface RunEnd {
  status: RunStatus;
  outcome?: 'success' | 'partial' | 'failed';
  reason?: string;
  usage: Usage;
  turns: number;
}

export async function runChat(options: RunOptions): Promise<RunEnd> {
  const { conversationId, model, emit, signal } = options;
  emit({ type: 'agent_start', runId: options.runId });
  emit({ type: 'turn_start', turn: 1 });
  const branch = await activeBranch(conversationId);
  const messages = toModelMessages(branch, { vision: model.profile.vision });
  const id = newId();
  emit({ type: 'message_start', id });
  let text = '';
  const result = await streamTurn({
    chat: model.chat,
    system: options.system,
    messages,
    maxOutputTokens: requestOutputLimit(model.profile),
    signal,
    onTextDelta: delta => {
      text += delta;
      emit({ type: 'message_update', id, text });
    },
  });
  const usage: Usage = result.usage ? { ...ZERO_USAGE, ...result.usage } : ZERO_USAGE;
  let end: RunEnd;
  if (result.finish === 'aborted') end = { status: 'stopped', usage, turns: 1 };
  else if (result.error) end = { status: 'failed', outcome: 'failed', reason: result.error.message, usage, turns: 1 };
  else end = { status: 'done', outcome: 'success', usage, turns: 1 };
  // The reply is kept, partial text included, unless nothing streamed.
  if (result.text) {
    const entry = await appendEntry(
      conversationId,
      {
        type: 'message',
        message: { role: 'assistant', parts: [{ type: 'text', text: result.text }] },
        meta: {
          model: model.ref,
          usage,
          durationMs: result.durationMs,
          stopReason: result.finish,
          runId: options.runId,
        },
      },
      { id },
    );
    emit({ type: 'message_end', entry: assistantDisplay(entry) });
  }
  emit({ type: 'turn_end', turn: 1 });
  emit({ type: 'agent_end', runId: options.runId });
  return end;
}
