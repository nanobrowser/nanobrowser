import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { activeBranch, createConversation, getRun, putRun } from '@src/store/conversations';
import { closeDb } from '@src/store/db';
import { EMPTY_GUARDS, ZERO_USAGE } from '@src/store/types';
import { note, openCalls, RunWriter, storedResult } from '../records';
import { toModelMessages } from '../context';

afterEach(async () => {
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
});

describe('run records', () => {
  it('writes every entry type in order, the intent before the result', async () => {
    const c = await createConversation({ mode: 'ask' });
    const w = new RunWriter(c.id, 'r1');
    await w.userMessage('Book a table', [
      { type: 'text', text: 'OUTLINE', attached: { kind: 'outline', label: 'tab 1' } },
    ]);
    await w.message({
      role: 'assistant',
      parts: [{ type: 'tool-call', toolCallId: 't1', toolName: 'click', input: {} }],
    });
    await w.intent('t1', 'click', { target: { ref: 'a1' } });
    await w.toolResult('t1', 'click', 'click · button «Book»', false, { ok: true, receipt: { action: 'click' } });
    await w.ui('write-card', { site: 'x' });
    await w.appNote('the user acted on tab 12; observe before acting');
    await w.modeChange('auto');
    await w.appHeader('<browser-state>…</browser-state>');
    const branch = await activeBranch(c.id);
    expect(branch.map(e => e.type)).toEqual([
      'message',
      'message',
      'intent',
      'message',
      'ui',
      'message',
      'mode_change',
      'message',
    ]);
    const result = branch[3];
    expect(result.type === 'message' && result.result).toEqual({ ok: true, receipt: { action: 'click' } });
    const noteEntry = branch[5];
    expect(noteEntry.type === 'message' && noteEntry.appOwned).toEqual({ kind: 'notice' });
    const headerEntry = branch[7];
    expect(headerEntry.type === 'message' && headerEntry.appOwned).toEqual({ kind: 'header' });
    // On the wire the note is a part of its own, opened by its label.
    const wire = toModelMessages(branch, { vision: false });
    const last = wire.at(-1)!.content as Array<{ text: string }>;
    expect(last[0].text).toBe(note('the user acted on tab 12; observe before acting'));
  });

  it('keeps the structured result lean: no screenshot bytes, no outline', () => {
    const lean = storedResult({
      ok: true,
      text: 'x',
      page: { tabId: 1, url: 'u', title: 't', rev: 3, changed: 'full', snapshot: 'BIG' },
      data: { base64: 'AAAA', width: 10, snapshot: 'BIG' },
    }) as Record<string, unknown>;
    expect(JSON.stringify(lean)).not.toContain('BIG');
    expect(JSON.stringify(lean)).not.toContain('AAAA');
    expect(lean.page).toEqual({ tabId: 1, url: 'u', title: 't', rev: 3, changed: 'full' });
  });

  it('finds the calls of the last reply that have no result, and whether they started', async () => {
    const c = await createConversation({ mode: 'ask' });
    const w = new RunWriter(c.id, 'r1');
    await w.message({
      role: 'assistant',
      parts: [
        { type: 'tool-call', toolCallId: 'a', toolName: 'snapshot', input: {} },
        { type: 'tool-call', toolCallId: 'b', toolName: 'click', input: {} },
        { type: 'tool-call', toolCallId: 'c', toolName: 'click', input: {} },
      ],
    });
    await w.intent('a', 'snapshot', {});
    await w.toolResult('a', 'snapshot', 'ok', false);
    await w.intent('b', 'click', {});
    expect(openCalls(await activeBranch(c.id))).toEqual([
      { toolCallId: 'b', toolName: 'click', hasIntent: true },
      { toolCallId: 'c', toolName: 'click', hasIntent: false },
    ]);
  });

  it('updates only its own run record', async () => {
    const c = await createConversation({ mode: 'ask' });
    const base = {
      conversationId: c.id,
      leafEntryId: null,
      status: 'running' as const,
      steering: [],
      turns: 0,
      usage: ZERO_USAGE,
      debt: [],
      guards: EMPTY_GUARDS,
      tabs: [],
      startedAt: '',
      updatedAt: '',
    };
    await putRun({ ...base, runId: 'r2' });
    expect(await new RunWriter(c.id, 'r1').run({ status: 'done' })).toMatchObject({ runId: 'r2', status: 'running' });
    await new RunWriter(c.id, 'r2').run({ status: 'done', outcome: 'success' });
    expect(await getRun(c.id)).toMatchObject({ status: 'done', outcome: 'success' });
  });
});
