// Scenarios for toggles, controls nested inside the target, and approvals bound to what was judged. Each reproduces
// a reported case, or one with the same cause, and checks it is closed.
import type { Result } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { evaluate, sleep } from '../checks/helpers';
import { approve, decline, withUser } from './set-c-confirm';
import type { OpenPrompt, Responder } from '../prompts';
import { defineScenario, outcome } from './registry';
import type { ScenarioContext } from './registry';
import { refOf } from './set-c';

const PAGE = `${FIXTURE_ORIGIN}/d-toggles-and-nested-controls.html`;
const OTPS = ['482913', '771045'];
const SLOTS = ['193847', '564738'];

/** Opens the fixture, turns on a page behaviour, then takes the snapshot the scenario acts from. */
async function openPage(ctx: ScenarioContext, behaviour?: string): Promise<{ tabId: number; snap: Result }> {
  const tabId = await ctx.open(PAGE);
  if (behaviour) await evaluate(tabId, undefined, `window.${behaviour}(); 1`);
  return { tabId, snap: await ctx.call('snapshot') };
}

const read = <T>(tabId: number, expression: string) => evaluate<T>(tabId, undefined, expression);
const effects = (tabId: number) => read<string[]>(tabId, 'window.effects');
const prompts = (seen: OpenPrompt[]) =>
  seen.map(p => (p.kind === 'confirm' ? `${p.request.category}: ${p.request.reason}` : p.kind)).join(' | ') || 'none';
const err = (r: Result) => (r.ok ? 'ok' : `${r.error?.code}/${r.error?.delivered}: ${r.error?.message}`);
const leaks = (r: Result, secrets: string[]) => secrets.filter(s => JSON.stringify(r).includes(s));

defineScenario({
  id: 'R5-double-click-covered',
  set: 'C',
  title: 'double-click "Preview", whose first click puts a separate "Pay now" button over it',
  covers: 'the guard applies the hit rule to every press of a click sequence, not only the first',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await openPage(ctx, 'firstClickCovers');
      const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Preview"/) }, count: 2 });
      await sleep(200);
      const e = await effects(tabId);
      return outcome(
        'INTERCEPTED naming the cover, delivered true (one click reached "Preview"); "Pay now" is not clicked',
        `${err(r)}; prompts ${prompts(seen)}; effects ${JSON.stringify(e)}`,
        r.error?.code === 'INTERCEPTED' &&
          r.error.delivered === true &&
          /button#cover/.test(r.error.message) &&
          e.join() === 'preview',
      );
    });
  },
});

