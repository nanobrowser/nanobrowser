import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  activeBranch,
  appendEntry,
  closeDb,
  createConversation,
  deleteConversation,
  getConversation,
  getEntries,
  getRun,
  listConversations,
  listRuns,
  putBlob,
  putRun,
  setLeaf,
  titleFrom,
  updateConversation,
} from '../index';
import { EMPTY_GUARDS, ZERO_USAGE } from '../types';
import type { StoredMessage } from '../types';

const user = (text: string): StoredMessage => ({ role: 'user', parts: [{ type: 'text', text }] });

afterEach(async () => {
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
});

describe('conversations', () => {
  it('appends entries as a tree and reads the active branch', async () => {
    const c = await createConversation({ mode: 'ask' });
    const a = await appendEntry(c.id, { type: 'message', message: user('first') });
    const b = await appendEntry(c.id, {
      type: 'message',
      message: { role: 'assistant', parts: [{ type: 'text', text: 'reply' }] },
    });
    expect(b.parentId).toBe(a.id);
    expect((await activeBranch(c.id)).map(e => e.id)).toEqual([a.id, b.id]);

    // Editing the first message starts a new branch from its parent; the old branch stays in the store.
    const edited = await appendEntry(c.id, { type: 'message', message: user('first, edited') }, { parentId: null });
    expect((await activeBranch(c.id)).map(e => e.id)).toEqual([edited.id]);
    expect(await getEntries(c.id)).toHaveLength(3);
    await setLeaf(c.id, b.id);
    expect((await activeBranch(c.id)).map(e => e.id)).toEqual([a.id, b.id]);
  });

  it('keeps every entry type', async () => {
    const c = await createConversation({ mode: 'auto' });
    await appendEntry(c.id, { type: 'intent', toolCallId: 't1', tool: 'click', args: { target: { ref: 'e1' } } });
    await appendEntry(c.id, { type: 'ui', kind: 'notice', data: { text: 'x' } });
    await appendEntry(c.id, { type: 'context_edit', targetId: 'x', replacement: '[elided]' });
    await appendEntry(c.id, {
      type: 'compaction',
      ledger: [{ turn: 1, kind: 'action', text: 'click' }],
      summary: null,
      firstKeptId: 'x',
      tokensBefore: 10,
      tokensAfter: 5,
    });
    await appendEntry(c.id, { type: 'model_change', model: { providerId: 'p', model: 'n' } });
    await appendEntry(c.id, { type: 'mode_change', mode: 'ask' });
    expect((await activeBranch(c.id)).map(e => e.type)).toEqual([
      'intent',
      'ui',
      'context_edit',
      'compaction',
      'model_change',
      'mode_change',
    ]);
  });

  it('lists newest first, searches titles, renames and deletes everything of a conversation', async () => {
    const old = await createConversation({ mode: 'ask', title: 'Compare laptops' });
    await new Promise(r => setTimeout(r, 5));
    const recent = await createConversation({ mode: 'ask', title: 'Book a table' });
    expect((await listConversations()).map(c => c.id)).toEqual([recent.id, old.id]);
    expect((await listConversations('LAPTOP')).map(c => c.id)).toEqual([old.id]);

    await updateConversation(old.id, { title: 'Laptops', titleByUser: true });
    expect((await getConversation(old.id))?.title).toBe('Laptops');

    await appendEntry(old.id, { type: 'message', message: user('hi') });
    await putBlob({
      id: 'b1',
      conversationId: old.id,
      name: 'a.txt',
      mimeType: 'text/plain',
      size: 1,
      data: new Blob(['a']),
      createdAt: '',
    });
    await putRun({
      conversationId: old.id,
      runId: 'r1',
      leafEntryId: null,
      status: 'done',
      steering: [],
      turns: 1,
      usage: ZERO_USAGE,
      debt: [],
      guards: EMPTY_GUARDS,
      tabs: [],
      startedAt: '',
      updatedAt: '',
    });
    expect(await getRun(old.id)).toBeDefined();
    await deleteConversation(old.id);
    expect(await getConversation(old.id)).toBeUndefined();
    expect(await getEntries(old.id)).toEqual([]);
    expect(await listRuns()).toEqual([]);
  });

  it('refuses an entry for a conversation that does not exist', async () => {
    await expect(appendEntry('nope', { type: 'mode_change', mode: 'ask' })).rejects.toThrow(/does not exist/);
  });
});

describe('titleFrom', () => {
  it('takes the start of the first message on one line', () => {
    expect(titleFrom('  Compare\nthe   laptops ')).toBe('Compare the laptops');
    const long = titleFrom('x'.repeat(100));
    expect(long).toHaveLength(60);
    expect(long.endsWith('…')).toBe(true);
  });
});
