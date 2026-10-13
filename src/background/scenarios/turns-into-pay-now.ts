// Scenarios for a target that turns into "Pay now" during an action, and for masking in sensitive selects. Each
// reproduces a reported case, or one with the same cause, and checks it is closed.
import type { Result } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { evaluate, sleep } from '../checks/helpers';
import { approve, decline, withUser } from './set-c-confirm';
import type { OpenPrompt } from '../prompts';
import { defineScenario, outcome } from './registry';
import type { ScenarioContext } from './registry';
import { refOf } from './set-c';

const LATE = `${FIXTURE_ORIGIN}/d-late.html`;
const CARDS = ['4111111111111111', '5555555555554444'];

/** Opens the fixture, turns on a page behaviour, then takes the snapshot the scenario acts from. */
async function openLate(ctx: ScenarioContext, behaviour?: string): Promise<{ tabId: number; snap: Result }> {
  const tabId = await ctx.open(LATE);
  if (behaviour) await evaluate(tabId, undefined, `window.${behaviour}(); 1`);
  return { tabId, snap: await ctx.call('snapshot') };
}

const read = <T>(tabId: number, expression: string) => evaluate<T>(tabId, undefined, expression);
const effects = (tabId: number) => read<string[]>(tabId, 'window.effects');
const prompts = (seen: OpenPrompt[]) =>
  seen.map(p => (p.kind === 'confirm' ? `${p.request.category}: ${p.request.reason}` : p.kind)).join(' | ') || 'none';
const err = (r: Result) => (r.ok ? 'ok' : `${r.error?.code}/${r.error?.delivered}: ${r.error?.message}`);
const leaks = (r: Result) => CARDS.filter(card => JSON.stringify(r).includes(card));

/** A sequence stopped because "Preview" became "Pay now": TARGET_CHANGED naming it, with nothing paid. */
const stoppedAtPay = (r: Result, e: string[], delivered: boolean) =>
  r.error?.code === 'TARGET_CHANGED' && r.error.delivered === delivered && /Pay now/.test(r.error.message) && !e.length;

defineScenario({
  id: 'R4-space-release',
  set: 'C',
  title: 'press Space on "Preview", which its keydown handler turns into the form’s "Pay now" submit button',
  covers: 'the release of Space activates, so the button is judged again before it',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await openLate(ctx, 'spaceDownBecomesPay');
      const r = await ctx.call('press', { target: { ref: refOf(snap, /button "Preview"/) }, keys: 'Space' });
      await sleep(200);
      const e = await effects(tabId);
      return outcome(
        'TARGET_CHANGED naming "Pay now", delivered true; the release is withheld; nothing submitted',
        `${err(r)}; prompts ${prompts(seen)}; effects ${JSON.stringify(e)}`,
        stoppedAtPay(r, e, true),
      );
    });
  },
});

defineScenario({
  id: 'R4-space-typed',
  set: 'C',
  title: 'type " " with "Preview" focused, which its keydown handler turns into "Pay now"',
  covers: 'a typed space is a Space press; its release is judged too',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId } = await openLate(ctx, 'spaceDownBecomesPay');
      await read(tabId, `document.getElementById('preview').focus(); 1`);
      const r = await ctx.call('type', { text: ' ' });
      await sleep(200);
      const e = await effects(tabId);
      return outcome(
        'TARGET_CHANGED naming "Pay now", delivered true; nothing submitted',
        `${err(r)}; prompts ${prompts(seen)}; effects ${JSON.stringify(e)}`,
        stoppedAtPay(r, e, true),
      );
    });
  },
});

defineScenario({
  id: 'R4-space-dialog-release',
  set: 'C',
  title: 'press Space on "Preview", whose keydown handler opens confirm() and then turns it into "Pay now"',
  covers: 'a release held back by a dialog is withheld from the page when the dialog closes',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await openLate(ctx, 'spaceDownAsksThenPay');
      const r = await ctx.call('press', { target: { ref: refOf(snap, /button "Preview"/) }, keys: 'Space' });
      const handled = await ctx.call('handle_dialog', { accept: true });
      await sleep(500);
      const e = await effects(tabId);
      const next = await ctx.call('click', { target: { ref: refOf(await ctx.call('snapshot'), /button "Other"/) } });
      return outcome(
        'the press reports the dialog; handle_dialog says the release was withheld; nothing submitted; the next action works',
        `${err(r)}; ${r.receipt?.effect.signals.join('; ')}; handled ${err(handled)} ${handled.text.split('\n').find(l => /not released/.test(l)) ?? ''}; prompts ${prompts(seen)}; effects ${JSON.stringify(e)}; next ${err(next)}`,
        r.ok && handled.ok && /not released/.test(handled.text) && e.length === 0 && next.ok,
      );
    });
  },
});