defineScenario({
  id: 'R5-toggle-delete',
  set: 'C',
  title: 'set the checkbox "Delete account" to true; the scripted user declines',
  covers: 'a toggle that needs changing goes through the activation gate',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await openPage(ctx);
      const r = await ctx.call('set', { target: { ref: refOf(snap, /checkbox "Delete account"/) }, value: true });
      const checked = await read<boolean>(tabId, `document.getElementById('delete-account').checked`);
      const e = await effects(tabId);
      return outcome(
        'one prompt for delete; USER_DECLINED; the box stays unchecked',
        `${prompts(seen)}; ${err(r)}; checked ${checked}; effects ${JSON.stringify(e)}`,
        seen.length === 1 &&
          /^delete/.test(prompts(seen)) &&
          r.error?.code === 'USER_DECLINED' &&
          !checked &&
          e.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R5-toggle-already-set',
  set: 'C',
  title: 'set the checkbox "Delete account" to false while it is unchecked; the scripted user declines',
  covers: 'a toggle that already has the value is not dispatched and needs no approval',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await openPage(ctx);
      const r = await ctx.call('set', { target: { ref: refOf(snap, /checkbox "Delete account"/) }, value: false });
      const e = await effects(tabId);
      return outcome(
        'no prompt; met, already unchecked; nothing dispatched',
        `${prompts(seen)}; ${err(r)}; ${r.receipt?.postcondition?.status}: ${r.receipt?.postcondition?.detail}; dispatched ${r.receipt?.dispatched}; effects ${JSON.stringify(e)}`,
        seen.length === 0 &&
          r.ok &&
          r.receipt?.postcondition?.status === 'met' &&
          r.receipt.dispatched === false &&
          e.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R5-layout-label-hover',
  set: 'C',
  title: 'click the clickable box "Show details", whose mouseenter handler changes its aria-label to "Pay now"',
  covers: 'a layout ref is revalidated by every source of its name, not only its tag and text',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await openPage(ctx, 'hoverRenamesLabel');
      const r = await ctx.call('click', { target: { ref: refOf(snap, /"Show details"/) } });
      await sleep(200);
      const e = await effects(tabId);
      return outcome(
        'TARGET_CHANGED naming "Pay now", delivered true; no press is sent',
        `${err(r)}; prompts ${prompts(seen)}; effects ${JSON.stringify(e)}`,
        r.error?.code === 'TARGET_CHANGED' &&
          r.error.delivered === true &&
          /Pay now/.test(r.error.message) &&
          e.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R5-layout-label-changed',
  set: 'C',
  title: 'the aria-label of the clickable box "Show details" becomes "Pay now" after the snapshot; then a click',
  covers: 'the same change before the action is found when the target is resolved',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await openPage(ctx);
      const ref = refOf(snap, /"Show details"/);
      await read(tabId, `document.getElementById('details').setAttribute('aria-label', 'Pay now'); 1`);
      const r = await ctx.call('click', { target: { ref } });
      const e = await effects(tabId);
      return outcome(
        'TARGET_CHANGED naming "Pay now", delivered false; no click',
        `${err(r)}; prompts ${prompts(seen)}; effects ${JSON.stringify(e)}`,
        r.error?.code === 'TARGET_CHANGED' &&
          r.error.delivered === false &&
          /Pay now/.test(r.error.message) &&
          e.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R5-hover-row-swap',
  set: 'C',
  title: 'click "Delete" in row "Invoice A", approved; its mouseenter handler makes the row show "Invoice B"',
  covers: 'the record context is checked again before the press and the release',
  async run(ctx) {
    return withUser(approve, async seen => {
      const { tabId, snap } = await openPage(ctx, 'hoverSwapsRow');
      const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Delete"/) } });
      await sleep(200);
      const e = await effects(tabId);
      return outcome(
        'one prompt for delete in row "Invoice A"; TARGET_CHANGED about the row, delivered true; nothing deleted',
        `${prompts(seen)}; ${err(r)}; effects ${JSON.stringify(e)}`,
        seen.length === 1 &&
          r.error?.code === 'TARGET_CHANGED' &&
          r.error.delivered === true &&
          /row/.test(r.error.message) &&
          e.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R5-nested-control',
  set: 'C',
  title: 'click the container "Preview card", whose centre is the separate "Pay" button inside it',
  covers: 'a distinct control inside the target at the click point is not the target',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await openPage(ctx);
      const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Preview card"/) } });
      const e = await effects(tabId);
      return outcome(
        'OBSCURED naming the "Pay" button inside it, delivered false; nothing clicked',
        `${err(r)}; prompts ${prompts(seen)}; effects ${JSON.stringify(e)}`,
        r.error?.code === 'OBSCURED' &&
          r.error.delivered === false &&
          /card-pay/.test(r.error.message) &&
          e.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R5-type-nested-control',
  set: 'C',
  title: 'type into the editor "Notes" by its ref; the centre of the editor is a "Pay now" button inside it',
  covers: 'the click that focuses a field is not sent to a control inside it',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await openPage(ctx);
      const r = await ctx.call('type', { target: { ref: refOf(snap, /textbox "Notes"/) }, text: 'hello' });
      const e = await effects(tabId);
      return outcome(
        'OBSCURED naming the "Pay now" button, delivered false; nothing clicked or typed',
        `${err(r)}; prompts ${prompts(seen)}; effects ${JSON.stringify(e)}`,
        r.error?.code === 'OBSCURED' &&
          r.error.delivered === false &&
          /notes-pay/.test(r.error.message) &&
          e.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R5-pay-amount-changes',
  set: 'C',
  title: 'press Enter in "Payment note"; while the payment prompt is open the default button becomes "Pay $500"',
  covers: 'an approval is bound to what was judged (the default button’s name), not only its category',
  async run(ctx) {
    let tabId = 0;
    const raise: Responder = (_p, a) =>
      void read(tabId, `document.getElementById('pay').textContent = 'Pay $500'; 1`).then(() => a('approve'));
    return withUser(raise, async seen => {
      const opened = await openPage(ctx);
      tabId = opened.tabId;
      const r = await ctx.call('press', {
        target: { ref: refOf(opened.snap, /textbox "Payment note"/) },
        keys: 'Enter',
      });
      await sleep(200);
      const e = await effects(tabId);
      return outcome(
        'one prompt for pay naming "Pay $5"; TARGET_CHANGED naming "Pay $500"; nothing paid',
        `${prompts(seen)}; ${err(r)}; effects ${JSON.stringify(e)}`,
        seen.length === 1 &&
          /Pay \$5»/.test(prompts(seen)) &&
          r.error?.code === 'TARGET_CHANGED' &&
          /Pay \$500/.test(r.error.message) &&
          e.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R5-otp-select-labels',
  set: 'D',
  title: 'set an option of a one-time-code select whose labels are the codes; then one that does not exist',
  covers: 'in a sensitive select a label that repeats the value, or is only digits, is masked',
  async run(ctx) {
    const { tabId, snap } = await openPage(ctx);
    const target = { ref: refOf(snap, /combobox "Code"/) };
    const set = await ctx.call('set', { target, value: OTPS[1] });
    const none = await ctx.call('set', { target, value: '000000' });
    const value = await read<string>(tabId, `document.getElementById('otp').value`);
    return outcome(
      'the receipt is met and the error lists options by position; no code appears in either',
      `${set.receipt?.postcondition?.status}: ${set.receipt?.postcondition?.detail}; ${err(none)}; leaked ${leaks(set, OTPS).length + leaks(none, OTPS).length}; selected ${value === OTPS[1]}`,
      set.receipt?.postcondition?.status === 'met' &&
        none.error?.code === 'NO_SUCH_OPTION' &&
        /option 2/.test(none.error.message) &&
        value === OTPS[1] &&
        leaks(set, OTPS).length + leaks(none, OTPS).length === 0,
    );
  },
});

defineScenario({
  id: 'R5-select-turns-sensitive',
  set: 'D',
  title: 'set "Pickup slot"; its change handler makes it a one-time-code field and puts the first option back',
  covers: 'the read-back of a select is masked by its sensitivity after the change too',
  async run(ctx) {
    const { snap } = await openPage(ctx, 'slotBecomesSecret');
    const r = await ctx.call('set', { target: { ref: refOf(snap, /combobox "Pickup slot"/) }, value: SLOTS[1] });
    return outcome(
      'postcondition unmet, naming the options by position; neither slot code appears in the result',
      `${r.receipt?.postcondition?.status}: ${r.receipt?.postcondition?.detail}; signals ${r.receipt?.effect.signals.join('; ')}; leaked ${leaks(r, SLOTS).length}`,
      r.receipt?.postcondition?.status === 'unmet' && leaks(r, SLOTS).length === 0,
    );
  },
});

defineScenario({
  id: 'R5-toggle-submit',
  set: 'C',
  title: 'set the checkbox "Save card" in the payment form with submit: true, unchecked and then already checked',
  covers: 'submit on a toggle is refused before anything, whatever its state',
  async run(ctx) {
    return withUser(approve, async seen => {
      const { tabId, snap } = await openPage(ctx);
      const target = { ref: refOf(snap, /checkbox "Save card"/) };
      const first = await ctx.call('set', { target, value: true, submit: true });
      await read(tabId, `document.getElementById('save-card').checked = true; 1`);
      const second = await ctx.call('set', { target, value: true, submit: true });
      const e = await effects(tabId);
      return outcome(
        'INVALID_ARGUMENT both times; no prompt; nothing changed or submitted',
        `${err(first)}; ${err(second)}; prompts ${prompts(seen)}; effects ${JSON.stringify(e)}`,
        first.error?.code === 'INVALID_ARGUMENT' &&
          second.error?.code === 'INVALID_ARGUMENT' &&
          seen.length === 0 &&
          e.length === 0,
      );
    });
  },
});
