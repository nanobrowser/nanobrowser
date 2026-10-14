// Scenarios for keys and text when focus moves: the guards keep them on the element that was judged. Each reproduces
// a reported case and checks it is closed.
import type { Result } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { evaluate } from '../checks/helpers';
import { approve, approveFieldEnter, decline, withUser } from './set-c-confirm';
import type { OpenPrompt } from '../prompts';
import { defineScenario, outcome } from './registry';
import type { ScenarioContext } from './registry';
import { refOf } from './set-c';

const GUARDS = `${FIXTURE_ORIGIN}/d-guards.html`;

/** Opens the fixture, turns on a page behaviour, then takes the snapshot the scenario acts from. */
async function openGuards(ctx: ScenarioContext, behaviour?: string): Promise<{ tabId: number; snap: Result }> {
  const tabId = await ctx.open(GUARDS);
  if (behaviour) await evaluate(tabId, undefined, `window.${behaviour}(); 1`);
  return { tabId, snap: await ctx.call('snapshot') };
}

const read = <T>(tabId: number, expression: string) => evaluate<T>(tabId, undefined, expression);
const prompts = (seen: OpenPrompt[]) =>
  seen.map(p => (p.kind === 'confirm' ? `${p.request.category}: ${p.request.reason}` : p.kind)).join(' | ') || 'none';
const err = (r: Result) => (r.ok ? 'ok' : `${r.error?.code}/${r.error?.delivered}: ${r.error?.message}`);

defineScenario({
  id: 'R2-press-focus-redirect',
  set: 'C',
  title: 'press Enter on a field whose focus handler moves focus to "Pay now"',
  covers: 'the key is guarded against the element that was classified; nothing is sent',
  async run(ctx) {
    return withUser(approveFieldEnter, async seen => {
      const { tabId, snap } = await openGuards(ctx, 'focusMovesToPay');
      const r = await ctx.call('press', { target: { ref: refOf(snap, /textbox "Entry"/) }, keys: 'Enter' });
      const payments = await read<number>(tabId, 'window.payments');
      return outcome(
        'INTERCEPTED naming the "Pay now" button, delivered false; no payment',
        `${err(r)}; prompts ${prompts(seen)}; payments ${payments}`,
        r.error?.code === 'INTERCEPTED' &&
          r.error.delivered === false &&
          /button#pay/.test(r.error.message) &&
          payments === 0,
      );
    });
  },
});

defineScenario({
  id: 'R2-press-focused-redirect',
  set: 'C',
  title: 'press Enter with no target on a field whose keydown handler moves focus to "Pay now"',
  covers: 'a target-less key is guarded against the focused element the gate judged',
  async run(ctx) {
    return withUser(approveFieldEnter, async seen => {
      const { tabId } = await openGuards(ctx, 'keydownMovesToPay');
      await read(tabId, `document.getElementById('entry').focus(); 1`);
      const r = await ctx.call('press', { keys: 'Enter' });
      const payments = await read<number>(tabId, 'window.payments');
      return outcome(
        'INTERCEPTED; no payment',
        `${err(r)}; prompts ${prompts(seen)}; payments ${payments}`,
        r.error?.code === 'INTERCEPTED' && payments === 0,
      );
    });
  },
});

defineScenario({
  id: 'R2-type-submit-redirect',
  set: 'C',
  title: 'type "a" with submit into a field whose keyup handler moves focus to "Pay now"',
  covers: 'the guard stays armed through the submitting Enter',
  async run(ctx) {
    return withUser(approveFieldEnter, async seen => {
      const { tabId, snap } = await openGuards(ctx, 'keyupMovesToPay');
      const r = await ctx.call('type', { target: { ref: refOf(snap, /textbox "Entry"/) }, text: 'a', submit: true });
      const payments = await read<number>(tabId, 'window.payments');
      return outcome(
        'INTERCEPTED naming the "Pay now" button; the text reached the field; no payment',
        `${err(r)}; prompts ${prompts(seen)}; payments ${payments}; entry "${await read(tabId, `document.getElementById('entry').value`)}"`,
        r.error?.code === 'INTERCEPTED' && /button#pay/.test(r.error.message) && payments === 0,
      );
    });
  },
});

defineScenario({
  id: 'R2-type-frame-same',
  set: 'C',
  title: 'type "secret" into a field whose first keydown moves focus into a same-origin frame',
  covers: 'the text never reaches the other document',
  async run(ctx) {
    const { tabId, snap } = await openGuards(ctx, 'keydownMovesToFrame');
    const r = await ctx.call('type', { target: { ref: refOf(snap, /textbox "Entry"/) }, text: 'secret' });
    const other = await read<string>(tabId, 'window.frameValue()');
    return outcome(
      'INTERCEPTED; the frame field is empty',
      `${err(r)}; frame field "${other}"`,
      r.error?.code === 'INTERCEPTED' && other === '',
    );
  },
});

