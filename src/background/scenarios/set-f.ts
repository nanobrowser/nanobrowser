// Fixture set F: the agent loop. The scripted model drives the real layer on fixture pages,
// through the same loop and the same kind of session the extension's runs use, with no network and no randomness.
import { AgentLoop } from '@src/agent/loop';
import type { LoopEnd, LoopOptions } from '@src/agent/loop';
import { agentSystemPrompt } from '@src/agent/prompt';
import { toolsForRun } from '@src/agent/tools';
import { FakeHost } from '@src/agent/testing/fake-layer';
import type { Session, SessionConfig } from '@src/browser-control';
import { createAgentSession, layerPort } from '@src/extension/agent-session';
import { ScriptedModel, resolveProfile } from '@src/llm';
import type { ScriptedCall, ScriptedReply } from '@src/llm';
import { activeBranch, appendEntry, createConversation, deleteConversation, putBlob } from '@src/store/conversations';
import type { Entry } from '@src/store/types';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { evaluate } from '../checks/helpers';
import { layer } from '../layer';
import { defineScenario, outcome } from './registry';
import type { ScenarioContext } from './registry';

export interface AgentRun {
  end: LoopEnd;
  branch: Entry[];
  scripted: ScriptedModel;
  session: Session;
  tabId: number;
  /** The text of each tool result, by call ID. */
  results: Record<string, string>;
  /** The page's text when the run ended, read before the session let go of the tab. */
  pageText: string;
}

/** The text of the newest tool result in a request, and every ref line in it. */
export function lastToolText(call: ScriptedCall): string {
  for (let i = call.prompt.length - 1; i >= 0; i--) {
    const m = call.prompt[i] as { role: string; content: Array<{ type: string; output?: { value?: unknown } }> };
    if (m.role !== 'tool') continue;
    return m.content.map(p => String(p.output?.value ?? '')).join('\n');
  }
  return '';
}

export function refIn(text: string, pattern: RegExp): string {
  const line = text.split('\n').find(l => pattern.test(l));
  const ref = line && /\[(\w+)\]/.exec(line)?.[1];
  if (!ref) throw new Error(`no ref for ${pattern} in:\n${text.slice(0, 1500)}`);
  return ref;
}

export async function runAgent(
  ctx: ScenarioContext,
  url: string,
  script: ScriptedReply[] | ((call: ScriptedCall, index: number) => ScriptedReply | Promise<ScriptedReply>),
  options: {
    task?: string;
    session?: SessionConfig;
    loop?: Partial<LoopOptions>;
    /** Tools left out of the run, to test the check at dispatch. */
    disabledTools?: string[];
    /** Called with the run's tab before the loop starts. */
    beforeRun?: (tabId: number) => void;
    /** Files attached to the task message, stored with the conversation. */
    attachments?: Array<{ id: string; name: string; mimeType: string; text: string }>;
  } = {},
): Promise<AgentRun> {
  const { controller } = await layer();
  const session = createAgentSession(controller, options.session);
  const tabId = await ctx.open(url, { attach: false });
  session.shareTab(tabId);
  options.beforeRun?.(tabId);
  const conversation = await createConversation({ mode: 'ask' });
  for (const f of options.attachments ?? []) {
    const data = new Blob([f.text], { type: f.mimeType });
    await putBlob({
      id: f.id,
      conversationId: conversation.id,
      name: f.name,
      mimeType: f.mimeType,
      size: data.size,
      data,
      createdAt: '',
    });
  }
  await appendEntry(conversation.id, {
    type: 'message',
    message: {
      role: 'user',
      parts: [
        { type: 'text', text: options.task ?? 'Do the task on this page.' },
        ...(options.attachments ?? []).map(f => ({
          type: 'attachment' as const,
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          size: new Blob([f.text]).size,
        })),
      ],
    },
  });
  const scripted = new ScriptedModel(script);
  const loop = new AgentLoop({
    conversationId: conversation.id,
    runId: 'scenario',
    model: {
      ref: { providerId: 'scripted', model: 'scripted' },
      chat: scripted.chat(),
      profile: resolveProfile({
        kind: 'openai-compatible',
        modelName: 'scripted',
        overrides: { contextWindow: 128_000 },
      }),
      reasoning: 'none',
    },
    system: agentSystemPrompt(),
    tools: toolsForRun({ disabled: options.disabledTools ?? [], vision: false }),
    layer: layerPort(session),
    host: new FakeHost(),
    signal: new AbortController().signal,
    emit: () => undefined,
    turnCap: 20,
    ...options.loop,
  });
  try {
    const end = await loop.run();
    const branch = await activeBranch(conversation.id);
    const results: Record<string, string> = {};
    for (const e of branch) {
      if (e.type === 'message' && e.message.role === 'tool') {
        for (const p of e.message.parts) if (p.type === 'tool-result') results[p.toolCallId] = p.text;
      }
    }
    const pageText = await evaluate<string>(tabId, undefined, 'document.body.innerText').catch(() => '');
    return { end, branch, scripted, session, tabId, results, pageText };
  } finally {
    await controller.closeSession(session);
    await deleteConversation(conversation.id);
  }
}

