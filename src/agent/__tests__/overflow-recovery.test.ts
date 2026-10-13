// Steps 3 and 4 of context management and a request refused for its size, with the context-set cases that need them.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { ScriptedModel, resolveProfile } from '@src/llm';
import type { ScriptedCall, ScriptedReply } from '@src/llm';
import { activeBranch, appendEntry, createConversation } from '@src/store/conversations';
import { closeDb } from '@src/store/db';
import type { EntryOf } from '@src/store/types';
import { hardLimit } from '../elision';
import { AgentLoop, CONTEXT_LIMIT } from '../loop';
import { agentSystemPrompt } from '../prompt';
import { toolsForRun } from '../tools';
import { FakeHost, FakeLayer, ok, receipt } from '../testing/fake-layer';
import { isSummaryCall, withSummaries } from '../testing/scripts';

afterEach(async () => {
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
});

type Prompt = Array<{ role: string; content: unknown }>;
const size = (prompt: Prompt) => JSON.stringify(prompt).length / 4;

/** A provider that refuses a request over `limit` tokens, as a server whose real window is smaller. */
function provider(limit: number, script: (call: ScriptedCall, turn: number) => ScriptedReply, summary?: string) {
  const refused: number[] = [];
  const inner = withSummaries(script, summary);
  const fn = (call: ScriptedCall): ScriptedReply => {
    if (size(call.prompt as Prompt) > limit) {
      refused.push(size(call.prompt as Prompt));
      return {
        error: Object.assign(new Error(`This model's maximum context length is ${limit} tokens.`), { statusCode: 400 }),
      };
    }
    return { ...inner(call), usage: { input: Math.round(size(call.prompt as Prompt)), output: 10 } };
  };
  return { fn, refused };
}

function loopFor(
  conversationId: string,
  script: (call: ScriptedCall) => ScriptedReply,
  layer: FakeLayer,
  window: number,
  disabled: string[] = [],
) {
  const scripted = new ScriptedModel(script);
  const profile = resolveProfile({ kind: 'ollama', modelName: 'm', overrides: { contextWindow: window } });
  const tools = toolsForRun({ disabled, vision: false });
  const loop = new AgentLoop({
    conversationId,
    runId: 'r',
    model: { ref: { providerId: 'p', model: 'm' }, chat: scripted.chat(), profile, reasoning: 'none' },
    system: agentSystemPrompt({ tools: tools.map(t => t.name) }),
    tools,
    layer,
    host: new FakeHost(),
    signal: new AbortController().signal,
    emit: () => undefined,
    turnCap: 100,
    mode: () => 'auto',
  });
  return { loop, scripted, profile };
}

function flatsLayer(extra: ConstructorParameters<typeof FakeLayer>[0] = {}) {
  let rev = 0;
  const layer: FakeLayer = new FakeLayer({
    ...extra,
    read: () =>
      ok(layer.wrap(`listing ${++rev}: `.repeat(400)), {
        page: { tabId: 1, rev, url: 'https://flats.example/', title: 'Flats' } as never,
      }),
    click: (_a, i) =>
      ok(
        `click · [a${i}] button «Save listing ${i}» · pointer · submit: allowed by Auto mode · dispatched\n${layer.wrap('diff: '.repeat(600))}`,
        {
          receipt: receipt({ target: `[a${i}] button «Save listing ${i}»`, sensitive: 'submit', allowedBy: 'auto' }),
          page: { tabId: 1, rev, url: 'https://flats.example/', title: 'Flats' } as never,
        },
      ),
  });
  return layer;
}