defineScenario({
  id: 'R2-type-frame-cross',
  set: 'C',
  title: 'type "secret" into a field whose first keydown moves focus into a cross-site frame',
  covers: 'an out-of-process frame gets none of the text either',
  async run(ctx) {
    const { tabId, snap } = await openGuards(ctx, 'keydownMovesToCross');
    const r = await ctx.call('type', { target: { ref: refOf(snap, /textbox "Entry"/) }, text: 'secret' });
    await new Promise(resolve => setTimeout(resolve, 200));
    const other = await read<string>(tabId, 'window.crossValue');
    return outcome(
      'INTERCEPTED; the cross-site field is empty',
      `${err(r)}; cross field "${other}"`,
      r.error?.code === 'INTERCEPTED' && other === '',
    );
  },
});

defineScenario({
  id: 'R2-guard-slow-keys',
  set: 'C',
  title: 'type ten letters into a field whose keydown handler takes 800 ms and moves focus on the sixth key',
  covers: 'the guard lasts as long as the sequence; nothing reaches the other field',
  async run(ctx) {
    const { tabId, snap } = await openGuards(ctx, 'slowKeys');
    const r = await ctx.call('type', { target: { ref: refOf(snap, /textbox "Entry"/) }, text: 'abcdefghij' });
    const entry = await read<string>(tabId, `document.getElementById('entry').value`);
    const alt = await read<string>(tabId, `document.getElementById('alt').value`);
    return outcome(
      'INTERCEPTED after five characters; Entry "abcde"; Alternate empty',
      `${err(r)}; entry "${entry}", alternate "${alt}"`,
      r.error?.code === 'INTERCEPTED' && entry === 'abcde' && alt === '',
    );
  },
});

defineScenario({
  id: 'R2-search-aria-pay',
  set: 'C',
  title: 'press Enter in a search form whose button is named "Pay now" through aria-labelledby',
  covers: 'the default button is classified by its accessible name',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await openGuards(ctx);
      const r = await ctx.call('press', { target: { ref: refOf(snap, /textbox "Search code"/) }, keys: 'Enter' });
      const submits = await read<string[]>(tabId, 'window.submits');
      return outcome(
        'one prompt for pay; USER_DECLINED; nothing submitted',
        `${prompts(seen)}; ${err(r)}; submits ${JSON.stringify(submits)}`,
        seen.length === 1 &&
          seen[0].kind === 'confirm' &&
          seen[0].request.category === 'pay' &&
          r.error?.code === 'USER_DECLINED' &&
          submits.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R2-expect-type-change',
  set: 'D',
  title: 'press ArrowRight in a password field that becomes a text field, with an unmet expect.value',
  covers: 'a field sensitive before the action stays masked after it',
  async run(ctx) {
    const { snap } = await openGuards(ctx, 'revealOnKey');
    const r = await ctx.call('press', {
      target: { ref: refOf(snap, /textbox "Access code"/) },
      keys: 'ArrowRight',
      expect: { value: 'wrong' },
    });
    return outcome(
      'postcondition unmet, masked; the password appears nowhere in the result',
      `${r.receipt?.postcondition?.status}: ${r.receipt?.postcondition?.detail}; leaked ${JSON.stringify(r).includes('test-secret-742')}`,
      r.receipt?.postcondition?.status === 'unmet' && !JSON.stringify(r).includes('test-secret-742'),
    );
  },
});

defineScenario({
  id: 'R2-select-same-label',
  set: 'D',
  title: 'set "paid" on a select whose two options share a label, and whose page reverts to "pending"',
  covers: 'the read-back compares options, not labels',
  async run(ctx) {
    const { tabId, snap } = await openGuards(ctx);
    const r = await ctx.call('set', { target: { ref: refOf(snap, /combobox "Status"/) }, value: 'paid' });
    const value = await read<string>(tabId, `document.getElementById('status').value`);
    return outcome(
      'postcondition unmet, naming the values; the select holds "pending"',
      `${r.receipt?.postcondition?.status}: ${r.receipt?.postcondition?.detail}; value ${value}`,
      r.receipt?.postcondition?.status === 'unmet' &&
        /pending/.test(r.receipt.postcondition.detail ?? '') &&
        value === 'pending',
    );
  },
});

defineScenario({
  id: 'R2-cached-find-baseline',
  set: 'D',
  title: 'a button renamed "Delete account" after the snapshot, then a scoped snapshot and a find served from cache',
  covers: 'the baseline is the print in the observation returned, cached or not',
  async run(ctx) {
    return withUser(approve, async seen => {
      const tabId = await ctx.open(`${FIXTURE_ORIGIN}/d-results.html`);
      const snap = await ctx.call('snapshot');
      await read(tabId, `document.getElementById('doc-action').textContent = 'Delete account'; 1`);
      await ctx.call('snapshot', { scope: refOf(snap, /button "Other action"/) });
      const found = await ctx.call('find', { name: 'Preview' });
      const ref = (found.data as Array<{ ref: string }>)[0]?.ref;
      const r = await ctx.call('click', { target: { ref } });
      const clicks = await read<string[]>(tabId, 'window.clicks');
      return outcome(
        'find shows "Preview" (cached); the click is TARGET_CHANGED; no prompt, no click',
        `find ${JSON.stringify((found.data as Array<{ line: string }>).map(d => d.line))}; ${err(r)}; prompts ${prompts(seen)}; clicks ${JSON.stringify(clicks)}`,
        !!ref && r.error?.code === 'TARGET_CHANGED' && seen.length === 0 && clicks.length === 0,
      );
    });
  },
});
