import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { ScriptedModel, resolveProfile } from '@src/llm';
import type { ScriptedReply } from '@src/llm';
import type { DecisionEngine } from '@src/llm/jev';
import { activeBranch, appendEntry, createConversation } from '@src/store/conversations';
import { closeDb } from '@src/store/db';
import { AgentLoop } from '../loop';
import { toolsForRun } from '../tools';
import { FakeHost, FakeLayer, ok, receipt } from '../testing/fake-layer';

const metadata = { elapsedMs: 1, apiCalls: 1 };
function engine(): DecisionEngine {
  return {
    evaluateAction: vi.fn<DecisionEngine['evaluateAction']>(async () => ({
      outcome: 'proceed',
      reasonCode: 'approved',
      confidence: 1,
      probability: 1,
      metadata,
    })),
    verifyCompletion: vi.fn<DecisionEngine['verifyCompletion']>(async () => ({
      outcome: 'complete',
      reasonCode: 'task_complete',
      confidence: 1,
      probability: 1,
      metadata,
      isHandoff: false,
    })),
    routeTask: vi.fn<DecisionEngine['routeTask']>(async () => ({
      outcome: 'capable',
      reasonCode: 'complex_task',
      confidence: 1,
      probability: 1,
      metadata,
    })),
    selectAction: vi.fn<DecisionEngine['selectAction']>(async () => ({
      outcome: 'fallback',
      reasonCode: 'generative_fallback',
      confidence: 0,
      probability: 0,
      metadata,
    })),
  };
}
const call = (name: string, input: unknown, id: string) => ({ name, input, id });
const done = (outcome = 'partial') => ({ toolCalls: [call('done', { outcome, summary: 'Finished.' }, 'done')] });

async function setup(script: ScriptedReply[], decision = engine(), extra: Record<string, unknown> = {}) {
  const conversation = await createConversation({ mode: 'ask' });
  await appendEntry(conversation.id, {
    type: 'message',
    message: { role: 'user', parts: [{ type: 'text', text: 'Do the task' }] },
  });
  let rev = 0;
  const outline = '[e1] button "Continue"\n[e2] button "Cancel"';
  const layer = new FakeLayer({
    snapshot: () =>
      ok(`<<<page-content n>>>\n${outline}\n<<<end-page-content n>>>`, {
        page: {
          tabId: 1,
          url: 'https://example.com/',
          title: 'Example',
          rev: ++rev,
          changed: 'full',
          snapshot: outline,
        },
        data: { status: 'complete' },
      }),
    click: () => ok('clicked', { receipt: receipt() }),
    set: () => ok('set', { receipt: receipt({ action: 'set' }) }),
  });
  layer.tabsData = {
    tabs: [{ tabId: 1, url: 'https://example.com/', title: 'Example', active: true }],
    activeTabId: 1,
  };
  const model = new ScriptedModel(script);
  const signal = new AbortController().signal;
  const loop = new AgentLoop({
    conversationId: conversation.id,
    runId: 'run1',
    model: {
      ref: { providerId: 'p', model: 'm' },
      chat: model.chat(),
      profile: resolveProfile({ kind: 'openai-compatible', modelName: 'm' }),
      reasoning: 'none',
    },
    system: 'sys',
    tools: toolsForRun({ vision: false }),
    layer,
    host: new FakeHost(),
    signal,
    emit: () => undefined,
    turnCap: 20,
    jev: { engine: decision, task: 'Do the task', confirm: async () => true, ...extra },
  });
  return { loop, layer, model, decision, conversation, signal };
}
async function results(id: string) {
  const texts: Record<string, string> = {};
  for (const entry of await activeBranch(id)) {
    if (entry.type === 'message' && entry.message.role === 'tool')
      for (const part of entry.message.parts) if (part.type === 'tool-result') texts[part.toolCallId] = part.text;
  }
  return texts;
}
afterEach(async () => {
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
});

