// Set G with the loop: the permission scenarios, driven by the scripted model on the real layer, with the policy
// function and the hand-over as the extension wires them.
import type { HostPort } from '@src/agent/ports';
import type { WriteQuestion } from '@src/browser-control';
import type { ScriptedCall, ScriptedReply } from '@src/llm';
import { decideWrite } from '@src/store/settings';
import type { PermissionMode } from '@src/store/types';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { evaluate, sleep } from '../checks/helpers';
import { setResponder } from '../prompts';
import type { OpenPrompt } from '../prompts';
import { defineScenario, outcome } from './registry';
import { lastToolText, refIn, runAgent } from './set-f';

/** The extension's policy over a map of site rules. */
function policy(mode: PermissionMode, rules: Map<string, 'allow' | 'ask'>) {
  return (q: WriteQuestion) => {
    const rule = rules.get(q.site);
    return {
      decision: decideWrite(mode, rule),
      by: rule ? ('site-rule' as const) : ('auto' as const),
      canRemember: rule !== 'ask',
    };
  };
}

/** A user who answers write cards with `answer` and remembers "always allow" in `rules`. */
function cardUser(answer: 'approve' | 'approve-remember' | 'decline' | 'never', rules?: Map<string, 'allow' | 'ask'>) {
  const cards: Array<{ site: string; category: string }> = [];
  setResponder((p: OpenPrompt, reply) => {
    if (p.kind !== 'confirm') return;
    cards.push({ site: p.request.site, category: p.request.category });
    if (answer === 'never') return;
    if (answer === 'approve-remember') rules?.set(p.request.site, 'allow');
    reply(answer);
  });
  return cards;
}

const HANDOVER = `${FIXTURE_ORIGIN}/g-handover.html`;
const RENAME = `${FIXTURE_ORIGIN}/g-rename.html`;

defineScenario({
  id: 'G-6.11-handover-in-loop',
  set: 'G',
  title: 'The loop hands a payment to the user, and carries on after Done',
  covers: 'the hand-over: opened by afterToolCall, partial stored, never sent again, fresh observation',
  async run(ctx) {
    let tab = 0;
    const handovers: string[] = [];
    const host: HostPort = {
      async handover(request) {
        handovers.push(request.details.reason);
        // The user pays in the tab, then gives back.
        await evaluate(tab, undefined, 'window.hits.push("pay by the user")');
        return 'given-back';
      },
    };
    const run = await runAgent(
      ctx,
      HANDOVER,
      (call, i) => {
        const text = lastToolText(call);
        if (i === 0) {
          tab = Number(/tab (\d+)/.exec(JSON.stringify(call.prompt))?.[1]);
          return { toolCalls: [{ name: 'snapshot', input: {}, id: 's' }] };
        }
        if (i === 1)
          return {
            toolCalls: [{ name: 'click', input: { target: { ref: refIn(text, /button "Pay now"/) } }, id: 'p' }],
          };
        return { toolCalls: [{ name: 'done', input: { outcome: 'success', summary: 'Paid by you.' }, id: 'd' }] };
      },
      { session: { decideWrite: policy('auto', new Map()) }, loop: { host } },
    );
    return outcome(
      'one hand-over (pay); the click result has the outcome and a fresh snapshot; done success',
      `${JSON.stringify(handovers)}; ${run.results.p
        ?.split('\n')
        .filter(l => l.startsWith('hand-over') || l.startsWith('snapshot'))
        .join(' | ')}; ${run.end.outcome}`,
      handovers.length === 1 &&
        handovers[0] === 'pay' &&
        /hand-over: the user did the step \(pay\)/.test(run.results.p ?? '') &&
        /snapshot · tab/.test(run.results.p ?? '') &&
        run.end.outcome === 'success',
    );
  },
});

