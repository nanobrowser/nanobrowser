import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { ScriptedModel, resolveProfile } from '@src/llm';
import type { ScriptedReply } from '@src/llm';
import { activeBranch, appendEntry, createConversation } from '@src/store/conversations';
import { closeDb } from '@src/store/db';
import { AgentLoop } from '../loop';
import type { LoopOptions } from '../loop';
import { clearsDebt, createsDebt } from '../completion';
import { toolsForRun } from '../tools';
import { FakeHost, FakeLayer, failed, ok, receipt } from '../testing/fake-layer';

afterEach(async () => {
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
});

const page = (rev: number, changed: 'none' | 'diff' | 'full' = 'diff') => ({
  tabId: 1,
  url: 'https://x/',
  title: 'X',
  rev,
  changed,
});
const noEffect = ok('n', { receipt: receipt({ effect: { verdict: 'none', signals: [] } }), page: page(3, 'none') });
const effect = (rev: number) => ok('e', { receipt: receipt(), page: page(rev) });
const call = (name: string, input: unknown, id: string) => ({ name, input, id });
const doneCall = (outcome: string, id: string, summary = 'Summary.') => ({
  toolCalls: [call('done', { outcome, summary }, id)],
});

async function run(script: ScriptedReply[], layer: FakeLayer, extra: Partial<LoopOptions> = {}) {
  const c = await createConversation({ mode: 'ask' });
  await appendEntry(c.id, { type: 'message', message: { role: 'user', parts: [{ type: 'text', text: 'Task' }] } });
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
    tools: toolsForRun({ disabled: [], vision: false }),
    layer,
    host: new FakeHost(),
    signal: new AbortController().signal,
    emit: () => undefined,
    turnCap: 100,
    ...extra,
  });
  const end = await loop.run();
  const texts: Record<string, string> = {};
  for (const e of await activeBranch(c.id)) {
    if (e.type === 'message' && e.message.role === 'tool')
      for (const p of e.message.parts) if (p.type === 'tool-result') texts[p.toolCallId] = p.text;
  }
  const notes = (await activeBranch(c.id)).filter(e => e.type === 'message' && e.appOwned?.kind === 'notice').length;
  return { end, texts, notes, scripted, loop };
}

describe('what creates and clears debt', () => {
  it.each([
    ['a dispatched click that changed the page', 'click', effect(4), false],
    ['no effect', 'click', noEffect, true],
    [
      'no effect, postcondition met',
      'click',
      ok('m', { receipt: receipt({ effect: { verdict: 'none', signals: [] }, postcondition: { status: 'met' } }) }),
      false,
    ],
    [
      'unattributable',
      'click',
      ok('u', { receipt: receipt({ effect: { verdict: 'unattributable', signals: [] } }) }),
      true,
    ],
    ['postcondition unmet', 'set', ok('s', { receipt: receipt({ postcondition: { status: 'unmet' } }) }), true],
    ['dispatch unknown', 'press', ok('p', { receipt: receipt({ dispatched: 'unknown' }) }), true],
    ['an error after delivery', 'click', failed('INTERCEPTED', 'x', { delivered: true }), true],
    ['an error before dispatch', 'click', failed('NOT_VISIBLE'), false],
    [
      'a page error',
      'click',
      ok('pe', { receipt: receipt(), pageError: { code: 'CAPTURE_FAILED', message: '', delivered: false, hint: '' } }),
      true,
    ],
    ['a pending dialog', 'click', ok('d', { receipt: receipt(), pending: [{ kind: 'dialog', detail: 'x' }] }), true],
    ['tabs open', 'tabs', ok('t'), false],
  ])('%s', (_name, tool, result, debt) => {
    expect(createsDebt(tool, result)).toBe(debt);
  });

  it('is cleared by a read of the tab, a newer page state or a page condition, never by time alone', () => {
    const item = { toolCallId: 'a', tabId: 1, state: 'open' as const, label: 'click', rev: 3 };
    expect(clearsDebt('snapshot', ok('s', { page: page(4, 'full') }), item)).toBe(true);
    expect(clearsDebt('scroll', effect(4), item)).toBe(true);
    expect(clearsDebt('scroll', effect(3), item)).toBe(false);
    expect(clearsDebt('wait', ok('w', { data: { met: 'text' } }), item)).toBe(true);
    expect(clearsDebt('wait', ok('w', { data: { met: 'time' } }), item)).toBe(false);
    expect(clearsDebt('snapshot', failed('MODAL_PENDING'), item)).toBe(false);
    expect(clearsDebt('snapshot', ok('s', { page: { ...page(4, 'full'), tabId: 2 } }), item)).toBe(false);
  });
});

