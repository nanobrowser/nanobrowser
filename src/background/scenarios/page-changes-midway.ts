// Scenarios for pages that change in the middle of an action: focus, names and dialogs that change while keys and
// clicks are sent. Each reproduces a reported case and checks it is closed.
import type { AuditEntry, Result } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { evaluate, sleep } from '../checks/helpers';
import { layer } from '../layer';
import { approve, approveFieldEnter, decline, withUser } from './set-c-confirm';
import type { OpenPrompt } from '../prompts';
import { defineScenario, outcome } from './registry';
import type { ScenarioContext } from './registry';
import { refOf } from './set-c';

const EDGES = `${FIXTURE_ORIGIN}/d-edges.html`;

/** Opens the fixture, turns on a page behaviour, then takes the snapshot the scenario acts from. */
async function openEdges(ctx: ScenarioContext, behaviour?: string): Promise<{ tabId: number; snap: Result }> {
  const tabId = await ctx.open(EDGES);
  if (behaviour) await evaluate(tabId, undefined, `window.${behaviour}(); 1`);
  return { tabId, snap: await ctx.call('snapshot') };
}

const read = <T>(tabId: number, expression: string) => evaluate<T>(tabId, undefined, expression);
const effects = (tabId: number) => read<string[]>(tabId, 'window.effects');
const prompts = (seen: OpenPrompt[]) =>
  seen.map(p => (p.kind === 'confirm' ? `${p.request.category}: ${p.request.reason}` : p.kind)).join(' | ') || 'none';
const err = (r: Result) => (r.ok ? 'ok' : `${r.error?.code}/${r.error?.delivered}: ${r.error?.message}`);
const asked = (seen: OpenPrompt[], category: string) =>
  seen.length === 1 && seen[0].kind === 'confirm' && seen[0].request.category === category;

