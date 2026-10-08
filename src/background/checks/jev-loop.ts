// The production agent loop and browser layer, with scripted model replies and local decision results only.
import type { FindMatch, Result } from '@src/browser-control';
import { AgentLoop } from '@src/agent/loop';
import type { LoopEnd } from '@src/agent/loop';
import type { JevConfirmationRequest } from '@src/agent/jev';
import type { LayerPort } from '@src/agent/ports';
import { toolsForRun } from '@src/agent/tools';
import { FakeHost } from '@src/agent/testing/fake-layer';
import { createAgentSession, layerPort } from '@src/extension/agent-session';
import { runManager } from '@src/extension';
import { ScriptedModel, resolveProfile } from '@src/llm';
import type { ScriptedReply } from '@src/llm';
import { createDecisionEngine, DEFAULT_DECISION_CONFIG } from '@src/llm/jev';
import type {
  ActionDecision,
  CompletionDecision,
  DecisionAction,
  DecisionCandidate,
  DecisionContext,
  DecisionEngine,
  SelectionDecision,
} from '@src/llm/jev';
import { activeBranch, appendEntry, createConversation, deleteConversation } from '@src/store/conversations';
import { DEFAULT_JEV_SETTINGS } from '@src/store/jev';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { layer } from '../layer';
import { setResponder } from '../prompts';
import { assert, evaluate, sleep, waitForLoad } from './helpers';
import { panel, seedFixtureModel } from './panel-chat';
import { defineCheck } from './registry';

const metadata = { elapsedMs: 0, apiCalls: 0 };
const proceed = (): ActionDecision => ({
  outcome: 'proceed',
  reasonCode: 'approved',
  confidence: 1,
  probability: 1,
  metadata,
});
const complete = (): CompletionDecision => ({
  outcome: 'complete',
  reasonCode: 'task_complete',
  confidence: 1,
  probability: 1,
  metadata,
  isHandoff: false,
});
const done = (outcome: 'success' | 'partial' = 'partial', id = 'done'): ScriptedReply => ({
  toolCalls: [{ name: 'done', input: { outcome, summary: 'Fixture check finished.' }, id }],
});

function fakeEngine(
  overrides: {
    action?: (action: DecisionAction, index: number) => ActionDecision;
    completion?: (context: DecisionContext, index: number) => CompletionDecision | Promise<CompletionDecision>;
    selection?: (candidates: DecisionCandidate[], index: number) => SelectionDecision;
  } = {},
) {
  const calls = { actions: [] as DecisionAction[], completion: 0, selection: 0, routing: 0 };
  const engine: DecisionEngine = {
    async evaluateAction(_context, action) {
      calls.actions.push(action);
      return overrides.action?.(action, calls.actions.length - 1) ?? proceed();
    },
    async verifyCompletion(context) {
      const index = calls.completion++;
      return overrides.completion?.(context, index) ?? complete();
    },
    async selectAction(_context, candidates) {
      const index = calls.selection++;
      return (
        overrides.selection?.(candidates, index) ?? {
          outcome: 'fallback',
          reasonCode: 'generative_fallback',
          confidence: 1,
          probability: 1,
          metadata,
        }
      );
    },
    async routeTask() {
      calls.routing++;
      return { outcome: 'capable', reasonCode: 'complex_task', confidence: 1, probability: 1, metadata };
    },
  };
  return { engine, calls };
}

interface BrowserRun {
  page: 'c-text.html' | 'c-sensitive.html';
  engine: DecisionEngine;
  script(refs: Record<string, string>, tabId: number): ScriptedReply[];
  experimental?: boolean;
  confirm?: (request: JevConfirmationRequest) => Promise<boolean>;
}

