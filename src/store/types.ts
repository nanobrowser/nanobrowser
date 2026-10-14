// What the extension stores. Plain JSON, so IndexedDB and chrome.storage hold it as it is.
import type { ReasoningEffort, WireEffort } from '../llm/catalogue';
import type { ProviderKind } from '../llm/providers';

export type PermissionMode = 'ask' | 'auto';

/** Custom instructions: at most this many characters reach the system prompt. */
export const CUSTOM_INSTRUCTIONS_MAX = 1500;

export interface ModelRef {
  providerId: string;
  model: string;
}

/**
 * A live conversation's model and effort, kept for the browser session only, under `nb.live.<conversationId>` in
 * `chrome.storage.session`. Nothing about either is saved with a conversation.
 */
export interface LivePair {
  model: ModelRef;
  reasoning: ReasoningEffort;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Reasoning tokens, counted inside `output`; recorded, not shown. */
  reasoning?: number;
  /** Only when the provider reports it. */
  cost?: number;
}

export const ZERO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  const cost = a.cost !== undefined || b.cost !== undefined ? (a.cost ?? 0) + (b.cost ?? 0) : undefined;
  const reasoning = (a.reasoning ?? 0) + (b.reasoning ?? 0);
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    ...(reasoning ? { reasoning } : {}),
    ...(cost !== undefined ? { cost } : {}),
  };
}

/**
 * Content attached to a user message: page-like data inside the boundary, which context management may replace
 * with a stub. The user's own words are never attached content.
 */
export interface Attached {
  kind: 'outline' | 'file' | 'selection';
  /** For the stub and the panel: a tab and revision, a file name. */
  label: string;
}

export type MessagePart =
  | { type: 'text'; text: string; attached?: Attached }
  /** `note` is the fixed line sent before the image. */
  | {
      type: 'image';
      data: string;
      mediaType: string;
      note: string;
      /** A small JPEG data URL, for the panel only; never sent to the model. */
      thumb?: string;
    }
  | {
      type: 'tool-call';
      toolCallId: string;
      toolName: string;
      input: unknown;
      /** Sent back with the call in history (Gemini 3's thought signature). */
      providerOptions?: Record<string, unknown>;
    }
  | { type: 'tool-result'; toolCallId: string; toolName: string; text: string; isError: boolean }
  /**
   * A file the user attached, stored as a blob with the conversation. Not sent itself: at the start of the run its
   * text is added inside the boundary, or its image after the fixed line, and `inlined` is set.
   */
  | { type: 'attachment'; id: string; name: string; mimeType: string; size: number; inlined?: boolean }
  /**
   * Text the user selected on a page and sent with "Ask Nanobrowser about this". Page text: at the start of the run
   * it is added inside the boundary, with the page's title and address quoted, and `inlined` is set.
   */
  | { type: 'selection'; text: string; url: string; title: string; inlined?: boolean };

/**
 * A message as stored. The extension's own shape, converted to the AI SDK's `ModelMessage` when a request is
 * built (src/llm), so the store does not depend on a library's message types. A tool result is one message per call.
 */
export interface StoredMessage {
  role: 'user' | 'assistant' | 'tool';
  parts: MessagePart[];
}

/** What the panel's message info shows. */
export interface MessageMeta {
  model?: ModelRef;
  /** What the SDK's reasoning option was given for the request, after the row's map; absent when nothing was sent. */
  reasoning?: WireEffort;
  usage?: Usage;
  durationMs?: number;
  stopReason?: string;
  runId?: string;
  /** When the run that wrote the reply began: where the activity block's "Worked for" starts. */
  runStartedAt?: string;
}

/** One line of the action ledger, written by code. */
export interface LedgerLine {
  turn: number;
  tabId?: number;
  kind: 'action' | 'read' | 'write' | 'declined' | 'blocked' | 'handover' | 'file' | 'visit' | 'merged';
  text: string;
  toolCallId?: string;
}

