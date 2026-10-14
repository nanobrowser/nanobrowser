// The context set: after a restart every request holds the system prompt and every user message word for word; the run
// stops, sending nothing, when they do not fit; and a note is never counted as a user message.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { ScriptedModel, resolveProfile } from '@src/llm';
import type { ScriptedCall, ScriptedReply } from '@src/llm';
import { activeBranch, appendEntry, createConversation, titleFrom } from '@src/store/conversations';
import { closeDb } from '@src/store/db';
import { EMPTY_GUARDS, ZERO_USAGE } from '@src/store/types';
import type { RunRecord } from '@src/store/types';
import { toDisplay } from '../display';
import { AgentLoop, CONTEXT_LIMIT } from '../loop';
import { agentSystemPrompt } from '../prompt';
import { NOTE_LABEL, RunWriter } from '../records';
import { planRestore } from '../restore';
import { toolsForRun } from '../tools';
import { FakeHost, FakeLayer, ok } from '../testing/fake-layer';
import { isSummaryCall, withSummaries } from '../testing/scripts';

afterEach(async () => {
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
});

const SYSTEM = agentSystemPrompt({ tools: ['snapshot', 'read', 'click', 'done'] });
const USER_1 = 'Find a laptop under 1000 EUR.\nOnly use my personal account, never the work one.';
const USER_2 = 'Also check the warranty — and do not buy anything.';
const done = { toolCalls: [{ name: 'done', input: { outcome: 'success', summary: 'ok' }, id: 'd' }] };

function loopFor(
  conversationId: string,
  script: ScriptedReply[] | ((call: ScriptedCall, index: number) => ScriptedReply),
  layer: FakeLayer,
  window = 128_000,
) {
  const scripted = new ScriptedModel(script);
  const loop = new AgentLoop({
    conversationId,
    runId: 'after',
    model: {
      ref: { providerId: 'p', model: 'm' },
      chat: scripted.chat(),
      profile: resolveProfile({ kind: 'openai-compatible', modelName: 'm', overrides: { contextWindow: window } }),
      reasoning: 'none',
    },
    system: SYSTEM,
    tools: toolsForRun({ disabled: [], vision: false }),
    layer,
    host: new FakeHost(),
    signal: new AbortController().signal,
    emit: () => undefined,
    turnCap: 20,
    mode: () => 'ask',
  });
  return { loop, scripted };
}

type PromptMessage = { role: string; content: unknown };

const userTexts = (call: ScriptedCall) =>
  (call.prompt as PromptMessage[])
    .filter(m => m.role === 'user')
    .map(m =>
      typeof m.content === 'string'
        ? [m.content]
        : (m.content as Array<{ type: string; text?: string }>).filter(p => p.type === 'text').map(p => p.text!),
    );

/** Every request holds the system prompt and each of the user's messages, word for word. */
function expectProtected(call: ScriptedCall, messages: string[]) {
  const system = (call.prompt as PromptMessage[]).find(m => m.role === 'system');
  expect(system?.content).toBe(SYSTEM);
  const parts = userTexts(call).flat();
  for (const text of messages) expect(parts).toContain(text);
}

describe('after a restart (context set)', () => {
  it('keeps the system prompt and every user message word for word; the note is its own part, not a user message', async () => {
    const c = await createConversation({ mode: 'ask' });
    await appendEntry(c.id, { type: 'message', message: { role: 'user', parts: [{ type: 'text', text: USER_1 }] } });
    await appendEntry(c.id, {
      type: 'message',
      message: {
        role: 'assistant',
        parts: [
          { type: 'tool-call', toolCallId: 'r', toolName: 'read', input: {} },
          { type: 'tool-call', toolCallId: 'k', toolName: 'click', input: { target: { ref: 'a1' } } },
        ],
      },
    });
    await appendEntry(c.id, { type: 'intent', toolCallId: 'r', tool: 'read', args: {} });
    // The worker stops here. At the next start the restore plan is applied as the RunManager applies it.
    const run: RunRecord = {
      conversationId: c.id,
      runId: 'before',
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
    };
    const plan = planRestore(run, await activeBranch(c.id));
    const writer = new RunWriter(c.id, 'before');
    for (const r of plan.results) await writer.toolResult(r.toolCallId, r.toolName, r.text, true);
    await writer.appNote(plan.note);
    await appendEntry(c.id, { type: 'message', message: { role: 'user', parts: [{ type: 'text', text: USER_2 }] } });

    const { loop, scripted } = loopFor(c.id, [done], new FakeLayer());
    await loop.run();
    const [call] = scripted.calls;
    expectProtected(call, [USER_1, USER_2]);
    // The note travels as the extension's words, alone in its part, opened by its label.
    const parts = userTexts(call).flat();
    expect(parts).toContain(`${NOTE_LABEL} ${plan.note}]`);
    for (const part of parts.filter(p => p.includes(NOTE_LABEL))) {
      expect(part.startsWith(NOTE_LABEL) && part.endsWith(']')).toBe(true);
      expect(part).not.toContain(USER_1);
      expect(part).not.toContain(USER_2);
    }
    // Nobody reads it as the user: it is not shown as a user message, and it cannot become the title.
    const shown = toDisplay(await activeBranch(c.id)).filter(e => e.kind === 'user');
    expect(shown.map(e => e.kind === 'user' && e.text)).toEqual([USER_1, USER_2]);
    expect(titleFrom(USER_1)).not.toContain(NOTE_LABEL);
    // Every call of the cut-off reply has its result before the note (no request has a call without its result).
    const roles = (call.prompt as PromptMessage[]).map(m => m.role);
    expect(roles.slice(1, 5)).toEqual(['user', 'assistant', 'tool', 'user']);
  });
});

describe('when the protected set does not fit (context set)', () => {
  it('stops before the first request and sends nothing', async () => {
    const c = await createConversation({ mode: 'ask' });
    const long = 'A long instruction from the user. '.repeat(3_000);
    await appendEntry(c.id, { type: 'message', message: { role: 'user', parts: [{ type: 'text', text: long }] } });
    const { loop, scripted } = loopFor(c.id, [done], new FakeLayer(), 16_000);
    const end = await loop.run();
    expect(end.reason).toBe(CONTEXT_LIMIT);
    expect(scripted.calls).toHaveLength(0);
  });

  it('carries on when tool results fill the window: every request it sent was whole and fitted', async () => {
    const c = await createConversation({ mode: 'ask' });
    await appendEntry(c.id, { type: 'message', message: { role: 'user', parts: [{ type: 'text', text: USER_1 }] } });
    const page = 'Page text that keeps growing. '.repeat(250);
    const layer: FakeLayer = new FakeLayer({ read: () => ok(layer.wrap(page)) });
    // The provider reports the input it was sent, as a real one does; the loop's estimate builds on it.
    const script = withSummaries((call, i) => ({
      ...(i < 12 ? { toolCalls: [{ name: 'read', input: {}, id: `r${i}` }] } : done),
      usage: { input: Math.round(JSON.stringify(call.prompt).length / 4), output: 10 },
    }));
    const { loop, scripted } = loopFor(c.id, script, layer, 24_000);
    const end = await loop.run();
    expect(end.status).toBe('done');
    const turns = scripted.calls.filter(call => !isSummaryCall(call));
    expect(turns).toHaveLength(13);
    for (const call of turns) {
      expectProtected(call, [USER_1]);
      expect(JSON.stringify(call.prompt).length / 4).toBeLessThan(24_000);
    }
  });
});
