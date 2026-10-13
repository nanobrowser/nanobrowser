// What the old Nanobrowser (0.2) left in chrome.storage.local. This version replaces it as an update, so its data is
// still there: the worker moves what it can on its first start (src/extension/upgrade.ts), and the old conversations
// stay until the user exports or deletes them in Settings → Data.
import { createStorage } from './storage';

/** The old version's keys other than its conversations. All are removed once the move is stored. */
export const OLD_KEYS = [
  'llm-api-keys',
  'agent-models',
  'favorites',
  'firewall-settings',
  'general-settings',
  'speech-to-text-model',
  'analytics-settings',
  'user-profile',
] as const;

/** The list of the old conversations; each has its messages and its agent's step record under keys of its own. */
export const OLD_CHATS_KEY = 'chat_sessions_meta';

export function isOldChatKey(key: string): boolean {
  return key === OLD_CHATS_KEY || key.startsWith('chat_messages_') || key.startsWith('chat_agent_step_');
}

/** What the move found, for the panel's card. Written once, with the moved settings. */
export interface UpgradeRecord {
  at: string;
  /** Saved prompts that became shortcuts. */
  favorites: number;
  /** Blocked sites that became Block rules, and entries that could not become one. */
  blockedSites: number;
  skippedSites: number;
  /** The old version let the agent open only the sites on a list, which this version cannot do. */
  allowList: boolean;
  /**
   * The old version's "Help improve Nanobrowser" switch, on unless the user turned it off (it was on by default there).
   * Kept so that analytics, when this version has it, starts as the user left it.
   */
  analytics?: boolean;
  /** The user closed the card. The record stays, so the move never runs again. */
  dismissed: boolean;
}

export const UPGRADE_KEY = 'nb.upgrade';

export const upgradeStorage = createStorage<UpgradeRecord | null>(UPGRADE_KEY, null, { liveUpdate: true });

export interface OldChat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface OldMessage {
  actor: string;
  content: string;
  timestamp: number;
}

export const oldChatsStorage = createStorage<OldChat[]>(OLD_CHATS_KEY, [], {
  liveUpdate: true,
  merge: stored => (Array.isArray(stored) ? (stored as OldChat[]) : []),
});

const ACTORS: Record<string, string> = {
  user: 'User',
  planner: 'Planner',
  navigator: 'Navigator',
  validator: 'Validator',
  system: 'System',
};

const pad = (n: number) => String(n).padStart(2, '0');

/** A local date and time as `2026-10-12 14:03`. */
export function localTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The old conversations as one Markdown file: newest first, each message under its actor's name and time. */
export function oldChatsMarkdown(chats: Array<{ chat: OldChat; messages: OldMessage[] }>, exportedAt: number): string {
  const lines = ['# Nanobrowser v0.2: legacy conversations', '', `Exported on ${localTime(exportedAt)}.`];
  const newestFirst = [...chats].sort((a, b) => (b.chat.updatedAt ?? 0) - (a.chat.updatedAt ?? 0));
  for (const { chat, messages } of newestFirst) {
    lines.push('', `## ${chat.title?.trim() || 'Untitled'}`, '', localTime(chat.createdAt ?? 0));
    for (const m of messages) {
      lines.push('', `**${ACTORS[m.actor] ?? m.actor}** · ${localTime(m.timestamp ?? 0)}`, '', String(m.content ?? ''));
    }
  }
  return `${lines.join('\n')}\n`;
}

export function oldChatsFilename(exportedAt: number): string {
  return `nanobrowser-v0.2-conversations-${localTime(exportedAt).slice(0, 10)}.md`;
}

/** Reads every old conversation with its messages. */
export async function readOldChats(): Promise<Array<{ chat: OldChat; messages: OldMessage[] }>> {
  const chats = await oldChatsStorage.get();
  const keys = chats.map(c => `chat_messages_${c.id}`);
  const stored = keys.length ? await chrome.storage.local.get(keys) : {};
  return chats.map(chat => {
    const messages = stored[`chat_messages_${chat.id}`];
    return { chat, messages: Array.isArray(messages) ? (messages as OldMessage[]) : [] };
  });
}

/** Removes the old conversations: their list, their messages and their agent's step records. */
export async function deleteOldChats(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(isOldChatKey);
  if (keys.length) await chrome.storage.local.remove(keys);
}
