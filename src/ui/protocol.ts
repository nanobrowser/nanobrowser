// The panel protocol: one chrome.runtime Port per panel document, commands from the panel and events from the worker.
// The panel never reads the stores itself; it draws what the worker sends.
import type { ReasoningEffort } from '@src/llm/catalogue';
import type {
  Conversation,
  LivePair,
  ModelRef,
  PermissionMode,
  QueuedMessage,
  RunStatus,
  Usage,
} from '@src/store/types';

export const PANEL_PORT_NAME = 'nb-panel';

export interface AttachmentRef {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

/** Context chips sent with a message: shared tabs and a quoted selection. */
export type ContextRef =
  { kind: 'tab'; tabId: number } | { kind: 'selection'; text: string; url: string; title: string };

export type PanelCommand =
  /** The panel of `tabId` shows the conversation the tab belongs to, or an empty one. */
  | { type: 'subscribe'; tabId: number; conversationId?: string | null; sinceSeq?: number }
  | {
      type: 'send';
      tabId: number;
      conversationId: string | null;
      text: string;
      attachments: AttachmentRef[];
      context: ContextRef[];
      mode: PermissionMode;
      /** The conversation's model and effort: the worker writes them as its live pair. */
      model: ModelRef | null;
      reasoning: ReasoningEffort;
      /** A shortcut's start page: opened in the tab before the run starts. */
      startUrl?: string;
      /** The message is a saved shortcut's, for the usage counts. */
      shortcut?: true;
    }
  | {
      type: 'queue';
      conversationId: string;
      id: string;
      text: string;
      attachments: AttachmentRef[];
      context: ContextRef[];
    }
  | { type: 'unqueue'; conversationId: string; id: string }
  | { type: 'new-chat'; tabId: number }
  | { type: 'compact'; conversationId: string }
  | { type: 'stop' | 'resume' | 'continue'; conversationId: string }
  | { type: 'answer'; promptId: string; answer: unknown }
  | { type: 'edit' | 'restart'; conversationId: string; entryId: string; text?: string }
  | { type: 'retry'; conversationId: string }
  | { type: 'set-mode'; conversationId: string; mode: PermissionMode }
  /** Writes the conversation's live pair, and the settings: the latest choice is the default. */
  | { type: 'set-model'; conversationId: string; model: ModelRef; reasoning: ReasoningEffort }
  | { type: 'history'; query?: string }
  /**
   * Recent tasks shows a conversation in this tab's panel without binding the tab to it. The tab moves to it only when
   * the user takes it up: sends, edits, restarts, retries, continues or resumes.
   */
  | { type: 'open'; conversationId: string; tabId: number }
  | { type: 'rename'; conversationId: string; title: string }
  | { type: 'delete'; conversationId: string; closeAgentTabs?: boolean }
  /** Export as Markdown: answered with an `export` event to this panel. */
  | { type: 'export'; conversationId: string }
  | { type: 'share-tab' | 'unshare-tab'; conversationId: string; tabId: number }
  /** "Screenshot of this tab": taken through the layer, answered with an `attached` event. */
  | { type: 'screenshot-tab'; tabId: number; conversationId: string | null }
  /** Voice input was used, for the usage counts. */
  | { type: 'voice-used' };

/** A tool row of the activity block. */
export interface ToolRow {
  toolCallId: string;
  tool: string;
  args: unknown;
  status: 'running' | 'done' | 'failed' | 'skipped' | 'waiting';
  /** The layer's structured result, or an agent tool's. */
  result?: unknown;
  /** The text the model saw. */
  text?: string;
  /** How a write was allowed. */
  allowedBy?: 'user' | 'site-rule' | 'auto';
  /** A screenshot's thumbnail, as a data URL. */
  thumbnail?: string;
}

/**
 * The rows of a run's activity block: the outline the loop sent with the user's message comes first, as the page the
 * agent read, and a `done` that went through is left out, since the answer below it says as much.
 */
export function runRows(tools: ToolRow[], opened?: { messageId: string }): ToolRow[] {
  const rows = tools.filter(r => r.tool !== 'done' || r.status === 'failed' || r.status === 'skipped');
  if (!opened) return rows;
  const read: ToolRow = {
    toolCallId: `opened:${opened.messageId}`,
    tool: 'opened',
    args: undefined,
    status: 'done',
  };
  return [read, ...rows];
}

/** What the panel draws for one entry. */
export type DisplayEntry =
  | {
      kind: 'user';
      id: string;
      text: string;
      attachments?: AttachmentRef[];
      /** Selections sent with the message. */
      quotes?: Array<{ text: string; url: string; title: string }>;
      /** The page outline the loop sent with the message when the run began. */
      opened?: true;
      at: string;
    }
  | {
      kind: 'assistant';
      id: string;
      text: string;
      at: string;
      model?: ModelRef;
      usage?: Usage;
      durationMs?: number;
      /** When the run that wrote the reply began. */
      runStartedAt?: string;
      stopReason?: string;
      tools: ToolRow[];
    }
  | { kind: 'notice'; id: string; text: string; tone: 'info' | 'warn' | 'error'; at: string }
  /** A file the agent saved, with Open and Show in folder. */
  | { kind: 'download'; id: string; name: string; downloadId: number; bytes: number; at: string };

export interface OpenPrompt {
  id: string;
  kind: 'write-card' | 'handover' | 'ask-takeover' | 'ask-input' | 'save-file' | 'confirm';
  conversationId: string;
  tabId?: number;
  /** Everything the card shows; fixed titles and lines are the panel's own strings. */
  data: Record<string, unknown>;
  openedAt: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  status: RunStatus;
  /** Tabs the agent opened, which ending the conversation may close. */
  agentTabs: number;
  /**
   * The conversation's tabs in this browser session, the one it started in first. Empty for a past conversation; one
   * that has tabs is opened in its own tab rather than shown in a second panel.
   */
  tabs: number[];
}

export interface ScopeTab {
  tabId: number;
  title: string;
  url: string;
  favIconUrl?: string;
  /** The agent opened it, or the user shared it. */
  origin: 'agent' | 'user' | 'start';
}

export type AgentEvent =
  | { type: 'agent_start'; runId: string }
  | { type: 'agent_end'; runId: string }
  | { type: 'turn_start'; turn: number }
  | { type: 'turn_end'; turn: number }
  /** A model reply begins streaming. */
  | { type: 'message_start'; id: string }
  /** The text so far of the streaming reply (deltas coalesced to about 50 ms). */
  | { type: 'message_update'; id: string; text: string }
  /** An entry was written: the panel adds or replaces it by id. */
  | { type: 'message_end'; entry: DisplayEntry }
  | { type: 'tool_execution_start'; messageId: string; row: ToolRow }
  | { type: 'tool_execution_update'; messageId: string; row: ToolRow }
  | { type: 'tool_execution_end'; messageId: string; row: ToolRow }
  /** Compaction ran. */
  | { type: 'compacted'; tokensBefore: number; tokensAfter: number };

export type PanelEventBody =
  | AgentEvent
  /** `startedAt`: when the conversation's latest run began, for the activity block's elapsed time. */
  | { type: 'run_status'; status: RunStatus; reason?: string; startedAt?: string }
  /** The conversation's record changed: title, mode. */
  | { type: 'conversation'; conversation: Conversation }
  /** The conversation's live model and effort changed. */
  | { type: 'live'; pair: LivePair }
  | { type: 'prompt_open'; prompt: OpenPrompt }
  | { type: 'prompt_closed'; id: string; outcome: string }
  | {
      type: 'snapshot';
      conversation: Conversation | null;
      entries: DisplayEntry[];
      status: RunStatus;
      reason?: string;
      /** When the latest run began. */
      startedAt?: string;
      queue: QueuedMessage[];
      prompts: OpenPrompt[];
      /** The reply streaming now, if any. */
      streaming?: { id: string; text: string };
      /** The live pair from `storage.session`; absent when there is none and the panel makes one. */
      live?: LivePair;
    }
  | { type: 'queue'; items: QueuedMessage[]; returned?: QueuedMessage[] }
  | { type: 'usage'; turn: Usage; total: Usage }
  | { type: 'history'; items: ConversationSummary[] }
  | { type: 'tabs'; tabs: ScopeTab[] }
  /** Text the user selected with "Ask Nanobrowser about this": a quote chip in the composer. */
  | { type: 'selection'; text: string; url: string; title: string }
  /** A file the worker made for the composer (a screenshot of the tab), with a thumbnail. */
  | { type: 'attached'; ref: AttachmentRef; preview?: string }
  /** The conversation this panel now shows: its tab's, a new one, or one opened from Recent tasks. */
  | { type: 'bound'; conversationId: string | null }
  | { type: 'export'; conversationId: string; filename: string; markdown: string }
  | { type: 'error'; message: string };

export type PanelEvent = PanelEventBody & { seq: number; conversationId: string | null };

/**
 * Settings → Data deletes everything through the worker, which stops running tasks first:
 * `{ type: DATA_REQUEST, op: 'delete-all' }`, answered with `{ ok: true }`.
 */
export const DATA_REQUEST = 'nb.data';