describe('done and verification debt', () => {
  it('refuses done(success) while debt is left, and accepts it after a read', async () => {
    const layer = new FakeLayer({ click: () => noEffect, snapshot: () => ok('s', { page: page(4, 'full') }) });
    const { end, texts } = await run(
      [
        { toolCalls: [call('click', { target: { ref: 'a1' } }, 'c')] },
        doneCall('success', 'd1'),
        { toolCalls: [call('snapshot', {}, 's')] },
        doneCall('success', 'd2'),
      ],
      layer,
    );
    expect(texts.d1).toMatch(/^refused: you have not seen the result of this action: click/);
    expect(end).toMatchObject({ status: 'done', outcome: 'success' });
  });

  it('ends as partial after two refusals in a row', async () => {
    const layer = new FakeLayer({ click: () => noEffect });
    const { end } = await run(
      [
        { toolCalls: [call('click', { target: { ref: 'a1' } }, 'c')] },
        doneCall('success', 'd1'),
        doneCall('success', 'd2', 'I think it worked.'),
      ],
      layer,
    );
    expect(end).toMatchObject({ status: 'done', outcome: 'partial', summary: 'I think it worked.' });
  });

  it('refuses to close a tab with debt', async () => {
    const layer = new FakeLayer({ click: () => noEffect });
    const { texts } = await run(
      [
        { toolCalls: [call('click', { target: { ref: 'a1' } }, 'c')] },
        { toolCalls: [call('tabs', { action: 'close', tabId: 1 }, 't')] },
        doneCall('partial', 'd'),
      ],
      layer,
    );
    expect(texts.t).toBe('refused: verify the last action on this tab before closing it.');
    expect(layer.calls.some(c => c.tool === 'tabs' && c.args.action === 'close')).toBe(false);
  });

  it('makes debt on a tab that disappeared unverifiable, and lists it in the answer', async () => {
    const layer = new FakeLayer({ click: () => noEffect });
    const script = [{ toolCalls: [call('click', { target: { ref: 'a1' } }, 'c')] }, doneCall('success', 'd', 'Sent.')];
    const c = run(script, layer);
    // The tab closes itself after the click.
    setTimeout(() => (layer.tabsData = { tabs: [], activeTabId: null }), 0);
    const { end } = await c;
    expect(end.outcome).toBe('success');
    expect(end.summary).toMatch(/not verified, the tab closed/);
  });

  it('leaves the debt after a wait that only let time pass', async () => {
    const layer = new FakeLayer({ click: () => noEffect, wait: () => ok('w', { data: { met: 'time' } }) });
    const { texts } = await run(
      [
        { toolCalls: [call('click', { target: { ref: 'a1' } }, 'c')] },
        { toolCalls: [call('wait', { ms: 0 }, 'w')] },
        doneCall('success', 'd'),
        doneCall('partial', 'd2'),
      ],
      layer,
    );
    expect(texts.d).toMatch(/^refused/);
  });
});

describe('ending with plain text', () => {
  it('a run that only read ends with its answer', async () => {
    const { end, notes } = await run(
      [{ toolCalls: [call('read', {}, 'r')] }, { text: 'The answer.' }],
      new FakeLayer(),
    );
    expect(end).toMatchObject({ status: 'done', outcome: 'success' });
    expect(notes).toBe(0);
  });

  it('after a mutation: one note, then partial', async () => {
    const layer = new FakeLayer({ click: () => effect(4) });
    const { end, notes } = await run(
      [
        { toolCalls: [call('click', { target: { ref: 'a1' } }, 'c')] },
        { text: 'Done, I think.' },
        { text: 'Really done.' },
      ],
      layer,
    );
    expect(notes).toBe(1);
    expect(end).toMatchObject({ status: 'done', outcome: 'partial' });
  });
});