describe('the long-run scenario on a 16k window, with the full tool list', () => {
  it('no request is refused for its size; every user message and every write line is in the last request', async () => {
    const c = await createConversation({ mode: 'auto' });
    await appendEntry(c.id, {
      type: 'message',
      message: { role: 'user', parts: [{ type: 'text', text: 'Save every listing under 900.' }] },
    });
    const { fn, refused } = provider(16_384, (_call, i) => ({
      text: `Looking at listing ${i}. `.repeat(30),
      toolCalls:
        i < 40
          ? [
              i % 2
                ? { name: 'click', input: { target: { ref: `a${i}` } }, id: `c${i}` }
                : { name: 'read', input: {}, id: `r${i}` },
            ]
          : [{ name: 'done', input: { outcome: 'success', summary: 'Saved.' }, id: 'd' }],
    }));
    const { loop, scripted, profile } = loopFor(c.id, fn, flatsLayer(), 16_384);
    const end = await loop.run();
    expect(end).toMatchObject({ status: 'done' });
    expect(refused).toEqual([]);
    const turns = scripted.calls.filter(call => !isSummaryCall(call));
    for (const call of turns) expect(size(call.prompt as Prompt)).toBeLessThan(hardLimit(profile));
    const last = JSON.stringify(turns.at(-1)!.prompt);
    expect(last).toContain('Save every listing under 900.');
    for (let i = 0; i < 20; i++) expect(last).toContain(`Save listing ${i}»`);
  });
});

describe('a request the provider refuses for its size', () => {
  it('lowers the window, compacts and retries; the run goes on', async () => {
    const c = await createConversation({ mode: 'auto' });
    await appendEntry(c.id, {
      type: 'message',
      message: { role: 'user', parts: [{ type: 'text', text: 'Read the listings.' }] },
    });
    // The profile says 64k; the server takes 14k.
    const { fn, refused } = provider(14_000, (_call, i) => ({
      text: `Reading ${i}. `.repeat(40),
      toolCalls:
        i < 24
          ? [{ name: 'read', input: {}, id: `r${i}` }]
          : [{ name: 'done', input: { outcome: 'success', summary: 'Read.' }, id: 'd' }],
    }));
    // A short tool list: the fake server counts the prompt and not the tool definitions.
    const short = [
      'find',
      'screenshot',
      'wait',
      'set',
      'type',
      'press',
      'navigate',
      'handle_dialog',
      'fill_form',
      'hover',
      'scroll',
      'tabs',
      'upload',
    ];
    const { loop } = loopFor(c.id, fn, flatsLayer(), 65_536, short);
    const end = await loop.run();
    expect(end).toMatchObject({ status: 'done' });
    expect(refused.length).toBeGreaterThan(0);
    expect(refused.length).toBeLessThan(4);
    expect(loop.window).toBeLessThan(14_000);
  });

  it('stops with the context-limit result when nothing more can be removed, and never drops a user message', async () => {
    const c = await createConversation({ mode: 'auto' });
    const long = 'Please keep in mind every detail of this instruction. '.repeat(700);
    await appendEntry(c.id, { type: 'message', message: { role: 'user', parts: [{ type: 'text', text: long }] } });
    const { fn, refused } = provider(6_000, () => ({ text: 'ok' }));
    const { loop, scripted } = loopFor(c.id, fn, new FakeLayer(), 65_536);
    const end = await loop.run();
    expect(end.reason).toBe(CONTEXT_LIMIT);
    expect(end.providerError?.overflow).toBe(true);
    expect(refused.length).toBe(1);
    for (const call of scripted.calls) expect(JSON.stringify(call.prompt)).toContain(long.slice(0, 200));
  });
});