defineScenario({
  id: 'G-6.17-prompt-dialog-handover',
  set: 'G',
  title: 'A page prompt dialog is handed to the user though the agent never tries to answer it',
  covers: 'the user answers every page prompt dialog, so the loop opens the hand-over',
  async run(ctx) {
    let tab = 0;
    const handovers: string[] = [];
    let hits: string[] = [];
    const host: HostPort = {
      async handover(request) {
        handovers.push(`${request.details.reason} ${request.details.target}`);
        // The user answers the dialog in the tab, then gives back.
        await chrome.debugger.sendCommand({ tabId: tab }, 'Page.handleJavaScriptDialog', {
          accept: true,
          promptText: 'Ada',
        });
        // What the page received, read while the session still holds the tab.
        hits = await evaluate<string[]>(tab, undefined, 'window.hits').catch((): string[] => []);
        return 'given-back';
      },
    };
    const run = await runAgent(
      ctx,
      HANDOVER,
      (call, i) => {
        const text = lastToolText(call);
        if (i === 0) {
          tab = Number(/tab (\d+)/.exec(JSON.stringify(call.prompt))?.[1]);
          return { toolCalls: [{ name: 'snapshot', input: {}, id: 's' }] };
        }
        // The model clicks and never calls handle_dialog, as a real model did.
        if (i === 1)
          return {
            toolCalls: [{ name: 'click', input: { target: { ref: refIn(text, /button "Ask my name"/) } }, id: 'k' }],
          };
        return {
          toolCalls: [{ name: 'done', input: { outcome: 'success', summary: 'You answered the dialog.' }, id: 'd' }],
        };
      },
      { session: { decideWrite: policy('auto', new Map()) }, loop: { host } },
    );
    return outcome(
      "one hand-over (prompt) right after the click; the page got the user's answer; the run carries on to done",
      `${JSON.stringify(handovers)}; hits ${JSON.stringify(hits)}; ${run.results.k
        ?.split('\n')
        .filter(l => l.startsWith('hand-over'))
        .join(' | ')}; ${run.end.outcome}`,
      handovers.length === 1 &&
        handovers[0].startsWith('prompt ') &&
        hits.includes('prompt:Ada') &&
        /hand-over: the user did the step \(prompt\): they answered/.test(run.results.k ?? '') &&
        !/pending dialog:/.test(run.results.k ?? '') &&
        run.end.outcome === 'success',
    );
  },
});

defineScenario({
  id: 'G-6.11-read-only-no-card',
  set: 'G',
  title: 'In Ask mode, a task that only reads and navigates shows no card',
  covers: 'reading and moving never ask',
  async run(ctx) {
    const cards = cardUser('decline');
    const run = await runAgent(
      ctx,
      HANDOVER,
      (call, i) => {
        if (i === 0)
          return {
            toolCalls: [
              { name: 'snapshot', input: {}, id: 's' },
              { name: 'read', input: {}, id: 'r' },
            ],
          };
        if (i === 1)
          return { toolCalls: [{ name: 'navigate', input: { url: `${FIXTURE_ORIGIN}/c-effects.html` }, id: 'n' }] };
        if (i === 2) return { toolCalls: [{ name: 'find', input: { role: 'button' }, id: 'f' }] };
        return { toolCalls: [{ name: 'done', input: { outcome: 'success', summary: 'Read it.' }, id: 'd' }] };
      },
      { session: { decideWrite: policy('ask', new Map()) } },
    );
    return outcome(
      'no card; done success',
      `cards ${cards.length}; ${run.end.outcome}`,
      cards.length === 0 && run.end.outcome === 'success',
    );
  },
});