describe('guards', () => {
  it('nudges after the same call and outcome three times in six', async () => {
    const layer = new FakeLayer({ find: () => ok('nothing') });
    const same = (id: string) => ({ toolCalls: [call('find', { name: 'Checkout' }, id)] });
    const { texts } = await run([same('a'), same('b'), same('c'), { text: 'Not found.' }], layer);
    expect(texts.b).not.toMatch(/Nanobrowser note/);
    expect(texts.c).toMatch(/\[Nanobrowser note: you made the same call with the same outcome 3 times/);
  });

  it('nudges at two no-effect actions on a target, stops at three, and salvages with done', async () => {
    const layer = new FakeLayer({ click: () => noEffect });
    const click = (id: string) => ({ toolCalls: [call('click', { target: { ref: 'a1' } }, id)] });
    const { end, texts, scripted } = await run(
      [click('a'), click('b'), click('c'), doneCall('partial', 's', 'The button did nothing.')],
      layer,
    );
    expect(texts.b).toMatch(/had no effect 2 times/);
    expect(scripted.calls.at(-1)!.tools.map(t => t.name)).toEqual(['done']);
    expect(end).toMatchObject({ status: 'done', outcome: 'partial', summary: 'The button did nothing.' });
  });

  it('stops after five errors in a row; a salvage call with no done fails the run', async () => {
    const layer = new FakeLayer({ click: () => failed('NOT_VISIBLE') });
    const err = (id: string) => ({ toolCalls: [call('click', { target: { ref: id } }, id)] });
    const { end } = await run([err('a'), err('b'), err('c'), err('d'), err('e'), { text: 'Giving up.' }], layer);
    expect(end).toMatchObject({ status: 'failed', outcome: 'failed', reason: '5 calls in a row failed.' });
  });

  it('caps the run at its turn limit, with the salvage summary', async () => {
    const layer = new FakeLayer();
    const read = (id: string) => ({ toolCalls: [call('read', { ref: id }, id)] });
    const { end } = await run([read('a'), read('b'), doneCall('partial', 's', 'Half way.')], layer, { turnCap: 2 });
    expect(end).toMatchObject({ status: 'capped', outcome: 'partial', summary: 'Half way.' });
  });
});

describe('the hand-over', () => {
  const userStep = failed('USER_STEP', 'button «Pay» is a payment', {
    details: { reason: 'pay', target: 'button «Pay»', site: 'shop.example' },
  } as never);

  it('stores the partial result, opens the card, and answers the call with a fresh observation on Done', async () => {
    const layer = new FakeLayer({
      click: () => userStep,
      snapshot: () => ok('snapshot · after the user paid', { page: page(9, 'full') }),
    });
    const host = new FakeHost();
    const { end, texts } = await run(
      [
        { toolCalls: [call('click', { target: { ref: 'a1' } }, 'c'), call('click', { target: { ref: 'a2' } }, 'x')] },
        doneCall('success', 'd'),
      ],
      layer,
      { host },
    );
    expect(host.handovers[0]).toMatchObject({ toolCallId: 'c', details: { reason: 'pay' } });
    expect(texts.c).toMatch(
      /hand-over: the user did the step \(pay\) and gave the tab back\.\nsnapshot · after the user paid/,
    );
    // The hand-over stops the batch; the call is never sent again.
    expect(texts.x).toMatch(/^skipped/);
    expect(layer.calls.filter(c => c.tool === 'click')).toHaveLength(1);
    expect(end.outcome).toBe('success');
  });

  it('tells the model when the user cancels', async () => {
    const layer = new FakeLayer({ click: () => userStep });
    const host = new FakeHost();
    host.answer = 'cancelled';
    const { texts } = await run(
      [{ toolCalls: [call('click', { target: { ref: 'a1' } }, 'c')] }, doneCall('partial', 'd')],
      layer,
      { host },
    );
    expect(texts.c).toMatch(/hand-over: the user cancelled the step/);
  });
});