async function runBrowser(spec: BrowserRun) {
  const { controller } = await layer();
  const session = createAgentSession(controller, {
    urlPolicy: { allow: [], deny: [], blocked: [] },
    decideWrite: () => ({ decision: 'ask', canRemember: false }),
  });
  const tab = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/${spec.page}`, active: false });
  const conversation = await createConversation({ mode: 'ask' });
  const cards: string[] = [];
  const previous = setResponder((prompt, answer) => {
    if (prompt.kind === 'confirm') {
      cards.push(prompt.request.target);
      answer('decline');
    } else answer({ outcome: 'cancel' });
  });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 45_000);
  try {
    await waitForLoad(tab.id!);
    session.shareTab(tab.id!);
    const observed = await session.call('snapshot', { tabId: tab.id!, mode: 'all', window: 'near' });
    assert(observed.ok, 'the fixture can be observed through the real layer');
    const names =
      spec.page === 'c-text.html'
        ? [
            ['textbox', 'Controlled name'],
            ['textbox', 'Controlled notes'],
          ]
        : [
            ['button', 'Show details'],
            ['button', 'Continue'],
          ];
    const refs: Record<string, string> = {};
    for (const [role, name] of names) {
      const result = await session.call('find', { tabId: tab.id!, role, name });
      const matches = result.data as FindMatch[] | undefined;
      assert(result.ok && matches?.length === 1, `the fixture presents one ${name} ref`);
      refs[name] = matches[0].ref;
    }
    await appendEntry(conversation.id, {
      type: 'message',
      message: { role: 'user', parts: [{ type: 'text', text: 'Carry out this local browser fixture task.' }] },
    });
    const requests: Array<{ tool: string; result: Result }> = [];
    const actual = layerPort(session);
    const port: LayerPort = {
      ...actual,
      async call(tool, args, signal) {
        const result = await actual.call(tool, args, signal);
        requests.push({ tool, result });
        return result;
      },
    };
    const model = new ScriptedModel(spec.script(refs, tab.id!));
    const tools = toolsForRun({ vision: false });
    const loop = new AgentLoop({
      conversationId: conversation.id,
      runId: `jev-browser-${conversation.id}`,
      model: {
        ref: { providerId: 'scripted', model: 'scripted' },
        chat: model.chat(),
        reasoning: 'none',
        profile: resolveProfile({
          kind: 'openai-compatible',
          modelName: 'scripted',
          overrides: { contextWindow: 131_072 },
        }),
      },
      system: 'Run the scripted local browser fixture task.',
      tools,
      layer: port,
      host: new FakeHost(),
      signal: abort.signal,
      emit: () => undefined,
      turnCap: 8,
      mode: () => 'ask',
      jev: {
        engine: spec.engine,
        task: 'Carry out this local browser fixture task.',
        experimental: spec.experimental,
        confirm: request => spec.confirm?.(request) ?? Promise.resolve(true),
      },
    });
    const end: LoopEnd = await loop.run();
    const state = await evaluate<{
      controlled?: string;
      notes?: string;
      clicks?: Record<string, number>;
      submits?: string[];
    }>(
      tab.id!,
      undefined,
      spec.page === 'c-text.html'
        ? '({ ...window.formState })'
        : '({ clicks: window.clicks, submits: window.submits })',
    );
    const branch = await activeBranch(conversation.id);
    const resultText = branch.flatMap(entry =>
      entry.type === 'message' && entry.message.role === 'tool'
        ? entry.message.parts.flatMap(part => (part.type === 'tool-result' ? [part.text] : []))
        : [],
    );
    return { end, state, requests, cards, modelCalls: model.calls.length, branch, resultText };
  } finally {
    clearTimeout(timer);
    await controller.closeSession(session);
    setResponder(previous);
    await chrome.tabs.remove(tab.id!).catch(() => undefined);
    await deleteConversation(conversation.id);
  }
}

async function productSmoke() {
  const storageNames = ['nb.settings', 'nb.jev', 'nb.keys', 'nb.providers'];
  const previous = await chrome.storage.local.get(storageNames);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 20_000);
  let page: chrome.tabs.Tab | undefined;
  let view: chrome.tabs.Tab | undefined;
  let conversationId: string | undefined;
  try {
    await seedFixtureModel();
    const settings = (await chrome.storage.local.get('nb.settings'))['nb.settings'] as Record<string, unknown>;
    await chrome.storage.local.set({
      'nb.settings': { ...settings, uiLanguage: 'en', onboarded: true },
      'nb.jev': { ...DEFAULT_JEV_SETTINGS, enabled: true },
      'nb.keys': {},
    });
    page = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/c-text.html`, active: false });
    await waitForLoad(page.id!);
    view = await chrome.tabs.create({ url: chrome.runtime.getURL(`/sidepanel.html#tab=${page.id}`), active: true });
    await waitForLoad(view.id!);
    await sleep(600);
    const waitBody = async (text: string) => {
      for (let attempt = 0; attempt < 60 && !abort.signal.aborted; attempt++) {
        const body = (await panel(page!.id!, 'read')).body;
        if (body.includes(text)) return body;
        await sleep(150);
      }
      throw new Error(`The product panel did not show ${text}.`);
    };
    await panel(page.id!, 'type-send', { text: 'Read this local fixture.' });
    await waitBody('Jev is enabled but has no saved API key.');
    const llmRequests = (await (await fetch(`${FIXTURE_ORIGIN}/__llm/requests`)).json()) as unknown[];
    assert(llmRequests.length === 0, 'enabled Jev without a key refuses the product run before any model request');

    conversationId =
      [...runManager.connections].find(connection => connection.tabId === page!.id)?.conversationId ?? undefined;
    assert(conversationId, 'the product panel is attached to its real conversation');
    for (let attempt = 0; attempt < 60 && runManager.isRunning(conversationId); attempt++) await sleep(100);
    assert(!runManager.isRunning(conversationId), 'the missing-key run finishes before the card smoke');
    const answer = runManager.broker.open<string>(
      conversationId,
      'jev-confirm',
      {
        taskId: 'fixture-card',
        toolCallId: 'fixture-action',
        action: { name: 'click', parameters: { target: { ref: 'fixture-ref' } } },
      },
      abort.signal,
      { tabId: page.id! },
    );
    const card = await waitBody('Jev asks for approval');
    assert(
      card.includes('Approval applies only to this action.') && card.includes('Browser permission checks still apply.'),
      'the real Jev approval card explains its scope',
    );
    const image = await chrome.tabs.captureVisibleTab(view.windowId, { format: 'png' });
    assert((await panel(page.id!, 'click', { label: 'Reject this action' })).ok, 'the real Jev card offers Reject');
    assert((await answer) === 'reject', 'the real panel sends the explicit rejection through the broker');
    const pending = runManager.broker.open<string>(
      conversationId,
      'jev-confirm',
      {
        taskId: 'fixture-close-card',
        toolCallId: 'fixture-close-action',
        action: { name: 'click', parameters: { target: { ref: 'fixture-close-target' } } },
      },
      abort.signal,
      { tabId: page.id! },
    );
    await waitBody('fixture-close-target');
    const closing = runManager.broker
      .promptsOf(conversationId)
      .find(prompt => prompt.data.toolCallId === 'fixture-close-action');
    assert(closing, 'the second real Jev approval is pending for its target tab');
    await chrome.tabs.remove(page.id!);
    const withdrawn = await Promise.race([pending, sleep(3_000).then(() => 'not-withdrawn')]);
    assert(
      withdrawn === 'withdrawn' && !abort.signal.aborted,
      'closing the target tab withdraws the pending Jev approval',
    );
    assert(!(await runManager.broker.answer(closing.id, 'approve')), 'a late approval after tab close is ignored');
    return {
      missingKeyNoModelRequest: true,
      explicitCardReject: true,
      targetCloseWithdraws: true,
      lateApprovalIgnored: true,
      image,
    };
  } finally {
    clearTimeout(timer);
    abort.abort();
    if (view?.id) await chrome.tabs.remove(view.id).catch(() => undefined);
    if (page?.id) await chrome.tabs.remove(page.id).catch(() => undefined);
    if (conversationId) await deleteConversation(conversationId);
    await chrome.storage.local.remove(storageNames);
    await chrome.storage.local.set(previous);
  }
}
defineCheck({
  name: 'jev-loop',
  title: 'Jev policy through the real browser layer',
  description:
    'Uses local fixture pages, the production AgentLoop and LayerPort, a ScriptedModel and fake decision results. Proves disabled decisions make no API calls, every batch mutation is gated, denied approval dispatches nothing, completion refresh/retries are bounded, and a selected submit still reaches the browser permission gate.',
  async run() {
    let apiCalls = 0;
    const disabled = createDecisionEngine(DEFAULT_DECISION_CONFIG, {
      fetch: async () => {
        apiCalls++;
        throw new Error('The disabled engine must not call an API.');
      },
    });
    const disabledRun = await runBrowser({
      page: 'c-text.html',
      engine: disabled,
      script: (refs, tabId) => [
        {
          toolCalls: [
            {
              name: 'set',
              input: { tabId, target: { ref: refs['Controlled name'] }, value: 'disabled-path' },
              id: 'set-disabled',
            },
          ],
        },
        done(),
      ],
    });
    assert(
      apiCalls === 0 && disabledRun.state.controlled === 'disabled-path',
      'disabled Jev makes no API call and preserves real dispatch',
    );

    const batch = fakeEngine({
      action: (_action, index) =>
        index === 0
          ? proceed()
          : {
              outcome: 'reconsider',
              reasonCode: 'action_reconsideration',
              confidence: 1,
              probability: 0,
              metadata,
            },
    });
    const batchRun = await runBrowser({
      page: 'c-text.html',
      engine: batch.engine,
      script: (refs, tabId) => [
        {
          toolCalls: [
            {
              name: 'set',
              input: { tabId, target: { ref: refs['Controlled name'] }, value: 'first-gated-action' },
              id: 'first',
            },
            {
              name: 'set',
              input: { tabId, target: { ref: refs['Controlled notes'] }, value: 'must-not-land' },
              id: 'second',
            },
          ],
        },
        done(),
      ],
    });
    assert(batch.calls.actions.length === 2, 'each mutation in one reply gets its own Jev evaluation');
    assert(
      batchRun.state.controlled === 'first-gated-action' && batchRun.state.notes === '',
      'only the approved batch action reaches the page',
    );
    assert(
      batchRun.requests.filter(request => request.tool === 'set').length === 1,
      'the reconsidered action never reaches LayerPort',
    );

    const confirmations: JevConfirmationRequest[] = [];
    const denied = fakeEngine({
      action: () => ({
        outcome: 'confirm',
        reasonCode: 'confirmation_required',
        confidence: 1,
        probability: 1,
        metadata,
      }),
    });
    const deniedRun = await runBrowser({
      page: 'c-sensitive.html',
      engine: denied.engine,
      script: (refs, tabId) => [
        { toolCalls: [{ name: 'click', input: { tabId, target: { ref: refs['Show details'] } }, id: 'denied-click' }] },
        done(),
      ],
      confirm: async request => {
        confirmations.push(request);
        return false;
      },
    });
    assert(
      confirmations.length === 1 &&
        confirmations[0].toolCallId === 'denied-click' &&
        /^[a-f0-9]{64}$/.test(confirmations[0].stateKey),
      'Jev approval is bound to an observed action',
    );
    assert(
      deniedRun.requests.every(request => request.tool !== 'click') && !deniedRun.state.clicks?.details,
      'rejected Jev approval never clicks',
    );
    assert(
      deniedRun.end.outcome === 'partial' && deniedRun.modelCalls === 1,
      'rejected approval stops without asking the model to retry',
    );

    let refreshTab = 0;
    const refresh = fakeEngine({
      completion: async (_context, index) => {
        if (index !== 0) return complete();
        // A page update outside the agent makes a second evaluation necessary after the read-only refresh.
        await evaluate(
          refreshTab,
          undefined,
          "document.body.appendChild(document.createElement('p')).textContent = 'Fresh verification evidence'; true",
        );
        return {
          outcome: 'needs_verification',
          reasonCode: 'evidence_insufficient',
          confidence: 0,
          probability: 0,
          metadata,
          isHandoff: false,
        };
      },
    });
    const refreshRun = await runBrowser({
      page: 'c-text.html',
      engine: refresh.engine,
      script: (_refs, tabId) => {
        refreshTab = tabId;
        return [done('success')];
      },
    });
    assert(
      refresh.calls.completion === 2 && refreshRun.requests.filter(request => request.tool === 'snapshot').length === 2,
      'insufficient completion evidence gets exactly one read-only refresh',
    );
    assert(
      refreshRun.end.outcome === 'success' && refreshRun.requests.every(request => request.tool === 'snapshot'),
      'completion refresh dispatches no mutation',
    );

    const unchanged = fakeEngine({
      completion: () => ({
        outcome: 'needs_verification',
        reasonCode: 'evidence_insufficient',
        confidence: 0,
        probability: 0,
        metadata,
        isHandoff: false,
      }),
    });
    const unchangedRun = await runBrowser({
      page: 'c-text.html',
      engine: unchanged.engine,
      script: () => [done('success')],
    });
    assert(
      unchanged.calls.completion === 1 &&
        unchangedRun.requests.filter(request => request.tool === 'snapshot').length === 2 &&
        unchangedRun.end.outcome === 'partial',
      'an unchanged completion refresh reuses the decision and stops partial without another API evaluation',
    );
    const incomplete = fakeEngine({
      completion: () => ({
        outcome: 'incomplete',
        reasonCode: 'task_incomplete',
        confidence: 1,
        probability: 0,
        metadata,
        isHandoff: false,
      }),
    });
    const incompleteRun = await runBrowser({
      page: 'c-text.html',
      engine: incomplete.engine,
      script: () => [done('success', 'done-1'), done('success', 'done-2'), done('success', 'done-3')],
    });
    assert(
      incomplete.calls.completion === 1 && incompleteRun.modelCalls === 3 && incompleteRun.end.outcome === 'partial',
      'unchanged incomplete evidence is cached across three bounded attempts and never claims success',
    );

    const selected = fakeEngine({
      selection: candidates => {
        const candidate = candidates.find(item => item.label?.includes('Continue'));
        assert(candidate, 'the real snapshot offers the fixture submit as a bounded candidate');
        return {
          outcome: 'selected',
          candidateId: candidate.id,
          reasonCode: 'candidate_selected',
          confidence: 1,
          probability: 1,
          metadata,
        };
      },
    });
    const selectedRun = await runBrowser({
      page: 'c-sensitive.html',
      engine: selected.engine,
      experimental: true,
      script: () => [done()],
    });
    assert(
      selected.calls.actions.length === 1 && selectedRun.cards.length === 1,
      'a selected action is evaluated and then reaches the normal browser permission gate',
    );
    assert(
      selectedRun.requests.some(request => request.tool === 'click' && request.result.error?.code === 'USER_DECLINED'),
      'the layer refuses the selected submit after the simulated user declines',
    );
    assert(
      !selectedRun.state.clicks?.continue && selectedRun.state.submits?.length === 0,
      'a selected action cannot bypass browser write permissions',
    );
    assert(
      selectedRun.branch.some(entry => entry.type === 'intent' && entry.tool === 'click'),
      'selected actions use the normal intent record',
    );

    const product = await productSmoke();
    return {
      product,
      disabledNoApiCalls: true,
      batchActionsGated: true,
      deniedNoDispatch: true,
      completionRefreshBounded: true,
      unchangedCompletionCached: true,
      incompleteAttempts: incompleteRun.modelCalls,
      incompleteEvaluations: incomplete.calls.completion,
      selectedUsesBrowserPermissions: true,
    };
  },
});