defineScenario({
  id: 'G-6.11-one-card-then-allow',
  set: 'G',
  title: 'A form task shows exactly one card, and none after "Allow on this site"',
  covers: 'Allow on this site covers every later write on the site',
  async run(ctx) {
    const rules = new Map<string, 'allow' | 'ask'>();
    const script = (call: ScriptedCall, i: number): ScriptedReply => {
      const text = lastToolText(call);
      if (i === 0) return { toolCalls: [{ name: 'snapshot', input: {}, id: 's' }] };
      if (i === 1) {
        return {
          toolCalls: [
            {
              name: 'fill_form',
              input: {
                fields: [
                  { target: { ref: refIn(text, /textbox "Name"/) }, value: 'Ada' },
                  { target: { ref: refIn(text, /textbox "Email"/) }, value: 'ada@example.com' },
                ],
                submit: { ref: refIn(text, /button "Send request"/) },
              },
              id: 'f',
            },
          ],
        };
      }
      return { toolCalls: [{ name: 'done', input: { outcome: 'success', summary: 'Sent.' }, id: 'd' }] };
    };
    const first = cardUser('approve-remember', rules);
    const a = await runAgent(ctx, RENAME, script, { session: { decideWrite: policy('ask', rules) } });
    const second = cardUser('decline', rules);
    const b = await runAgent(ctx, RENAME, script, { session: { decideWrite: policy('ask', rules) } });
    return outcome(
      'first run: one card (submit), remembered; second run: no card; both sent',
      `first ${JSON.stringify(first)} ${a.results.f?.split('\n')[0]}; second ${second.length} ${b.results.f?.split('\n')[0]}; rules ${JSON.stringify([...rules])}`,
      first.length === 1 &&
        first[0].category === 'submit' &&
        rules.get('localhost:8787') === 'allow' &&
        second.length === 0 &&
        /submitted/.test(a.results.f ?? '') &&
        /submitted/.test(b.results.f ?? ''),
    );
  },
});

defineScenario({
  id: 'G-6.11-renamed-to-pay',
  set: 'G',
  title: 'A button the page renames to "Pay" between the decision and the click',
  covers: 'TARGET_CHANGED, in Auto mode too',
  async run(ctx) {
    cardUser('decline');
    const run = await runAgent(
      ctx,
      RENAME,
      (call, i) => {
        const text = lastToolText(call);
        if (i === 0) return { toolCalls: [{ name: 'snapshot', input: {}, id: 's' }] };
        if (i === 1)
          return {
            toolCalls: [{ name: 'click', input: { target: { ref: refIn(text, /button "Save basket"/) } }, id: 'c' }],
          };
        return { toolCalls: [{ name: 'done', input: { outcome: 'failed', summary: 'The button changed.' }, id: 'd' }] };
      },
      { session: { decideWrite: policy('auto', new Map()) } },
    );
    return outcome(
      'TARGET_CHANGED (or the hand-over of a payment); the page was not paid',
      `${run.results.c?.split('\n').slice(0, 2).join(' | ')}; paid ${/paid/.test(run.pageText)}`,
      /error (TARGET_CHANGED|USER_STEP)/.test(run.results.c ?? ''),
    );
  },
});

defineScenario({
  id: 'G-6.11-unanswered-card',
  set: 'G',
  title: 'A card left unanswered holds only its own run',
  covers: 'a second conversation carries on',
  async run(ctx) {
    const cards = cardUser('never');
    const abort = new AbortController();
    const waiting = runAgent(
      ctx,
      RENAME,
      (call, i) => {
        const text = lastToolText(call);
        if (i === 0) return { toolCalls: [{ name: 'snapshot', input: {}, id: 's' }] };
        return {
          toolCalls: [{ name: 'click', input: { target: { ref: refIn(text, /button "Send request"/) } }, id: 'c' }],
        };
      },
      { session: { decideWrite: policy('ask', new Map()) }, loop: { signal: abort.signal } },
    );
    await sleep(1500);
    const other = await runAgent(ctx, `${FIXTURE_ORIGIN}/c-effects.html`, [
      { toolCalls: [{ name: 'read', input: {}, id: 'r' }] },
      { toolCalls: [{ name: 'done', input: { outcome: 'success', summary: 'Read.' }, id: 'd' }] },
    ]);
    const stillWaiting = cards.length === 1;
    abort.abort();
    const first = await waiting;
    return outcome(
      'the other run finishes while the card waits; Stop ends the first',
      `other ${other.end.outcome}; card open ${stillWaiting}; first ${first.end.status}`,
      other.end.outcome === 'success' && stillWaiting && first.end.status === 'stopped',
    );
  },
});
