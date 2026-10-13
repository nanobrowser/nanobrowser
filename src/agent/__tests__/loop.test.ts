import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { ScriptedModel, resolveProfile } from '@src/llm';
import type { ScriptedReply } from '@src/llm';
import { activeBranch, appendEntry, createConversation } from '@src/store/conversations';
import { closeDb } from '@src/store/db';
import type { EntryOf } from '@src/store/types';
import { AgentLoop } from '../loop';
import type { LoopOptions } from '../loop';
import { toolsForRun } from '../tools';
import { FakeHost, FakeLayer, failed, ok, receipt } from '../testing/fake-layer';

afterEach(async () => {
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
});

async function setup(script: ScriptedReply[], layer = new FakeLayer(), extra: Partial<LoopOptions> = {}) {
  const c = await createConversation({ mode: 'ask' });
  await appendEntry(c.id, {
    type: 'message',
    message: { role: 'user', parts: [{ type: 'text', text: 'Do the task' }] },
  });
  const scripted = new ScriptedModel(script);
  const loop = new AgentLoop({
    conversationId: c.id,
    runId: 'r1',
    model: {
      ref: { providerId: 'p', model: 'm' },
      chat: scripted.chat(),
      profile: resolveProfile({ kind: 'openai-compatible', modelName: 'm' }),
      reasoning: 'none',
    },
    system: 'sys',
    tools: toolsForRun({ disabled: ['hover'], vision: false }),
    layer,
    host: new FakeHost(),
    signal: new AbortController().signal,
    emit: () => undefined,
    turnCap: 100,
    ...extra,
  });
  return { c, loop, layer, scripted };
}

async function results(conversationId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const e of await activeBranch(conversationId)) {
    if (e.type !== 'message' || e.message.role !== 'tool') continue;
    for (const p of e.message.parts) if (p.type === 'tool-result') out[p.toolCallId] = p.text;
  }
  return out;
}

const call = (name: string, input: unknown, id: string) => ({ name, input, id });
const done = (id = 'd') => ({ toolCalls: [call('done', { outcome: 'success', summary: 'All done.' }, id)] });