defineScenario({
  id: 'R3-body-keys',
  set: 'C',
  title: 'type "x\\n" with nothing focused, on a page whose first keydown focuses "Pay now"',
  covers: 'keys sent with nothing focused are guarded to the document; nothing is paid',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId } = await openEdges(ctx, 'bodyKeyMovesToPay');
      const r = await ctx.call('type', { text: 'x\n' });
      const e = await effects(tabId);
      return outcome(
        'INTERCEPTED naming the "Pay now" button; no payment',
        `${err(r)}; prompts ${prompts(seen)}; effects ${JSON.stringify(e)}`,
        r.error?.code === 'INTERCEPTED' && /button#pay/.test(r.error.message) && e.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R3-closed-shadow-focus',
  set: 'C',
  title: 'press Enter with no target while a "Pay now" button inside a closed shadow root has focus',
  covers: 'the focused element is found inside closed shadow roots and classified',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId } = await openEdges(ctx, 'closedShadowPay');
      const r = await ctx.call('press', { keys: 'Enter' });
      const e = await effects(tabId);
      return outcome(
        'one prompt for pay; USER_DECLINED; no payment',
        `${prompts(seen)}; ${err(r)}; effects ${JSON.stringify(e)}`,
        asked(seen, 'pay') && r.error?.code === 'USER_DECLINED' && e.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R3-chord-dialog',
  set: 'C',
  title: 'press Shift+Enter on a field whose Shift handler opens confirm() and then focuses "Pay now"',
  covers: 'after a dialog no further key of the chord is sent; only the modifier is released',
  async run(ctx) {
    return withUser(approveFieldEnter, async seen => {
      const { tabId, snap } = await openEdges(ctx, 'shiftAsks');
      const r = await ctx.call('press', { target: { ref: refOf(snap, /textbox "Entry"/) }, keys: 'Shift+Enter' });
      const handled = await ctx.call('handle_dialog', { accept: true });
      await sleep(500);
      const e = await effects(tabId);
      return outcome(
        'the press reports the dialog; after it is accepted, Enter is never sent; no payment',
        `${err(r)}; ${r.receipt?.effect.signals.join('; ')}; handled ${err(handled)}; prompts ${prompts(seen)}; effects ${JSON.stringify(e)}`,
        r.ok && r.receipt?.effect.signals.some(s => s.startsWith('dialog')) === true && handled.ok && e.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R3-form-changes-midway',
  set: 'C',
  title: 'type "a\\n" into a field that the page joins to a checkout form after the first character',
  covers: 'a key that submits is classified again on the live page before it is sent',
  async run(ctx) {
    return withUser(approveFieldEnter, async seen => {
      const { tabId, snap } = await openEdges(ctx, 'inputJoinsCheckout');
      const r = await ctx.call('type', { target: { ref: refOf(snap, /textbox "Entry"/) }, text: 'a\n' });
      const e = await effects(tabId);
      return outcome(
        'stopped before the newline, saying it would now pay through "Pay now"; delivered true; nothing submitted',
        `${err(r)}; prompts ${prompts(seen)}; effects ${JSON.stringify(e)}`,
        r.error?.code === 'TARGET_CHANGED' &&
          r.error.delivered === true &&
          /pay/.test(r.error.message) &&
          e.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R3-image-submit',
  set: 'C',
  title: 'press Enter in a single-field GET form whose submit button is an image named "Pay now"',
  covers: 'an image submit button is a default button',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await openEdges(ctx);
      const r = await ctx.call('press', { target: { ref: refOf(snap, /textbox "Image form code"/) }, keys: 'Enter' });
      const e = await effects(tabId);
      return outcome(
        'one prompt for pay; USER_DECLINED; nothing submitted',
        `${prompts(seen)}; ${err(r)}; effects ${JSON.stringify(e)}`,
        asked(seen, 'pay') && r.error?.code === 'USER_DECLINED' && e.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R3-unnamed-renamed',
  set: 'C',
  title: 'an unnamed button is named "Pay now" after the snapshot, then clicked by its ref',
  covers: 'a name that appears is a change; TARGET_CHANGED, nothing dispatched',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await openEdges(ctx);
      const ref = refOf(snap, /\] button$/);
      await read(tabId, `document.getElementById('unnamed').textContent = 'Pay now'; 1`);
      const r = await ctx.call('click', { target: { ref } });
      const e = await effects(tabId);
      return outcome(
        'TARGET_CHANGED naming "Pay now"; no prompt; no click',
        `${err(r)}; prompts ${prompts(seen)}; effects ${JSON.stringify(e)}`,
        r.error?.code === 'TARGET_CHANGED' && /Pay now/.test(r.error.message) && seen.length === 0 && e.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R3-semantic-cached',
  set: 'C',
  title: '"Preview" renamed "Delete account", a scoped snapshot, then a semantic click on "Preview"',
  covers: 'a semantic target keeps the baseline of the observation it matched in',
  async run(ctx) {
    return withUser(approve, async seen => {
      const { tabId, snap } = await openEdges(ctx);
      await read(tabId, `document.getElementById('preview').textContent = 'Delete account'; 1`);
      await ctx.call('snapshot', { scope: refOf(snap, /button "Other action"/) });
      const r = await ctx.call('click', { target: { role: 'button', name: 'Preview' } });
      const e = await effects(tabId);
      return outcome(
        'TARGET_CHANGED ("was button "Preview""); no prompt; no click',
        `${err(r)}; prompts ${prompts(seen)}; effects ${JSON.stringify(e)}`,
        r.error?.code === 'TARGET_CHANGED' && seen.length === 0 && e.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R3-dialog-answer-audit',
  set: 'D',
  title: 'answer a prompt() for a one-time code, as an audit listener sees it',
  covers: 'handle_dialog promptText is redacted before the audit',
  async run(ctx) {
    const { controller } = await layer();
    const entries: AuditEntry[] = [];
    const tabId = await ctx.open(EDGES);
    await read(tabId, 'window.askCode(); 1');
    await sleep(200);
    const off = controller.onAudit(e => entries.push(e));
    try {
      const r = await ctx.call('handle_dialog', { accept: true, promptText: '864213' });
      const answer = await read<string>(tabId, 'window.answer');
      const logged = JSON.stringify(entries);
      return outcome(
        'the page got the answer; the audit holds only its length',
        `${err(r)}; page answer ${answer === '864213' ? 'received' : answer}; leaked ${logged.includes('864213')}; ${logged}`,
        r.ok && answer === '864213' && !logged.includes('864213') && /‹redacted, 6 characters›/.test(logged),
      );
    } finally {
      off();
    }
  },
});

defineScenario({
  id: 'R3-select-option-rewritten',
  set: 'D',
  title: 'set "paid" on a select whose change handler renames the selected option to "pending"',
  covers: 'the requested option is identified before the events run',
  async run(ctx) {
    const { tabId, snap } = await openEdges(ctx);
    const r = await ctx.call('set', { target: { ref: refOf(snap, /combobox "Rewrite status"/) }, value: 'paid' });
    const value = await read<string>(tabId, `document.getElementById('rewrite').value`);
    return outcome(
      'postcondition unmet: what is selected no longer has the requested value',
      `${r.receipt?.postcondition?.status}: ${r.receipt?.postcondition?.detail}; value ${value}`,
      r.receipt?.postcondition?.status === 'unmet',
    );
  },
});

defineScenario({
  id: 'R3-native-reverted',
  set: 'D',
  title: 'set a date field to 2027-02-02; the page puts it back to 2026-01-01 10 ms later',
  covers: 'a native value is read back after settle',
  async run(ctx) {
    const { tabId, snap } = await openEdges(ctx);
    const r = await ctx.call('set', { target: { ref: refOf(snap, /"Due date"/) }, value: '2027-02-02' });
    const value = await read<string>(tabId, `document.getElementById('due').value`);
    return outcome(
      'postcondition unmet, read back "2026-01-01"',
      `${r.receipt?.postcondition?.status}: ${r.receipt?.postcondition?.detail}; value ${value}`,
      r.receipt?.postcondition?.status === 'unmet' && /2026-01-01/.test(r.receipt.postcondition.detail ?? ''),
    );
  },
});

defineScenario({
  id: 'R3-partial-hint',
  set: 'D',
  title: 'type "abcd" into a field whose page moves focus on the third key',
  covers: 'a partly delivered sequence does not say that retrying is safe',
  async run(ctx) {
    const { tabId, snap } = await openEdges(ctx, 'thirdKeyMovesFocus');
    const r = await ctx.call('type', { target: { ref: refOf(snap, /textbox "Entry"/) }, text: 'abcd' });
    const value = await read<string>(tabId, `document.getElementById('entry').value`);
    return outcome(
      'INTERCEPTED, delivered true, "2 of 4 characters"; the hint does not call a retry safe',
      `${err(r)}; hint "${r.error?.hint}"; entry "${value}"`,
      r.error?.code === 'INTERCEPTED' &&
        r.error.delivered === true &&
        /2 of 4/.test(r.error.message) &&
        !/retrying is safe/.test(r.error.hint),
    );
  },
});
