import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { ScriptedModel, resolveProfile } from '@src/llm';
import { activeBranch, appendEntry, createConversation } from '@src/store/conversations';
import { closeDb } from '@src/store/db';
import type { AgentEvent } from '@src/ui/protocol';
import { runChat } from '../run';

afterEach(async () => {
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
});

async function setup(scripted: ScriptedModel, text = 'Hello') {
  const c = await createConversation({ mode: 'ask' });
  await appendEntry(c.id, { type: 'message', message: { role: 'user', parts: [{ type: 'text', text }] } });
  const events: AgentEvent[] = [];
  const model = {
    ref: { providerId: 'p', model: 'scripted' },
    chat: scripted.chat(),
    profile: resolveProfile({ kind: 'openai-compatible', modelName: 'scripted' }),
    reasoning: 'none' as const,
  };
  return { c, events, model };
}

describe('runChat (no tools)', () => {
  it('sends the branch and writes the reply as a message entry', async () => {
    const scripted = new ScriptedModel([{ text: 'Hi there' }]);
    const { c, events, model } = await setup(scripted);
    const end = await runChat({
      conversationId: c.id,
      runId: 'r',
      model,
      system: 'sys',
      signal: new AbortController().signal,
      emit: e => events.push(e),
    });
    expect(end).toMatchObject({ status: 'done', outcome: 'success', turns: 1 });
    expect(scripted.calls[0].prompt.map(m => m.role)).toEqual(['system', 'user']);
    const branch = await activeBranch(c.id);
    expect(branch.map(e => (e.type === 'message' ? e.message.role : e.type))).toEqual(['user', 'assistant']);
    expect(events.map(e => e.type)).toEqual([
      'agent_start',
      'turn_start',
      'message_start',
      'message_update',
      'message_end',
      'turn_end',
      'agent_end',
    ]);
  });

  it('keeps partial text on Stop', async () => {
    const scripted = new ScriptedModel([{ text: 'Partial', delayMs: 5000 }]);
    const { c, events, model } = await setup(scripted);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    const end = await runChat({
      conversationId: c.id,
      runId: 'r',
      model,
      system: '',
      signal: controller.signal,
      emit: e => events.push(e),
    });
    expect(end.status).toBe('stopped');
  });

  it('fails with the provider error', async () => {
    const scripted = new ScriptedModel([{ error: new Error('bad key') }]);
    const { c, events, model } = await setup(scripted);
    const end = await runChat({
      conversationId: c.id,
      runId: 'r',
      model,
      system: '',
      signal: new AbortController().signal,
      emit: e => events.push(e),
    });
    expect(end).toMatchObject({ status: 'failed', reason: 'bad key' });
    expect((await activeBranch(c.id)).length).toBe(1);
  });
});