describe('the context set', () => {
  it('an old answer that limits the agent stays, word for word, after compaction and after overflow recovery', async () => {
    const c = await createConversation({ mode: 'auto' });
    await appendEntry(c.id, {
      type: 'message',
      message: { role: 'user', parts: [{ type: 'text', text: 'Pay my bills.' }] },
    });
    let asked = false;
    const { fn, refused: refusedAsk } = provider(6_000, (_call, i) => {
      if (i === 0)
        return {
          toolCalls: [{ name: 'ask_user', input: { kind: 'input', message: 'Which account should I use?' }, id: 'q' }],
        };
      if (i < 30) return { text: `Step ${i}. `.repeat(150), toolCalls: [{ name: 'read', input: {}, id: `r${i}` }] };
      return { toolCalls: [{ name: 'done', input: { outcome: 'success', summary: 'Done.' }, id: 'd' }] };
    });
    const layer = flatsLayer({
      ask_user: () => {
        asked = true;
        return ok('ask_user · the user continued\nanswer: only the personal one');
      },
    });
    // A short tool list, so the server's count and the loop's estimate are close.
    const short = [
      'find',
      'screenshot',
      'wait',
      'set',
      'type',
      'press',
      'navigate',
      'handle_dialog',
      'fill_form',
      'hover',
      'scroll',
      'tabs',
      'upload',
    ];
    const { loop, scripted } = loopFor(c.id, fn, layer, 16_384, short);
    const end = await loop.run();
    expect(asked).toBe(true);
    expect(end).toMatchObject({ status: 'done' });
    const branch = await activeBranch(c.id);
    expect(branch.some(e => e.type === 'compaction')).toBe(true);
    expect(refusedAsk.length).toBeGreaterThan(0);
    const last = (scripted.calls.filter(call => !isSummaryCall(call)).at(-1)!.prompt as Prompt).map(m =>
      JSON.stringify(m),
    );
    const question = last.findIndex(m => m.includes('Which account should I use?'));
    expect(question).toBeGreaterThan(0);
    // Still the agent's ask_user call, with its answer right after it.
    expect(last[question]).toContain('"toolName":"ask_user"');
    expect(last[question + 1]).toContain('only the personal one');
  });

  it('a cutoff inside a tool batch: no result without its call, no call without its results, groups in order', async () => {
    const c = await createConversation({ mode: 'auto' });
    await appendEntry(c.id, {
      type: 'message',
      message: { role: 'user', parts: [{ type: 'text', text: 'Read everything.' }] },
    });
    // Replies of four calls each: step 3's six messages fall inside a reply.
    const { fn } = provider(20_000, (_call, i) =>
      i < 10
        ? { toolCalls: [0, 1, 2, 3].map(k => ({ name: 'read', input: { ref: `a${k}` }, id: `r${i}-${k}` })) }
        : { toolCalls: [{ name: 'done', input: { outcome: 'success', summary: 'ok' }, id: 'd' }] },
    );
    // Each call reads its own tab, so elision keeps four large results: only step 3 makes them fit.
    let rev = 0;
    const tabs: FakeLayer = new FakeLayer({
      read: args => {
        const tabId = Number(String(args.ref ?? 'a0').slice(1)) + 1;
        return ok(tabs.wrap(`tab ${tabId} text `.repeat(1_200)), {
          page: { tabId, rev: ++rev, url: 'https://x.example/', title: 'X' } as never,
        });
      },
    });
    const { loop, scripted } = loopFor(c.id, fn, tabs, 16_384);
    await loop.run();
    const branch = await activeBranch(c.id);
    expect(branch.some(e => e.type === 'compaction' && (e as EntryOf<'compaction'>).cutUpTo)).toBe(true);
    for (const call of scripted.calls.filter(x => !isSummaryCall(x))) {
      const prompt = call.prompt as Array<{
        role: string;
        content: Array<{ type: string; toolCallId?: string }> | string;
      }>;
      let open = new Set<string>();
      let order = -1;
      for (const m of prompt) {
        if (!Array.isArray(m.content)) continue;
        if (m.role === 'assistant') {
          expect(open.size).toBe(0);
          open = new Set(m.content.filter(p => p.type === 'tool-call').map(p => p.toolCallId!));
          const turn = Number(/^r(\d+)-/.exec([...open][0] ?? '')?.[1] ?? order);
          expect(turn).toBeGreaterThanOrEqual(order);
          order = turn;
        } else if (m.role === 'tool') {
          for (const p of m.content) {
            expect(open.has(p.toolCallId!)).toBe(true);
            open.delete(p.toolCallId!);
          }
        }
      }
    }
  });
});