defineScenario({
  id: 'R4-editor-inner-focus',
  set: 'C',
  title: 'type "x " into a focused editor whose first keydown focuses the "Pay now" button inside it',
  covers: 'focus on a control inside the target is not focus on the target',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId } = await openLate(ctx, 'firstKeyFocusesInner');
      await read(tabId, `document.getElementById('editor').focus(); 1`);
      const r = await ctx.call('type', { text: 'x ' });
      await sleep(200);
      const e = await effects(tabId);
      return outcome(
        'INTERCEPTED naming the button; the space is never sent; no payment',
        `${err(r)}; prompts ${prompts(seen)}; effects ${JSON.stringify(e)}`,
        r.error?.code === 'INTERCEPTED' && /button#inner/.test(r.error.message) && e.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R4-editor-inner-focus-target',
  set: 'C',
  title: 'type "x " into the editor by its ref; its first keydown focuses the "Pay now" button inside it',
  covers: 'the same with a target',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await openLate(ctx, 'firstKeyFocusesInner');
      const r = await ctx.call('type', { target: { ref: refOf(snap, /textbox "Editor"/) }, text: 'x ' });
      await sleep(200);
      const e = await effects(tabId);
      return outcome(
        'INTERCEPTED naming the button; no payment',
        `${err(r)}; prompts ${prompts(seen)}; effects ${JSON.stringify(e)}`,
        r.error?.code === 'INTERCEPTED' && /button#inner/.test(r.error.message) && e.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R4-hover-becomes-pay',
  set: 'C',
  title: 'click "Preview", which its mouseenter handler turns into the form’s "Pay now" submit button',
  covers: 'the target is revalidated and classified again after the pointer moves over it',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await openLate(ctx, 'hoverBecomesPay');
      const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Preview"/) } });
      await sleep(200);
      const e = await effects(tabId);
      return outcome(
        'TARGET_CHANGED naming "Pay now"; no press is sent; nothing submitted',
        `${err(r)}; prompts ${prompts(seen)}; effects ${JSON.stringify(e)}`,
        r.error?.code === 'TARGET_CHANGED' && /Pay now/.test(r.error.message) && e.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R4-press-becomes-pay',
  set: 'C',
  title: 'click "Preview", which its mousedown handler turns into the form’s "Pay now" submit button',
  covers: 'the same check before the release, which is what activates',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await openLate(ctx, 'pressBecomesPay');
      const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Preview"/) } });
      await sleep(200);
      const e = await effects(tabId);
      const next = await ctx.call('click', { target: { ref: refOf(await ctx.call('snapshot'), /button "Other"/) } });
      const after = await effects(tabId);
      return outcome(
        'TARGET_CHANGED naming "Pay now", delivered true; the release is withheld; the next click works',
        `${err(r)}; prompts ${prompts(seen)}; effects ${JSON.stringify(e)}; next ${err(next)} ${JSON.stringify(after)}`,
        stoppedAtPay(r, e, true) && next.ok && after.join() === 'other',
      );
    });
  },
});

defineScenario({
  id: 'R4-press-dialog-release',
  set: 'C',
  title: 'click "Preview", whose mousedown handler opens confirm() and then turns it into "Pay now"',
  covers: 'a release held back by a dialog is withheld from the page when the dialog closes',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await openLate(ctx, 'pressAsksThenPay');
      const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Preview"/) } });
      const handled = await ctx.call('handle_dialog', { accept: true });
      await sleep(500);
      const e = await effects(tabId);
      const next = await ctx.call('click', { target: { ref: refOf(await ctx.call('snapshot'), /button "Other"/) } });
      const after = await effects(tabId);
      return outcome(
        'the click reports the dialog; handle_dialog says the release was withheld; nothing submitted; the next click works',
        `${err(r)}; ${r.receipt?.effect.signals.join('; ')}; handled ${err(handled)} ${handled.text.split('\n').find(l => /withheld/.test(l)) ?? ''}; prompts ${prompts(seen)}; effects ${JSON.stringify(e)}; next ${err(next)} ${JSON.stringify(after)}`,
        r.ok && handled.ok && /withheld/.test(handled.text) && e.length === 0 && next.ok && after.join() === 'other',
      );
    });
  },
});

