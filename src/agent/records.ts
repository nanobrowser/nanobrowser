// Conversation and run records. Every write of a run goes through here, in this order: the assistant message at the end
// of its stream, an intent record before each tool runs (awaited until its transaction completes, so a mutation is
// never dispatched before its intent is on disk), the tool result when it returns, with the layer's structured result
// beside the text the model saw.
import type { Result } from '@src/browser-control';
import { appendEntry, getRun, putRun } from '@src/store/conversations';
import type {
  Entry,
  EntryOf,
  MessageMeta,
  MessagePart,
  PermissionMode,
  RunRecord,
  StoredMessage,
} from '@src/store/types';

/** The fixed label of a note from the extension. */
export const NOTE_LABEL = '[Nanobrowser note:';

/** A note: the extension's own words, in its own part, opened by the label and closed by its bracket. */
export function note(text: string): string {
  return `${NOTE_LABEL} ${text}]`;
}

/**
 * The structured result kept with a tool result: everything the loop's code reads (verification debt, the activity
 * block, the ledger), without the bulk the model already has as text (outlines, screenshots).
 */
export function storedResult(result: Result): unknown {
  const data = result.data as Record<string, unknown> | undefined;
  const lean =
    data && typeof data === 'object'
      ? Object.fromEntries(Object.entries(data).filter(([k]) => k !== 'base64' && k !== 'snapshot'))
      : data;
  return {
    ok: result.ok,
    ...(result.error ? { error: result.error } : {}),
    ...(result.receipt ? { receipt: result.receipt } : {}),
    ...(result.page
      ? {
          page: {
            tabId: result.page.tabId,
            url: result.page.url,
            title: result.page.title,
            rev: result.page.rev,
            changed: result.page.changed,
          },
        }
      : {}),
    ...(result.pageError ? { pageError: result.pageError } : {}),
    ...(result.pending ? { pending: result.pending } : {}),
    ...(lean !== undefined ? { data: lean } : {}),
  };
}

export class RunWriter {
  constructor(
    readonly conversationId: string,
    readonly runId: string,
  ) {}

  message(message: StoredMessage, options: { meta?: MessageMeta; id?: string; result?: unknown } = {}) {
    return appendEntry(
      this.conversationId,
      {
        type: 'message',
        message,
        ...(options.result !== undefined ? { result: options.result } : {}),
        ...(options.meta ? { meta: { ...options.meta, runId: this.runId } } : {}),
      },
      { id: options.id },
    );
  }

  userMessage(text: string, attached: MessagePart[] = []) {
    return this.message({ role: 'user', parts: [{ type: 'text', text }, ...attached] });
  }

  /** A note with no tool result to carry it: an app-owned user message, flagged so it is never the user's. */
  appNote(text: string) {
    return appendEntry(this.conversationId, {
      type: 'message',
      message: { role: 'user', parts: [{ type: 'text', text: note(text) }] },
      appOwned: { kind: 'notice' },
    });
  }

  /**
   * The step's `<browser-state>` header: stored once, before the request is built, and never changed, so each request
   * of a run begins with the one before it.
   */
  appHeader(text: string) {
    return appendEntry(this.conversationId, {
      type: 'message',
      message: { role: 'user', parts: [{ type: 'text', text }] },
      appOwned: { kind: 'header' },
    });
  }

  /** Written, and awaited, before the call runs. */
  intent(toolCallId: string, tool: string, args: unknown): Promise<EntryOf<'intent'>> {
    return appendEntry(this.conversationId, { type: 'intent', toolCallId, tool, args });
  }

  toolResult(
    toolCallId: string,
    toolName: string,
    text: string,
    isError: boolean,
    result?: unknown,
    image?: { data: string; mediaType: string; note: string; thumb?: string },
  ) {
    const parts: MessagePart[] = [{ type: 'tool-result', toolCallId, toolName, text, isError }];
    if (image) parts.push({ type: 'image', ...image });
    return this.message({ role: 'tool', parts }, { result });
  }

  ui(kind: EntryOf<'ui'>['kind'], data: unknown) {
    return appendEntry(this.conversationId, { type: 'ui', kind, data });
  }

  modeChange(mode: PermissionMode) {
    return appendEntry(this.conversationId, { type: 'mode_change', mode });
  }

  /** Updates the run record with a patch, keeping what is not in it. */
  async run(patch: Partial<RunRecord>): Promise<RunRecord | undefined> {
    const current = await getRun(this.conversationId);
    if (!current || current.runId !== this.runId) return current;
    const next = { ...current, ...patch };
    await putRun(next);
    return next;
  }
}

/** The calls of a reply with no result yet (for restore), in their order. */
export function openCalls(branch: Entry[]): Array<{ toolCallId: string; toolName: string; hasIntent: boolean }> {
  const answered = new Set<string>();
  const intents = new Set<string>();
  for (const e of branch) {
    if (e.type === 'intent') intents.add(e.toolCallId);
    if (e.type === 'message' && e.message.role === 'tool') {
      for (const p of e.message.parts) if (p.type === 'tool-result') answered.add(p.toolCallId);
    }
  }
  const lastReply = [...branch].reverse().find(e => e.type === 'message' && e.message.role === 'assistant') as
    EntryOf<'message'> | undefined;
  if (!lastReply) return [];
  return lastReply.message.parts
    .filter((p): p is Extract<MessagePart, { type: 'tool-call' }> => p.type === 'tool-call')
    .filter(p => !answered.has(p.toolCallId))
    .map(p => ({ toolCallId: p.toolCallId, toolName: p.toolName, hasIntent: intents.has(p.toolCallId) }));
}