describe('the loop', () => {
  it('runs a reply’s calls, gives every call a result, and ends with done and its summary', async () => {
    const { c, loop, layer } = await setup([
      { toolCalls: [call('snapshot', {}, 'a'), call('click', { target: { ref: 'a1' } }, 'b')] },
      done(),
    ]);
    const end = await loop.run();
    expect(end).toMatchObject({ status: 'done', outcome: 'success', summary: 'All done.', turns: 2 });
    // Mutations get observe: 'diff'; the model never sets it.
    expect(layer.calls.map(x => [x.tool, x.args.observe])).toEqual([
      ['snapshot', undefined],
      ['click', 'diff'],
    ]);
    const branch = await activeBranch(c.id);
    // An intent for each call, before its result.
    const order = branch.map(e =>
      e.type === 'intent'
        ? `intent ${e.toolCallId}`
        : e.type === 'message'
          ? e.appOwned?.kind === 'header'
            ? 'header'
            : e.message.role
          : e.type,
    );
    expect(order).toEqual([
      'user',
      'header',
      'assistant',
      'intent a',
      'tool',
      'intent b',
      'tool',
      'header',
      'assistant',
      'intent d',
      'tool',
      'assistant',
    ]);
    const last = branch.at(-1) as EntryOf<'message'>;
    expect(last.message.parts[0]).toEqual({ type: 'text', text: 'All done.' });
  });

  it('stores when the run began with each reply, for the activity block', async () => {
    const startedAt = '2026-10-08T10:00:00.000Z';
    const { c, loop } = await setup([{ toolCalls: [call('snapshot', {}, 'a')] }, done()], new FakeLayer(), {
      startedAt,
    });
    await loop.run();
    const replies = (await activeBranch(c.id)).filter(
      (e): e is EntryOf<'message'> => e.type === 'message' && e.message.role === 'assistant',
    );
    // The two model replies; done's summary after them is the run's last entry and carries no meta.
    expect(replies.map(e => e.meta?.runStartedAt)).toEqual([startedAt, startedAt, undefined]);
  });

  it('runs consecutive reads in parallel and mutations in order', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const slowRead = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 20));
      inFlight--;
      return ok('read');
    };
    const layer = new FakeLayer({ find: slowRead, read: slowRead, snapshot: slowRead });
    const { loop } = await setup(
      [
        {
          toolCalls: [
            call('snapshot', {}, 'a'),
            call('find', { name: 'x' }, 'b'),
            call('read', {}, 'c'),
            call('click', { target: { ref: 'a1' } }, 'd'),
            call('click', { target: { ref: 'a2' } }, 'e'),
          ],
        },
        done(),
      ],
      layer,
    );
    await loop.run();
    expect(maxInFlight).toBe(3);
    expect(layer.calls.filter(x => x.tool === 'click').map(x => (x.args.target as { ref: string }).ref)).toEqual([
      'a1',
      'a2',
    ]);
  });

  it.each([
    ['a navigation', ok('nav', { receipt: receipt({ navigation: { url: 'https://x/', kind: 'new-document' } }) })],
    ['a new tab', ok('tab', { receipt: receipt({ newTab: { tabId: 2, url: '' } }) })],
    ['an error', failed('NOT_VISIBLE')],
    ['a pending dialog', ok('d', { receipt: receipt(), pending: [{ kind: 'dialog', detail: 'alert «x»' }] })],
    ['a write card', ok('w', { receipt: receipt({ sensitive: 'submit', confirmedByUser: true, allowedBy: 'user' }) })],
    ['no effect', ok('n', { receipt: receipt({ effect: { verdict: 'none', signals: [] } }) })],
  ])('stops the batch after %s', async (_name, first) => {
    const layer = new FakeLayer({ click: (_a, n) => (n === 0 ? first : ok('second')) });
    const { c, loop } = await setup(
      [
        { toolCalls: [call('click', { target: { ref: 'a1' } }, 'a'), call('click', { target: { ref: 'a2' } }, 'b')] },
        done(),
      ],
      layer,
    );
    await loop.run();
    expect(layer.calls.filter(x => x.tool === 'click')).toHaveLength(1);
    expect((await results(c.id)).b).toMatch(/^skipped: the page changed/);
  });

  it('goes on after no effect when the postcondition was met', async () => {
    const met = ok('m', {
      receipt: receipt({ effect: { verdict: 'none', signals: [] }, postcondition: { status: 'met' } }),
    });
    const layer = new FakeLayer({ click: () => met });
    const { loop } = await setup(
      [
        { toolCalls: [call('click', { target: { ref: 'a1' } }, 'a'), call('click', { target: { ref: 'a2' } }, 'b')] },
        done(),
      ],
      layer,
    );
    await loop.run();
    expect(layer.calls.filter(x => x.tool === 'click')).toHaveLength(2);
  });

  it('skips a later call whose target the diff removed', async () => {
    const removed = ok('r', {
      receipt: receipt(),
      page: {
        tabId: 1,
        url: 'u',
        title: 't',
        rev: 4,
        changed: 'diff',
        diff: { since: 3, ops: [2, { remove: '[a2] button "Delete"' }] },
      },
    });
    const layer = new FakeLayer({ click: () => removed });
    const { c, loop } = await setup(
      [
        { toolCalls: [call('click', { target: { ref: 'a1' } }, 'a'), call('click', { target: { ref: 'a2' } }, 'b')] },
        done(),
      ],
      layer,
    );
    await loop.run();
    expect(layer.calls).toHaveLength(1);
    expect((await results(c.id)).b).toMatch(/^skipped/);
  });

  it('skips calls after a control call', async () => {
    const { c, loop, layer } = await setup([
      {
        toolCalls: [
          call('done', { outcome: 'success', summary: 's' }, 'a'),
          call('click', { target: { ref: 'a1' } }, 'b'),
        ],
      },
    ]);
    const end = await loop.run();
    expect(end.status).toBe('done');
    expect(layer.calls).toHaveLength(0);
    expect((await results(c.id)).b).toMatch(/^skipped: `done` and `ask_user` end a reply/);
  });

  it('fails every call of a reply cut by the output limit', async () => {
    const { c, loop, layer } = await setup([
      { toolCalls: [call('click', { target: { ref: 'a1' } }, 'a')], finish: 'length' },
      done(),
    ]);
    await loop.run();
    expect(layer.calls).toHaveLength(0);
    expect((await results(c.id)).a).toMatch(/cut off by the output limit/);
  });

  it('refuses a switched-off tool and an unknown one at dispatch', async () => {
    const { c, loop, layer } = await setup([
      { toolCalls: [call('hover', { target: { ref: 'a1' } }, 'a')] },
      { toolCalls: [call('eval', { code: '1' }, 'b')] },
      done(),
    ]);
    await loop.run();
    expect(layer.calls).toHaveLength(0);
    const r = await results(c.id);
    expect(r.a).toMatch(/not available in this run/);
    expect(r.b).toMatch(/eval is not available/);
  });

  it('caps a result at 8,000 characters and keeps the end marker', async () => {
    const big = `read · ok\nThe text …\n<<<page-content 0123456789ab site=x>>>\n${'x'.repeat(20_000)}\n<<<end-page-content 0123456789ab>>>`;
    const { c, loop } = await setup(
      [{ toolCalls: [call('read', {}, 'a')] }, done()],
      new FakeLayer({ read: () => ok(big) }),
    );
    await loop.run();
    const text = (await results(c.id)).a;
    expect(text.length).toBeLessThan(8_200);
    expect(text).toContain('<<<end-page-content 0123456789ab>>>');
    expect(text.trim().endsWith('characters.')).toBe(true);
  });

  it('ends with a plain answer when the model calls no tool', async () => {
    const { loop } = await setup([{ text: 'Here is the answer.' }]);
    expect(await loop.run()).toMatchObject({ status: 'done', outcome: 'success', turns: 1 });
  });

  it('stops: the stream is aborted and remaining calls get results', async () => {
    const controller = new AbortController();
    const layer = new FakeLayer({
      click: () => {
        controller.abort();
        return ok('c', { receipt: receipt() });
      },
    });
    const { c, loop } = await setup(
      [{ toolCalls: [call('click', { target: { ref: 'a1' } }, 'a'), call('click', { target: { ref: 'a2' } }, 'b')] }],
      layer,
      { signal: controller.signal },
    );
    expect((await loop.run()).status).toBe('stopped');
    expect((await results(c.id)).b).toMatch(/^aborted/);
  });

  it('skips the rest of the batch when the user sent a message, and delivers it next turn', async () => {
    const queue: string[] = [];
    const layer = new FakeLayer({
      click: () => {
        queue.push('Use the second address instead');
        return ok('c', { receipt: receipt() });
      },
    });
    const { c, loop, scripted } = await setup(
      [
        { toolCalls: [call('click', { target: { ref: 'a1' } }, 'a'), call('click', { target: { ref: 'a2' } }, 'b')] },
        done(),
      ],
      layer,
      {
        takeSteering: () => queue.splice(0),
      },
    );
    loop.hasSteering = () => queue.length > 0;
    await loop.run();
    expect((await results(c.id)).b).toBe('skipped: the user sent a message.');
    const second = scripted.calls[1].prompt.at(-1) as { role: string; content: Array<{ text?: string }> };
    expect(second.role).toBe('user');
    expect(JSON.stringify(second.content)).toContain('Use the second address instead');
  });
});