defineScenario({
  id: 'R4-double-click-becomes-pay',
  set: 'C',
  title: 'double-click "Preview", which its first click renames "Pay now"',
  covers: 'every press of a click sequence is checked, not only the first',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await openLate(ctx, 'firstClickRenames');
      const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Preview"/) }, count: 2 });
      await sleep(200);
      const e = await effects(tabId);
      return outcome(
        'TARGET_CHANGED naming "Pay now", delivered true; one click reached "Preview"; "Pay now" is not clicked',
        `${err(r)}; prompts ${prompts(seen)}; effects ${JSON.stringify(e)}`,
        r.error?.code === 'TARGET_CHANGED' &&
          r.error.delivered === true &&
          /Pay now/.test(r.error.message) &&
          e.join() === 'preview',
      );
    });
  },
});

defineScenario({
  id: 'R4-hidden-from-accessibility',
  set: 'C',
  title: '"Report" is renamed "Pay now" and given aria-hidden after the snapshot, then clicked by its ref',
  covers: 'a node Chrome no longer names cannot be checked, so the ref fails closed',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await openLate(ctx);
      const ref = refOf(snap, /button "Report"/);
      await read(tabId, 'window.renameHidden(); 1');
      const r = await ctx.call('click', { target: { ref } });
      const e = await effects(tabId);
      return outcome(
        'TARGET_CHANGED saying it is hidden from the accessibility tree; delivered false; no click',
        `${err(r)}; prompts ${prompts(seen)}; effects ${JSON.stringify(e)}`,
        r.error?.code === 'TARGET_CHANGED' &&
          r.error.delivered === false &&
          /aria-hidden/.test(r.error.message) &&
          e.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R4-hidden-then-renamed',
  set: 'C',
  title: '"Report" is hidden, renamed "Pay now" and shown again 600 ms later, while a click on its ref waits for it',
  covers: 'identity is checked again once the element is actionable',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await openLate(ctx);
      const ref = refOf(snap, /button "Report"/);
      await read(tabId, 'window.hideThenRename(); 1');
      const r = await ctx.call('click', { target: { ref } });
      const e = await effects(tabId);
      return outcome(
        'TARGET_CHANGED naming "Pay now"; delivered false; no click',
        `${err(r)}; prompts ${prompts(seen)}; effects ${JSON.stringify(e)}`,
        stoppedAtPay(r, e, false),
      );
    });
  },
});

defineScenario({
  id: 'R4-focused-hidden-key',
  set: 'C',
  title: 'press Enter with no target while "Report", renamed "Pay now" and given aria-hidden, has focus',
  covers: 'a focused element Chrome does not name is classified by the probe’s approximation',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId } = await openLate(ctx);
      await read(tabId, `window.renameHidden(); document.getElementById('report').focus(); 1`);
      const r = await ctx.call('press', { keys: 'Enter' });
      const e = await effects(tabId);
      return outcome(
        'one prompt for pay; USER_DECLINED; no click',
        `${prompts(seen)}; ${err(r)}; effects ${JSON.stringify(e)}`,
        seen.length === 1 && /^pay/.test(prompts(seen)) && r.error?.code === 'USER_DECLINED' && e.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R4-cropped-labels',
  set: 'D',
  title: 'A labelled screenshot cropped to "Other", after "Report" was renamed; then a click on the old "Report" ref',
  covers: 'only refs whose box is in the image are labelled and become the session’s baseline',
  async run(ctx) {
    const { tabId, snap } = await openLate(ctx);
    const ref = refOf(snap, /button "Report"/);
    await read(tabId, `document.getElementById('report').textContent = 'Different action'; 1`);
    // Past the reuse window, so the screenshot takes a new capture, which holds the new name.
    await sleep(2_100);
    const shot = await ctx.call('screenshot', { ref: refOf(snap, /button "Other"/), labels: true });
    const r = await ctx.call('click', { target: { ref } });
    const e = await effects(tabId);
    const line = shot.text.split('\n').find(l => l.startsWith('screenshot')) ?? '';
    return outcome(
      'one label in the image; the old ref is still TARGET_CHANGED; no click',
      `${line}; ${err(r)}; effects ${JSON.stringify(e)}`,
      / 1 labels?$/.test(line) && r.error?.code === 'TARGET_CHANGED' && e.length === 0,
    );
  },
});