it('evaluates each mutation in a batch and does not dispatch a reconsidered action', async () => {
  const decision = engine();
  vi.mocked(decision.evaluateAction).mockResolvedValueOnce({
    outcome: 'proceed',
    reasonCode: 'approved',
    confidence: 1,
    probability: 1,
    metadata,
  });
  vi.mocked(decision.evaluateAction).mockResolvedValueOnce({
    outcome: 'reconsider',
    reasonCode: 'action_reconsideration',
    confidence: 1,
    probability: 0,
    metadata,
  });
  const { loop, layer, conversation } = await setup(
    [
      {
        toolCalls: [
          call('click', { target: { ref: 'e1' } }, 'a'),
          call('set', { target: { ref: 'e2' }, value: 'x' }, 'b'),
        ],
      },
      done(),
    ],
    decision,
  );
  await loop.run();
  expect(decision.evaluateAction).toHaveBeenCalledTimes(2);
  expect(layer.calls.filter(request => ['click', 'set'].includes(request.tool)).map(request => request.tool)).toEqual([
    'click',
  ]);
  expect((await results(conversation.id)).b).toContain('Jev');
});

it('verifies successful completion with at most one read-only refresh for insufficient evidence', async () => {
  const decision = engine();
  vi.mocked(decision.verifyCompletion).mockResolvedValueOnce({
    outcome: 'needs_verification',
    reasonCode: 'evidence_insufficient',
    confidence: 0,
    probability: 0,
    metadata,
    isHandoff: false,
  });
  const { loop, layer } = await setup([done('success')], decision);
  let reads = 0;
  const original = layer.call.bind(layer);
  vi.spyOn(layer, 'call').mockImplementation(async (tool, args) => {
    const result = await original(tool, args);
    if (tool === 'snapshot' && ++reads > 1 && result.page) result.page.snapshot += '\n[e9] status "Complete"';
    return result;
  });
  const end = await loop.run();
  expect(decision.verifyCompletion).toHaveBeenCalledTimes(2);
  expect(layer.calls.filter(request => request.tool === 'snapshot')).toHaveLength(2);
  expect(layer.calls.every(request => request.tool === 'snapshot')).toBe(true);
  expect(end).toMatchObject({ status: 'done', outcome: 'success' });
});

it('records a bounded selected ref action through normal dispatch then falls back on repetition', async () => {
  const decision = engine();
  vi.mocked(decision.selectAction).mockImplementation(async (_context, candidates) => ({
    outcome: 'selected',
    candidateId: candidates[0].id,
    reasonCode: 'candidate_selected',
    confidence: 1,
    probability: 1,
    metadata,
  }));
  const { loop, layer, model, conversation } = await setup([done()], decision, { experimental: true });
  await loop.run();
  expect(layer.calls.filter(request => request.tool === 'click')).toHaveLength(1);
  expect(decision.evaluateAction).toHaveBeenCalledTimes(1);
  expect(model.calls).toHaveLength(1);
  const branch = await activeBranch(conversation.id);
  expect(branch.some(entry => entry.type === 'intent' && entry.tool === 'click')).toBe(true);
  expect(
    branch.some(
      entry =>
        entry.type === 'message' &&
        entry.message.parts.some(part => part.type === 'tool-call' && part.toolName === 'click'),
    ),
  ).toBe(true);
});