const EFFECTS = `${FIXTURE_ORIGIN}/c-effects.html`;
const NAVIGATION = `${FIXTURE_ORIGIN}/c-navigation.html`;

defineScenario({
  id: 'F-6.8-snapshot-click-done',
  set: 'F',
  title: 'The scripted model observes, clicks and finishes on a real page',
  covers: 'the loop drives the layer; observe "diff" on mutations; done ends the run',
  async run(ctx) {
    const run = await runAgent(ctx, EFFECTS, (call, i) => {
      if (i === 0) return { toolCalls: [{ name: 'snapshot', input: {}, id: 's' }] };
      if (i === 1)
        return {
          toolCalls: [
            { name: 'click', input: { target: { ref: refIn(lastToolText(call), /button "Add a row"/) } }, id: 'c' },
          ],
        };
      return { toolCalls: [{ name: 'done', input: { outcome: 'success', summary: 'Added.' }, id: 'd' }] };
    });
    const shown = run.pageText;
    return outcome(
      'done success after 3 turns; the click result carries effect and a diff; the page has the new row',
      `${run.end.status}/${run.end.outcome} in ${run.end.turns}; click: ${run.results.c?.split('\n').slice(0, 3).join(' | ')}`,
      run.end.status === 'done' &&
        run.end.outcome === 'success' &&
        run.end.turns === 3 &&
        /effect: changed/.test(run.results.c ?? '') &&
        /diff · tab/.test(run.results.c ?? '') &&
        /Row 1/.test(shown),
    );
  },
});

defineScenario({
  id: 'F-6.8-batch-stops-on-navigation',
  set: 'F',
  title: 'A batch stops after a navigation; the rest is skipped',
  covers: 'new document stops the batch',
  async run(ctx) {
    const run = await runAgent(ctx, NAVIGATION, (call, i) => {
      if (i === 0) return { toolCalls: [{ name: 'snapshot', input: {}, id: 's' }] };
      if (i === 1) {
        const text = lastToolText(call);
        return {
          toolCalls: [
            { name: 'click', input: { target: { ref: refIn(text, /link "Allowed link"/) } }, id: 'a' },
            { name: 'click', input: { target: { ref: refIn(text, /link "Script link"/) } }, id: 'b' },
          ],
        };
      }
      return { toolCalls: [{ name: 'done', input: { outcome: 'success', summary: 'ok' }, id: 'd' }] };
    });
    return outcome(
      'the first click navigates; the second is skipped',
      `a: ${run.results.a?.split('\n')[0]}; b: ${run.results.b}`,
      /navigation: new-document/.test(run.results.a ?? '') && /^skipped: the page changed/.test(run.results.b ?? ''),
    );
  },
});

/** Every text the model was sent in one request: the system prompt and each text part of each message. */
export function requestTexts(call: ScriptedCall): string[] {
  const out: string[] = [];
  for (const m of call.prompt as Array<{ role: string; content: unknown }>) {
    if (typeof m.content === 'string') {
      out.push(m.content);
      continue;
    }
    for (const p of m.content as Array<{ type: string; text?: string; output?: { value?: unknown } }>) {
      if (p.type === 'text' && p.text) out.push(p.text);
      if (p.type === 'tool-result') out.push(String(p.output?.value ?? ''));
    }
  }
  return out;
}

defineScenario({
  id: 'F-6.9-first-request',
  set: 'F',
  title: 'The first request: the outline attached, the header after it',
  covers: 'first-turn outline inside the boundary; <browser-state> with quoted fields, last',
  async run(ctx) {
    const run = await runAgent(ctx, EFFECTS, [{ text: 'It is a test page.' }], { task: 'What is this page?' });
    const texts = requestTexts(run.scripted.calls[0]);
    const outline = texts.find(t => /<<<page-content [0-9a-f]{12}/.test(t));
    const header = texts.at(-1) ?? '';
    return outcome(
      'an outline inside the boundary naming the site; the last text is the header, with the title and address quoted',
      `outline: ${outline?.split('\n').slice(0, 3).join(' | ')}; header: ${header.split('\n').slice(0, 3).join(' | ')}`,
      !!outline &&
        /<<<page-content [0-9a-f]+ site=localhost:8787>>>/.test(outline) &&
        /button "Add a row"/.test(outline) &&
        header.startsWith('<browser-state>') &&
        /active tab: \[\d+\] «[^»]*» «http:\/\/localhost:8787\/c-effects\.html» · rev \d+/.test(header),
    );
  },
});

