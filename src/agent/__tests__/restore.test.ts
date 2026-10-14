import { describe, expect, it } from 'vitest';
import { INTERRUPTED_MUTATION, INTERRUPTED_READ, planRestore, SKIPPED_RESTART, takenOver } from '../restore';
import type { Entry, EntryBody, RunRecord } from '@src/store/types';
import { EMPTY_GUARDS, ZERO_USAGE } from '@src/store/types';

let n = 0;
const e = (body: EntryBody): Entry =>
  ({ ...body, id: `e${++n}`, parentId: null, conversationId: 'c', at: '' }) as Entry;
const reply = (...calls: Array<[string, string, unknown?]>) =>
  e({
    type: 'message',
    message: {
      role: 'assistant',
      parts: calls.map(([id, name, input]) => ({
        type: 'tool-call' as const,
        toolCallId: id,
        toolName: name,
        input: input ?? {},
      })),
    },
  });
const intent = (id: string, tool: string) => e({ type: 'intent', toolCallId: id, tool, args: {} });
const result = (id: string, tool: string) =>
  e({
    type: 'message',
    message: {
      role: 'tool',
      parts: [{ type: 'tool-result', toolCallId: id, toolName: tool, text: 'ok', isError: false }],
    },
  });

const run = (patch: Partial<RunRecord>): RunRecord => ({
  conversationId: 'c',
  runId: 'r',
  leafEntryId: null,
  status: 'running',
  steering: [],
  turns: 1,
  usage: ZERO_USAGE,
  debt: [],
  guards: EMPTY_GUARDS,
  tabs: [1],
  startedAt: '',
  updatedAt: '',
  ...patch,
});

describe('the restore plan', () => {
  it('a running run becomes interrupted; an intent with no result is INTERRUPTED; a call that never started is skipped', () => {
    const branch = [
      reply(['a', 'snapshot'], ['b', 'click', { target: { ref: 'a1' } }], ['c', 'click']),
      intent('a', 'snapshot'),
      intent('b', 'click'),
    ];
    const plan = planRestore(run({ status: 'running' }), branch);
    expect(plan.status).toBe('interrupted');
    expect(plan.results).toEqual([
      { toolCallId: 'a', toolName: 'snapshot', text: INTERRUPTED_READ, isError: true },
      { toolCallId: 'b', toolName: 'click', text: INTERRUPTED_MUTATION, isError: true },
      { toolCallId: 'c', toolName: 'click', text: SKIPPED_RESTART, isError: true },
    ]);
    expect(plan.reopen).toBeUndefined();
  });

  it('a hand-over that fill_form met after setting two fields reopens only its card; nothing is sent again', () => {
    const partial = { ok: false, error: { code: 'USER_STEP' }, data: { receipts: [{}, {}], submitted: false } };
    const branch = [reply(['f', 'fill_form'], ['g', 'click']), intent('f', 'fill_form')];
    const plan = planRestore(
      run({
        status: 'awaiting_user',
        pendingPrompt: {
          kind: 'handover',
          request: { details: { reason: 'pay' }, tabId: 1 },
          openedAt: '',
          answers: { toolCallId: 'f', partialResult: partial },
        },
      }),
      branch,
    );
    expect(plan.status).toBe('awaiting_user');
    expect(plan.reopen).toMatchObject({ kind: 'handover', toolCallId: 'f', answers: { partialResult: partial } });
    // The fill_form call gets no INTERRUPTED result: the hand-over answers it. The call after it never started.
    expect(plan.results).toEqual([{ toolCallId: 'g', toolName: 'click', text: SKIPPED_RESTART, isError: true }]);
  });

  it('an open write card is recovered like an interrupted mutation', () => {
    const plan = planRestore(
      run({ status: 'awaiting_user', pendingPrompt: { kind: 'write-card', request: {}, openedAt: '' } }),
      [reply(['s', 'click']), intent('s', 'click')],
    );
    expect(plan.status).toBe('interrupted');
    expect(plan.results[0].text).toBe(INTERRUPTED_MUTATION);
  });

  it('an ask_user question opens again', () => {
    const plan = planRestore(
      run({
        status: 'awaiting_user',
        pendingPrompt: { kind: 'ask-user', request: { kind: 'input', message: 'Which account?' }, openedAt: '' },
      }),
      [reply(['q', 'ask_user']), intent('q', 'ask_user')],
    );
    expect(plan.status).toBe('awaiting_user');
    expect(plan.reopen).toMatchObject({ kind: 'ask-user', toolCallId: 'q' });
    expect(plan.results).toEqual([]);
  });

  it('an interrupted run is restored as it was, and a finished reply needs nothing', () => {
    const branch = [reply(['a', 'read']), intent('a', 'read'), result('a', 'read')];
    expect(planRestore(run({ status: 'interrupted' }), branch).status).toBe('interrupted');
  });

  it('a run stored as paused by the Take over the panel once had is restored as stopped', () => {
    const branch = [reply(['a', 'read']), intent('a', 'read'), result('a', 'read')];
    const paused = run({ status: 'paused' as RunRecord['status'], reason: 'take-over' });
    expect(takenOver(paused)).toBe(true);
    const plan = planRestore(paused, branch);
    expect(plan).toMatchObject({ status: 'stopped', results: [] });
    expect(plan.reason).toBeUndefined();
    expect(takenOver(run({ status: 'interrupted' }))).toBe(false);
  });
});
