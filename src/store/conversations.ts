// Conversations as append-only entry trees. The active branch is the path from the root to the conversation's leaf.
// Each write is awaited until its transaction completes, so an entry the caller was told about is on disk (the intent
// record before a mutation relies on this).
import { db } from './db';
import type { Conversation, Entry, EntryBody, PermissionMode, RunRecord, StoredBlob } from './types';

export const TITLE_LENGTH = 60;

function now(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

/** A title from the user's first message: its start, on one line. */
export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line.length <= TITLE_LENGTH) return line;
  return `${line.slice(0, TITLE_LENGTH - 1).trimEnd()}…`;
}

/**
 * A record without the model field that older versions stored (the model now lives with the live conversation):
 * writes spread the stored record, so the field is dropped on the next write.
 */
function current(record: Conversation): Conversation {
  if (!('model' in record)) return record;
  const copy = { ...record } as Conversation & { model?: unknown };
  delete copy.model;
  return copy;
}

export async function createConversation(init: {
  mode: PermissionMode;
  title?: string;
  tabs?: number[];
}): Promise<Conversation> {
  const at = now();
  const conversation: Conversation = {
    id: newId(),
    title: init.title ?? '',
    createdAt: at,
    updatedAt: at,
    leafId: null,
    mode: init.mode,
    tabs: init.tabs ?? [],
    status: 'idle',
  };
  await (await db()).put('conversations', conversation);
  return conversation;
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
  return (await db()).get('conversations', id);
}

/** Newest first. A query matches the title, case-insensitively. */
export async function listConversations(query?: string): Promise<Conversation[]> {
  const all = await (await db()).getAllFromIndex('conversations', 'updatedAt');
  const q = query?.trim().toLowerCase();
  return all.reverse().filter(c => !q || c.title.toLowerCase().includes(q));
}

export async function updateConversation(
  id: string,
  patch: Partial<Omit<Conversation, 'id' | 'createdAt'>>,
): Promise<Conversation | undefined> {
  const database = await db();
  const tx = database.transaction('conversations', 'readwrite');
  const stored = await tx.store.get(id);
  if (!stored) {
    await tx.done;
    return undefined;
  }
  const next = { ...current(stored), ...patch, updatedAt: patch.updatedAt ?? now() };
  await tx.store.put(next);
  await tx.done;
  return next;
}

/** Deletes a conversation with its entries, attachments and run record. */
export async function deleteConversation(id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(['conversations', 'entries', 'blobs', 'runs'], 'readwrite');
  await tx.objectStore('conversations').delete(id);
  for (const store of ['entries', 'blobs'] as const) {
    const keys = await tx.objectStore(store).index('conversationId').getAllKeys(id);
    for (const key of keys) await tx.objectStore(store).delete(key);
  }
  await tx.objectStore('runs').delete(id);
  await tx.done;
}

/**
 * Appends an entry under `parentId` (default: the current leaf) and makes it the leaf, in one transaction.
 * Resolves once the transaction is complete.
 */
export async function appendEntry<T extends EntryBody>(
  conversationId: string,
  body: T,
  options: { parentId?: string | null; keepLeaf?: boolean; id?: string } = {},
): Promise<Entry & T> {
  const database = await db();
  const tx = database.transaction(['conversations', 'entries'], 'readwrite');
  const conversations = tx.objectStore('conversations');
  const conversation = await conversations.get(conversationId);
  if (!conversation) {
    await tx.done;
    throw new Error(`Conversation ${conversationId} does not exist`);
  }
  const entry = {
    ...body,
    id: options.id ?? newId(),
    parentId: options.parentId !== undefined ? options.parentId : conversation.leafId,
    conversationId,
    at: now(),
  } as Entry & T;
  await tx.objectStore('entries').put(entry);
  if (!options.keepLeaf) await conversations.put({ ...current(conversation), leafId: entry.id, updatedAt: entry.at });
  await tx.done;
  return entry;
}

/** Replaces an entry in place (used for entries that are updated as they complete, never for messages sent). */
export async function putEntry(entry: Entry): Promise<void> {
  await (await db()).put('entries', entry);
}

export async function getEntries(conversationId: string): Promise<Entry[]> {
  return (await db()).getAllFromIndex('entries', 'conversationId', conversationId);
}

/** The path from the root to `leafId` (default: the conversation's leaf), oldest first. */
export async function activeBranch(conversationId: string, leafId?: string | null): Promise<Entry[]> {
  const conversation = await getConversation(conversationId);
  const leaf = leafId !== undefined ? leafId : (conversation?.leafId ?? null);
  return branchFrom(await getEntries(conversationId), leaf);
}

export function branchFrom(entries: Entry[], leafId: string | null): Entry[] {
  const byId = new Map(entries.map(e => [e.id, e]));
  const path: Entry[] = [];
  let id = leafId;
  while (id) {
    const entry = byId.get(id);
    if (!entry) break;
    path.push(entry);
    id = entry.parentId;
  }
  return path.reverse();
}

export async function setLeaf(conversationId: string, leafId: string | null): Promise<void> {
  await updateConversation(conversationId, { leafId });
}

export async function getRun(conversationId: string): Promise<RunRecord | undefined> {
  return (await db()).get('runs', conversationId);
}

export async function putRun(run: RunRecord): Promise<void> {
  await (await db()).put('runs', { ...run, updatedAt: now() });
}

export async function listRuns(): Promise<RunRecord[]> {
  return (await db()).getAll('runs');
}

export async function putBlob(blob: StoredBlob): Promise<void> {
  await (await db()).put('blobs', blob);
}

export async function getBlob(id: string): Promise<StoredBlob | undefined> {
  return (await db()).get('blobs', id);
}

export async function listBlobs(conversationId: string): Promise<StoredBlob[]> {
  return (await db()).getAllFromIndex('blobs', 'conversationId', conversationId);
}

export async function deleteEverything(): Promise<void> {
  const database = await db();
  const names = ['conversations', 'entries', 'runs', 'blobs'] as const;
  const tx = database.transaction([...names], 'readwrite');
  await Promise.all(names.map(name => tx.objectStore(name).clear()));
  await tx.done;
}