defineScenario({
  id: 'F-6.9-canary-request',
  set: 'F',
  title: 'The canary page: every canary in a request is inside a boundary or a quote',
  covers: 'the canary sweep, agent side: the first-turn outline and the page header',
  async run(ctx) {
    const { canaryLeaks } = await import('../checks/canary-sweep');
    const run = await runAgent(ctx, `${FIXTURE_ORIGIN}/h-canary.html`, [
      { toolCalls: [{ name: 'tabs', input: { action: 'list' }, id: 't' }] },
      { text: 'ok' },
    ]);
    const leaks = run.scripted.calls.flatMap(requestTexts).flatMap(canaryLeaks);
    return outcome('no leak', leaks.length ? JSON.stringify(leaks.slice(0, 5)) : 'none', leaks.length === 0);
  },
});

// Verification debt.
const DEBT = `${FIXTURE_ORIGIN}/f-debt.html`;

defineScenario({
  id: 'F-6.10-confirm-then-read',
  set: 'F',
  title: 'A click opens confirm(); handle_dialog, a read, done(success)',
  covers: 'a pending modal creates debt; the read after the dialog clears it',
  async run(ctx) {
    const run = await runAgent(ctx, DEBT, (call, i) => {
      const text = lastToolText(call);
      if (i === 0) return { toolCalls: [{ name: 'snapshot', input: {}, id: 's' }] };
      if (i === 1)
        return {
          toolCalls: [{ name: 'click', input: { target: { ref: refIn(text, /button "Remove item"/) } }, id: 'c' }],
        };
      if (i === 2) return { toolCalls: [{ name: 'handle_dialog', input: { accept: true }, id: 'h' }] };
      if (i === 3) return { toolCalls: [{ name: 'snapshot', input: {}, id: 'r' }] };
      return { toolCalls: [{ name: 'done', input: { outcome: 'success', summary: 'Removed.' }, id: 'd' }] };
    });
    return outcome(
      'done success accepted; the item is gone',
      `${run.end.status}/${run.end.outcome}; click: ${run.results.c?.split('\n').find(l => l.startsWith('pending'))}; done: ${run.results.d}`,
      run.end.outcome === 'success' && run.results.d === 'done: the run ends.' && !run.pageText.includes('Item 1'),
    );
  },
});

defineScenario({
  id: 'F-6.10-close-after-verified',
  set: 'F',
  title: 'Closing a tab after a verified action',
  covers: 'tabs close is refused only with open debt',
  async run(ctx) {
    let second = 0;
    const run = await runAgent(ctx, EFFECTS, (call, i) => {
      const text = lastToolText(call);
      if (i === 0)
        return {
          toolCalls: [{ name: 'tabs', input: { action: 'open', url: `${FIXTURE_ORIGIN}/c-effects.html` }, id: 'o' }],
        };
      if (i === 1) {
        second = Number(/tabs open · tab (\d+)/.exec(text)?.[1]);
        return { toolCalls: [{ name: 'snapshot', input: { tabId: second }, id: 's' }] };
      }
      if (i === 2)
        return {
          toolCalls: [{ name: 'click', input: { target: { ref: refIn(text, /button "Add a row"/) } }, id: 'c' }],
        };
      if (i === 3) return { toolCalls: [{ name: 'tabs', input: { action: 'close', tabId: second }, id: 'x' }] };
      return { toolCalls: [{ name: 'done', input: { outcome: 'success', summary: 'ok' }, id: 'd' }] };
    });
    return outcome(
      'the close runs; done success',
      `close: ${run.results.x?.split('\n')[0]}; ${run.end.outcome}`,
      /^tabs close/.test(run.results.x ?? '') && run.end.outcome === 'success',
    );
  },
});

defineScenario({
  id: 'F-6.10-tab-closes-itself',
  set: 'F',
  title: 'The tab of an unverified action closes by itself',
  covers: 'unverifiable debt no longer blocks done(success); the answer lists it',
  async run(ctx) {
    let tabId = 0;
    const run = await runAgent(ctx, DEBT, async (call, i) => {
      const text = lastToolText(call);
      if (i === 0) return { toolCalls: [{ name: 'snapshot', input: {}, id: 's' }] };
      if (i === 1) {
        tabId = Number(/snapshot · tab (\d+)/.exec(text)?.[1]);
        return {
          toolCalls: [{ name: 'click', input: { target: { ref: refIn(text, /button "Do nothing"/) } }, id: 'c' }],
        };
      }
      // The page closes its own tab after the click.
      if (i === 2) await chrome.tabs.remove(tabId).catch(() => undefined);
      return { toolCalls: [{ name: 'done', input: { outcome: 'success', summary: 'Sent.' }, id: 'd' }] };
    });
    return outcome(
      'done success; the summary says the click was not verified',
      `${run.end.outcome}: ${run.end.summary}`,
      run.end.outcome === 'success' && /not verified, the tab closed/.test(run.end.summary ?? ''),
    );
  },
});