describe('a page prompt dialog left open by a call', () => {
  it('dismisses the dialog when the user cancels the hand-over', async () => {
    const layer: FakeLayer = new FakeLayer({
      click: () => {
        layer.pending.set(1, [{ kind: 'dialog', detail: 'prompt «What is your name?»' }]);
        return ok(
          'click · [a1] button «Ask my name» · pointer · dispatched\npending dialog: prompt «What is your name?»',
          {
            receipt: receipt(),
          },
        );
      },
      handle_dialog: args =>
        args.accept
          ? failed('USER_STEP', "Answering it is the user's step: nothing was sent.", {
              details: {
                reason: 'prompt',
                target: 'prompt «What is your name?»',
                site: 'localhost:8787',
                hasBrowserHandler: false,
              },
            })
          : ok('handle_dialog · dismissed prompt «What is your name?»'),
    });
    const host = new FakeHost();
    host.answer = 'cancelled';
    const { c, loop } = await setup(
      [
        { toolCalls: [{ name: 'click', input: { target: { ref: 'a1' } }, id: 'k' }] },
        { toolCalls: [{ name: 'done', input: { outcome: 'partial', summary: 'You cancelled.' }, id: 'd' }] },
      ],
      layer,
      { host },
    );
    await loop.run();
    expect(layer.calls.filter(x => x.tool === 'handle_dialog').map(x => x.args.accept)).toEqual([true, false]);
    expect((await results(c.id)).k).toContain("the user cancelled the step and the page's dialog was dismissed");
  });

  it('is handed to the user at once, though the agent never tries to answer it', async () => {
    const layer: FakeLayer = new FakeLayer({
      click: () => {
        // The click opens the page's prompt dialog.
        layer.pending.set(1, [{ kind: 'dialog', detail: 'prompt «What is your name?»' }]);
        return ok(
          'click · [a1] button «Ask my name» · pointer · dispatched\npending dialog: prompt «What is your name?»',
          {
            receipt: receipt(),
          },
        );
      },
      handle_dialog: () =>
        failed('USER_STEP', "Answering it is the user's step: nothing was sent.", {
          details: {
            reason: 'prompt',
            target: 'prompt «What is your name?»',
            site: 'localhost:8787',
            hasBrowserHandler: true,
          },
        }),
      snapshot: () => {
        layer.pending.set(1, []);
        return ok('outline after the user answered');
      },
    });
    const host = new FakeHost();
    const { c, loop } = await setup(
      [
        { toolCalls: [{ name: 'click', input: { target: { ref: 'a1' } }, id: 'k' }] },
        { toolCalls: [{ name: 'done', input: { outcome: 'success', summary: 'Answered by you.' }, id: 'd' }] },
      ],
      layer,
      { host },
    );
    const end = await loop.run();
    expect(host.handovers).toHaveLength(1);
    expect(host.handovers[0]).toMatchObject({
      toolCallId: 'k',
      tabId: 1,
      details: { reason: 'prompt', site: 'localhost:8787' },
    });
    // The click is answered with its receipt, the hand-over and what the page shows now.
    const r = await results(c.id);
    expect(r.k).toContain('click · [a1] button «Ask my name»');
    expect(r.k).toContain(
      "they answered the page's prompt dialog themselves and gave the tab back. The dialog is closed",
    );
    // The dialog line from before the user answered is gone.
    expect(r.k).not.toContain('pending dialog:');
    expect(r.k).toContain('outline after the user answered');
    // The extension's own probe was refused by the layer; no answer reached the page.
    expect(layer.calls.filter(x => x.tool === 'handle_dialog')).toEqual([
      expect.objectContaining({ args: { tabId: 1, accept: true } }),
    ]);
    expect(end.status).toBe('done');
  });

  it('still hands it over when the user answered the dialog before the call returned', async () => {
    // The click returns after the user already answered the dialog: the result still names it, the tab has none.
    const layer = new FakeLayer({
      click: () =>
        ok('click · [a1] button «Ask my name» · pointer · dispatched\npending dialog: prompt «What is your name?»', {
          receipt: receipt(),
        }),
    });
    const host = new FakeHost();
    const { c, loop } = await setup(
      [
        { toolCalls: [{ name: 'click', input: { target: { ref: 'a1' } }, id: 'k' }] },
        { toolCalls: [{ name: 'done', input: { outcome: 'success', summary: 'You answered it.' }, id: 'd' }] },
      ],
      layer,
      { host },
    );
    await loop.run();
    // The run waits for Done in this order too; the card's facts come from the result.
    expect(host.handovers).toHaveLength(1);
    expect(host.handovers[0].details).toMatchObject({ reason: 'prompt', target: 'prompt «What is your name?»' });
    const r = await results(c.id);
    expect(r.k).not.toContain('pending dialog:');
    expect(r.k).toContain(
      "they answered the page's prompt dialog themselves and gave the tab back. The dialog is closed",
    );
  });

  it('leaves an alert or a confirm with the agent', async () => {
    const layer: FakeLayer = new FakeLayer({
      click: () => {
        layer.pending.set(1, [{ kind: 'dialog', detail: 'confirm «Keep going?»' }]);
        return ok('click · dispatched', { receipt: receipt() });
      },
    });
    const host = new FakeHost();
    const { loop } = await setup(
      [
        { toolCalls: [{ name: 'click', input: { target: { ref: 'a1' } }, id: 'k' }] },
        { toolCalls: [{ name: 'done', input: { outcome: 'success', summary: 'ok' }, id: 'd' }] },
      ],
      layer,
      { host },
    );
    await loop.run();
    expect(host.handovers).toHaveLength(0);
    expect(layer.calls.some(x => x.tool === 'handle_dialog')).toBe(false);
  });
});