defineScenario({
  id: 'R4-select-masked-receipt',
  set: 'D',
  title: 'set a saved card on a cc-number select whose change handler puts the first card back',
  covers: 'the read-back of a sensitive select shows no option value',
  async run(ctx) {
    const { tabId, snap } = await openLate(ctx, 'revertCard');
    const r = await ctx.call('set', { target: { ref: refOf(snap, /combobox "Card on file"/) }, value: CARDS[1] });
    const value = await read<string>(tabId, `document.getElementById('card').value`);
    return outcome(
      'postcondition unmet, telling the two "Saved card" options apart by position; no card number in the result',
      `${r.receipt?.postcondition?.status}: ${r.receipt?.postcondition?.detail}; signals ${r.receipt?.effect.signals.join('; ')}; leaked ${leaks(r).length}; page value ends ${value.slice(-4)}`,
      r.receipt?.postcondition?.status === 'unmet' &&
        /option 2/.test(r.receipt.postcondition.detail ?? '') &&
        leaks(r).length === 0,
    );
  },
});

defineScenario({
  id: 'R4-select-masked-error',
  set: 'D',
  title: 'set an option that does not exist on a cc-number select, then one that two options share',
  covers: 'NO_SUCH_OPTION and AMBIGUOUS_OPTION list a sensitive select’s options without values',
  async run(ctx) {
    const { snap } = await openLate(ctx);
    const target = { ref: refOf(snap, /combobox "Card on file"/) };
    const none = await ctx.call('set', { target, value: '4000000000000002' });
    const both = await ctx.call('set', { target, value: 'Saved card' });
    return outcome(
      'both errors list the options by label; neither holds a card number or the value asked for',
      `${err(none)}; ${err(both)}; leaked ${leaks(none).length + leaks(both).length}`,
      none.error?.code === 'NO_SUCH_OPTION' &&
        both.error?.code === 'AMBIGUOUS_OPTION' &&
        /Saved card/.test(none.error.message) &&
        !JSON.stringify(none).includes('4000000000000002') &&
        leaks(none).length + leaks(both).length === 0,
    );
  },
});

defineScenario({
  id: 'R4-native-submit',
  set: 'C',
  title: 'set a date field in a form with submit: true; the scripted user approves',
  covers: 'a native value setter sends the guarded Enter it was approved for',
  async run(ctx) {
    return withUser(approve, async seen => {
      const { tabId, snap } = await openLate(ctx);
      const r = await ctx.call('set', {
        target: { ref: refOf(snap, /"Delivery date"/) },
        value: '2027-02-02',
        submit: true,
      });
      const e = await effects(tabId);
      return outcome(
        'one prompt for submit; the form is submitted once, with the new date',
        `${prompts(seen)}; ${err(r)}; ${r.receipt?.postcondition?.status}; effects ${JSON.stringify(e)}`,
        seen.length === 1 && r.ok && e.join() === 'submit booking 2027-02-02',
      );
    });
  },
});

defineScenario({
  id: 'R4-color-submit',
  set: 'C',
  title: 'set a colour field with submit: true',
  covers: 'Enter opens a colour field’s picker, so the combination is refused before anything',
  async run(ctx) {
    return withUser(approve, async seen => {
      const { tabId, snap } = await openLate(ctx);
      const r = await ctx.call('set', { target: { ref: refOf(snap, /"Tint"/) }, value: '#ff0000', submit: true });
      const value = await read<string>(tabId, `document.getElementById('tint').value`);
      const e = await effects(tabId);
      return outcome(
        'INVALID_ARGUMENT; no prompt; the value is not set and nothing is submitted',
        `${err(r)}; prompts ${prompts(seen)}; value ${value}; effects ${JSON.stringify(e)}`,
        r.error?.code === 'INVALID_ARGUMENT' && seen.length === 0 && value === '#336699' && e.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R4-fill-partial-hint',
  set: 'D',
  title: 'fill_form of two fields; hovering the second covers it, so its click is cancelled',
  covers: 'the hint of a partly completed fill_form is for the whole call',
  async run(ctx) {
    const { tabId, snap } = await openLate(ctx, 'secondCoversOnHover');
    const r = await ctx.call('fill_form', {
      fields: [
        { target: { ref: refOf(snap, /textbox "First"/) }, value: 'changed' },
        { target: { ref: refOf(snap, /textbox "Second"/) }, value: 'next' },
      ],
    });
    const first = await read<string>(tabId, `document.getElementById('first').value`);
    return outcome(
      'INTERCEPTED, delivered true; the hint says field 1 is set and does not call a retry safe',
      `${err(r)}; hint "${r.error?.hint}"; first "${first}"`,
      r.error?.code === 'INTERCEPTED' &&
        r.error.delivered === true &&
        first === 'changed' &&
        !/retrying is safe|try again/i.test(r.error.hint) &&
        /field 1/i.test(r.error.hint),
    );
  },
});