it('binds explicit confirmation to this action and rejects changed state or a rejected approval', async () => {
  for (const approved of [false, true]) {
    const decision = engine();
    vi.mocked(decision.evaluateAction).mockResolvedValue({
      outcome: 'confirm',
      reasonCode: 'confirmation_required',
      confidence: 1,
      probability: 1,
      metadata,
    });
    let changed = false;
    const requests: unknown[] = [];
    const { loop, layer } = await setup(
      [{ toolCalls: [call('click', { target: { ref: 'e1' } }, 'action1')] }, done()],
      decision,
      {
        confirm: async (request: unknown) => {
          requests.push(request);
          changed = approved;
          return approved;
        },
      },
    );
    const original = layer.call.bind(layer);
    vi.spyOn(layer, 'call').mockImplementation(async (tool, args) => {
      const result = await original(tool, args);
      if (changed && tool === 'snapshot' && result.page) result.page.snapshot += '\n[e99] button "Changed"';
      return result;
    });
    await loop.run();
    expect(requests).toMatchObject([
      {
        taskId: 'run1',
        toolCallId: 'action1',
        action: { name: 'click' },
        tabId: 1,
        stateKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    ]);
    expect(layer.calls.filter(request => request.tool === 'click')).toHaveLength(0);
  }
});

it('redacts typed values and URL queries before decision callbacks', async () => {
  const decision = engine();
  const { loop, layer } = await setup(
    [{ toolCalls: [call('set', { target: { ref: 'e1' }, value: 'private-form-value' }, 'a')] }, done()],
    decision,
  );
  const original = layer.call.bind(layer);
  vi.spyOn(layer, 'call').mockImplementation(async (tool, args) => {
    const result = await original(tool, args);
    if (tool === 'snapshot' && result.page)
      result.page.snapshot += '\n[e3] link "https://example.com/?token=private-query"';
    return result;
  });
  await loop.run();
  expect(JSON.stringify(vi.mocked(decision.evaluateAction).mock.calls)).not.toContain('private-form-value');
  expect(JSON.stringify(vi.mocked(decision.evaluateAction).mock.calls)).not.toContain('private-query');
  expect(vi.mocked(decision.evaluateAction).mock.calls[0][1].parameters.value).toBe('[REDACTED]');
});

it('stops after three reconsiderations without dispatching or silently retrying an action', async () => {
  const decision = engine();
  vi.mocked(decision.evaluateAction).mockResolvedValue({
    outcome: 'reconsider',
    reasonCode: 'action_reconsideration',
    confidence: 1,
    probability: 0,
    metadata,
  });
  const { loop, layer } = await setup(
    Array.from({ length: 3 }, (_, index) => ({ toolCalls: [call('click', { target: { ref: 'e1' } }, `a${index}`)] })),
    decision,
  );
  expect(await loop.run()).toMatchObject({ status: 'stopped', outcome: 'partial' });
  expect(decision.evaluateAction).toHaveBeenCalledTimes(3);
  expect(layer.calls.filter(request => request.tool === 'click')).toHaveLength(0);
});

it('reuses incomplete and insufficient completion decisions while evidence and claim are unchanged', async () => {
  for (const outcome of ['incomplete', 'needs_verification'] as const) {
    const decision = engine();
    vi.mocked(decision.verifyCompletion).mockResolvedValue({
      outcome,
      reasonCode: 'evidence_insufficient',
      confidence: 0,
      probability: 0,
      metadata,
      isHandoff: false,
    });
    const script = Array.from({ length: 3 }, (_, index) => ({
      toolCalls: [call('done', { outcome: 'success', summary: 'Same claim.' }, `d${index}`)],
    }));
    const { loop } = await setup(script, decision);
    expect(await loop.run()).toMatchObject({ status: 'stopped', outcome: 'partial' });
    expect(decision.verifyCompletion).toHaveBeenCalledTimes(1);
  }
});

it('processes steering that arrives during plain-text completion verification before finishing', async () => {
  const decision = engine();
  const queue: string[] = [];
  let verifications = 0;
  vi.mocked(decision.verifyCompletion).mockImplementation(async () => {
    if (++verifications === 1) queue.push('Use the updated task.');
    return {
      outcome: 'complete',
      reasonCode: 'task_complete',
      confidence: 1,
      probability: 1,
      metadata,
      isHandoff: false,
    };
  });
  const { loop, model } = await setup([{ text: 'Initial answer.' }, { text: 'Updated answer.' }], decision);
  loop.hasSteering = () => queue.length > 0;
  loop.options.takeSteering = () => queue.splice(0);
  expect(await loop.run()).toMatchObject({ status: 'done', outcome: 'success', turns: 2 });
  expect(model.calls).toHaveLength(2);
  expect(vi.mocked(decision.verifyCompletion).mock.calls[1][0].task).toContain('Use the updated task.');
});