export type EntryBody =
  | {
      type: 'message';
      message: StoredMessage;
      /** For a tool result: the layer's structured result, beside the text the model saw. */
      result?: unknown;
      /** A note or the page header from the extension; never the user's words. */
      appOwned?: { kind: 'notice' | 'header' };
      meta?: MessageMeta;
    }
  | { type: 'ui'; kind: 'write-card' | 'handover' | 'notice' | 'download'; data: unknown }
  | { type: 'intent'; toolCallId: string; tool: string; args: unknown }
  | { type: 'context_edit'; targetId: string; replacement: string | null }
  | {
      type: 'compaction';
      ledger: LedgerLine[];
      summary: string | null;
      firstKeptId: string;
      /** After a shortening: tool results of the recent part up to this entry are cut to 2,000 characters. */
      cutUpTo?: string;
      tokensBefore: number;
      tokensAfter: number;
    }
  /** Written by older versions; the model is now kept with the live conversation instead, and nothing reads it. */
  | { type: 'model_change'; model: ModelRef }
  | { type: 'mode_change'; mode: PermissionMode };

/** An entry of a conversation's append-only tree. */
export type Entry = EntryBody & {
  id: string;
  parentId: string | null;
  conversationId: string;
  at: string;
};

export type EntryOf<T extends EntryBody['type']> = Extract<Entry, { type: T }>;

export type RunStatus = 'idle' | 'running' | 'awaiting_user' | 'interrupted' | 'done' | 'failed' | 'stopped' | 'capped';

export interface Conversation {
  id: string;
  title: string;
  /** The user renamed it; the title no longer follows the first message. */
  titleByUser?: boolean;
  createdAt: string;
  updatedAt: string;
  /** The current leaf of the active branch. */
  leafId: string | null;
  mode: PermissionMode;
  /** The tabs of its group at the last run. */
  tabs: number[];
  /** The last run's status, for History's badge. */
  status: RunStatus;
}

export interface QueuedMessage {
  id: string;
  text: string;
  attachments: string[];
  at: string;
}

export interface GuardState {
  /** Recent calls as "tool args → outcome" signatures, newest last. */
  recent: string[];
  /** Effect-less actions per target. */
  noEffect: Record<string, number>;
  errorsInRow: number;
  /** Plain-text endings after a mutation, and refusals of done(success) in a row. */
  plainEndings: number;
  doneRefusals: number;
}

export const EMPTY_GUARDS: GuardState = { recent: [], noEffect: {}, errorsInRow: 0, plainEndings: 0, doneRefusals: 0 };

export interface DebtItem {
  toolCallId: string;
  tabId: number;
  state: 'open' | 'unverifiable';
  /** For the refusal and the final answer: what the action was. */
  label: string;
}

export interface PendingPrompt {
  kind: 'write-card' | 'handover' | 'ask-user' | 'save-file';
  request: unknown;
  openedAt: string;
  /** Hand-over: the call it answers and that call's partial result. */
  answers?: { toolCallId: string; partialResult: unknown };
}

/** The run record, one per conversation: its latest run. */
export interface RunRecord {
  conversationId: string;
  runId: string;
  leafEntryId: string | null;
  status: RunStatus;
  outcome?: 'success' | 'partial' | 'failed';
  /** How the run ended, or why it is paused. */
  reason?: string;
  steering: QueuedMessage[];
  turns: number;
  usage: Usage;
  debt: DebtItem[];
  guards: GuardState;
  /** The session's tabs, to rebuild the layer session. */
  tabs: number[];
  pendingPrompt?: PendingPrompt;
  /** The run's model as the usage counts name it, kept so a run a restart ends still counts its model's outcome. */
  model?: RunModel;
  startedAt: string;
  updatedAt: string;
}

/** A run's provider, and the catalogue row its model matched. */
export interface RunModel {
  provider: ProviderKind;
  /** The catalogue row the model matched, or `unknown`. */
  modelRow: string;
}

export const UNFINISHED: ReadonlySet<RunStatus> = new Set(['running', 'awaiting_user', 'interrupted']);

/** A file the user attached, stored with its conversation. */
export interface StoredBlob {
  id: string;
  conversationId: string;
  name: string;
  mimeType: string;
  size: number;
  data: Blob;
  createdAt: string;
}

/** A shortcut: its SKILL.md text and how the launcher shows it. */
export interface StoredShortcut {
  id: string;
  text: string;
  pinned: boolean;
  updatedAt: string;
}
