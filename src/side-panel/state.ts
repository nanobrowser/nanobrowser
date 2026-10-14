// The panel's state, built only from the worker's events.
import type { Conversation, LivePair, QueuedMessage, RunStatus } from '@src/store/types';
import type {
  AttachmentRef,
  ConversationSummary,
  DisplayEntry,
  OpenPrompt,
  PanelEvent,
  ScopeTab,
  ToolRow,
} from '@src/ui/protocol';

export interface PanelState {
  loaded: boolean;
  conversationId: string | null;
  conversation: Conversation | null;
  /** The conversation's live model and effort; null when it has none and the panel makes one. */
  live: LivePair | null;
  entries: DisplayEntry[];
  streaming: { id: string; text: string } | null;
  status: RunStatus;
  reason?: string;
  /** When the latest run began: the live elapsed time of the activity block. */
  startedAt?: string;
  queue: QueuedMessage[];
  /** Queued messages given back on Stop, for the composer. */
  returned: QueuedMessage[];
  prompts: OpenPrompt[];
  error: string | null;
  history: ConversationSummary[];
  /** The conversation's tabs. */
  tabs: ScopeTab[];
  /** Files the worker made for the composer (a screenshot of the tab), oldest first; the app takes them. */
  attached: Array<{ ref: AttachmentRef; preview?: string }>;
  /** Selections sent with "Ask Nanobrowser about this", oldest first; the app takes them. */
  selections: Array<{ text: string; url: string; title: string }>;
}

export const INITIAL: PanelState = {
  loaded: false,
  conversationId: null,
  conversation: null,
  live: null,
  entries: [],
  streaming: null,
  status: 'idle',
  queue: [],
  returned: [],
  prompts: [],
  error: null,
  history: [],
  tabs: [],
  attached: [],
  selections: [],
};

function upsert(entries: DisplayEntry[], entry: DisplayEntry): DisplayEntry[] {
  const i = entries.findIndex(e => e.id === entry.id);
  if (i < 0) return [...entries, entry];
  const next = entries.slice();
  next[i] = entry;
  return next;
}

function updateRow(entries: DisplayEntry[], messageId: string, row: ToolRow): DisplayEntry[] {
  return entries.map(e => {
    if (e.kind !== 'assistant' || e.id !== messageId) return e;
    const i = e.tools.findIndex(r => r.toolCallId === row.toolCallId);
    const tools = i < 0 ? [...e.tools, row] : e.tools.map((r, j) => (j === i ? { ...r, ...row } : r));
    return { ...e, tools };
  });
}

export function reduce(state: PanelState, event: PanelEvent): PanelState {
  switch (event.type) {
    case 'bound':
      return event.conversationId === state.conversationId
        ? state
        : { ...INITIAL, conversationId: event.conversationId };
    case 'snapshot':
      return {
        ...state,
        loaded: true,
        conversationId: event.conversation?.id ?? null,
        conversation: event.conversation,
        live: event.live ?? null,
        entries: event.entries,
        status: event.status,
        reason: event.reason,
        startedAt: event.startedAt,
        queue: event.queue,
        prompts: event.prompts,
        streaming: event.streaming ?? null,
        error: null,
      };
    case 'message_start':
      return { ...state, streaming: { id: event.id, text: '' } };
    case 'message_update':
      return { ...state, streaming: { id: event.id, text: event.text } };
    case 'message_end':
      return {
        ...state,
        entries: upsert(state.entries, event.entry),
        streaming: state.streaming?.id === event.entry.id ? null : state.streaming,
      };
    case 'agent_end':
      return { ...state, streaming: null };
    case 'tool_execution_start':
    case 'tool_execution_update':
    case 'tool_execution_end':
      return { ...state, entries: updateRow(state.entries, event.messageId, event.row) };
    case 'conversation':
      return event.conversation.id === state.conversationId ? { ...state, conversation: event.conversation } : state;
    case 'live':
      return event.conversationId === state.conversationId ? { ...state, live: event.pair } : state;
    case 'run_status':
      return { ...state, status: event.status, reason: event.reason, startedAt: event.startedAt ?? state.startedAt };
    case 'queue':
      return { ...state, queue: event.items, returned: event.returned ?? state.returned };
    case 'prompt_open':
      return { ...state, prompts: [...state.prompts.filter(p => p.id !== event.prompt.id), event.prompt] };
    case 'prompt_closed':
      return { ...state, prompts: state.prompts.filter(p => p.id !== event.id) };
    case 'history':
      return { ...state, history: event.items };
    case 'tabs':
      return { ...state, tabs: event.tabs };
    case 'error':
      return { ...state, error: event.message };
    case 'selection':
      return { ...state, selections: [...state.selections, { text: event.text, url: event.url, title: event.title }] };
    case 'attached':
      return { ...state, attached: [...state.attached, { ref: event.ref, preview: event.preview }] };
    default:
      return state;
  }
}

export function isActive(status: RunStatus): boolean {
  return status === 'running' || status === 'awaiting_user';
}
