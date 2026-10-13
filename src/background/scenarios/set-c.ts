// Fixture set C: action.
import type { Result, Target } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { evaluate, sleep } from '../checks/helpers';
import { defineScenario, outcome } from './registry';
import type { ScenarioContext } from './registry';

export function refOf(r: Result, pattern: RegExp): string {
  const line = r.page?.snapshot?.split('\n').find(l => pattern.test(l));
  const ref = line && /\[(\w+)\]/.exec(line)?.[1];
  if (!ref) throw new Error(`no line matching ${pattern} in:\n${r.page?.snapshot ?? r.text}`);
  return ref;
}

/** Resolve, revalidate and check, as an action would, without dispatching. */
export async function inspect(ctx: ScenarioContext, target: Target, pointer = true, editable = false) {
  return ctx.session.inspectTarget(target, { pointer, editable, budgetMs: 600 });
}

const code = (r: Awaited<ReturnType<typeof inspect>>) => (r.ok ? 'actionable' : r.error.code);
const message = (r: Awaited<ReturnType<typeof inspect>>) => (r.ok ? r.description : r.error.message);

defineScenario({
  id: 'C-2.4-obscured-banner',
  set: 'C',
  title: 'A cookie banner covers the target',
  covers: 'OBSCURED, naming the banner; nothing dispatched',
  async run(ctx) {
    const tabId = await ctx.open(`${FIXTURE_ORIGIN}/c-cookie-banner.html`);
    const r = await ctx.call('click', {
      target: { ref: refOf(await ctx.call('snapshot'), /button "Accept terms"/) },
      timeoutMs: 600,
    });
    const clicks = await evaluate<number>(tabId, undefined, 'window.clicks');
    return outcome(
      'OBSCURED naming dialog "Cookie preferences"; delivered false; the button saw no click',
      `${r.error?.code ?? 'ok'} (delivered ${r.error?.delivered}): ${r.error?.message}; clicks ${clicks}`,
      r.error?.code === 'OBSCURED' &&
        r.error.delivered === false &&
        /dialog «Cookie preferences»/.test(r.error.message) &&
        clicks === 0,
    );
  },
});

defineScenario({
  id: 'C-2.4-modal-over-frame',
  set: 'C',
  title: 'A parent-page modal covers a cross-origin iframe',
  covers: 'OBSCURED, naming the modal in the parent frame; nothing dispatched',
  async run(ctx) {
    const tabId = await ctx.open(`${FIXTURE_ORIGIN}/c-modal-over-frame.html`);
    await sleep(500);
    const snap = await ctx.call('snapshot');
    const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Frame action"/) }, timeoutMs: 600 });
    const { controller } = await import('../layer').then(m => m.layer());
    const frames = await controller.tabState(tabId).attachment!.topology.frames();
    const clicks = await evaluate<number>(tabId, frames.find(f => f.parentFrameId)!.sessionId, 'window.clicks');
    return outcome(
      'OBSCURED naming the parent modal’s backdrop (div#modal), in the page; the frame’s button saw no click',
      `${r.error?.code ?? 'ok'}: ${r.error?.message}; frame clicks ${clicks}`,
      r.error?.code === 'OBSCURED' &&
        /div#modal/.test(r.error.message) &&
        /in the page/.test(r.error.message) &&
        clicks === 0,
    );
  },
});

defineScenario({
  id: 'C-2.4-pointer-none',
  set: 'C',
  title: 'A visible button with pointer-events none inside a clickable card',
  covers: 'OBSCURED, the card would receive the click; nothing dispatched',
  async run(ctx) {
    const tabId = await ctx.open(`${FIXTURE_ORIGIN}/c-pointer-none.html`);
    const r = await ctx.call('click', {
      target: { ref: refOf(await ctx.call('snapshot'), /button "Open project"/) },
      timeoutMs: 600,
    });
    const counts = await evaluate<number[]>(tabId, undefined, '[window.cardClicks, window.buttonClicks]');
    return outcome(
      'OBSCURED: its container would receive the click; neither the card nor the button saw a click',
      `${r.error?.code ?? 'ok'}: ${r.error?.message}; card ${counts[0]}, button ${counts[1]}`,
      r.error?.code === 'OBSCURED' &&
        /would receive the click/.test(r.error.message) &&
        counts[0] === 0 &&
        counts[1] === 0,
    );
  },
});

defineScenario({
  id: 'C-2.3-rerender',
  set: 'C',
  title: 'A re-render replaces the button between observation and action',
  covers: 'NODE_DETACHED (the agent takes a fresh observation)',
  async run(ctx) {
    const tabId = await ctx.open(`${FIXTURE_ORIGIN}/c-states.html`);
    const ref = refOf(await ctx.call('snapshot'), /button "Rerendered action"/);
    await evaluate(
      tabId,
      undefined,
      `document.getElementById('rerender').innerHTML = document.getElementById('rerender').innerHTML; 1`,
    );
    const r = await inspect(ctx, { ref });
    return outcome('NODE_DETACHED', `${code(r)}: ${message(r)}`, !r.ok && r.error.code === 'NODE_DETACHED');
  },
});

defineScenario({
  id: 'C-2.3-aria-labels',
  set: 'C',
  title: 'aria-label and aria-labelledby disagree, unchanged between observation and action',
  covers: 'no TARGET_CHANGED',
  async run(ctx) {
    await ctx.open(`${FIXTURE_ORIGIN}/c-states.html`);
    const snap = await ctx.call('snapshot');
    const r = await inspect(ctx, { ref: refOf(snap, /button "Labelled by text"/) });
    return outcome('actionable', `${code(r)}: ${message(r)}`, r.ok);
  },
});

defineScenario({
  id: 'C-2.3-target-changed',
  set: 'C',
  title: 'The target’s name changed since it was shown',
  covers: 'TARGET_CHANGED reports what the node is now',
  async run(ctx) {
    const tabId = await ctx.open(`${FIXTURE_ORIGIN}/c-states.html`);
    const ref = refOf(await ctx.call('snapshot'), /button "Rename me"/);
    await evaluate(tabId, undefined, `document.getElementById('renamable').textContent = 'Delete everything'; 1`);
    const r = await inspect(ctx, { ref });
    return outcome(
      'TARGET_CHANGED naming the new name',
      `${code(r)}: ${message(r)}`,
      !r.ok && r.error.code === 'TARGET_CHANGED' && r.error.message.includes('Delete everything'),
    );
  },
});

defineScenario({
  id: 'C-2.3-not-actionable',
  set: 'C',
  title: 'Disabled, hidden, moving and read-only targets',
  covers: 'actionability: DISABLED, NOT_VISIBLE, NOT_STABLE, NOT_EDITABLE; nothing dispatched',
  async run(ctx) {
    const tabId = await ctx.open(`${FIXTURE_ORIGIN}/c-states.html`);
    const snap = await ctx.call('snapshot');
    const disabled = await inspect(ctx, { ref: refOf(snap, /button "Disabled action"/) });
    const hideable = refOf(snap, /button "Hideable action"/);
    await evaluate(tabId, undefined, `document.getElementById('hideable').style.visibility = 'hidden'; 1`);
    const hidden = await inspect(ctx, { ref: hideable });
    const moving = await inspect(ctx, { ref: refOf(snap, /button "Script-moved action"/) });
    const cssMoving = await inspect(ctx, { ref: refOf(snap, /button "Moving action"/) });
    const readonly = await inspect(ctx, { ref: refOf(snap, /textbox "Readonly field"/) }, false, true);
    const got = [disabled, hidden, moving, readonly].map(code);
    return outcome(
      'DISABLED, NOT_VISIBLE, NOT_STABLE, NOT_EDITABLE',
      `${got.join(', ')} (CSS-animated button: ${code(cssMoving)})`,
      got.join(',') === 'DISABLED,NOT_VISIBLE,NOT_STABLE,NOT_EDITABLE',
    );
  },
});

defineScenario({
  id: 'C-2.3-stale-navigation',
  set: 'C',
  title: 'Navigation in the middle of a sequence',
  covers: 'remaining refs are STALE_DOCUMENT',
  async run(ctx) {
    await ctx.open(`${FIXTURE_ORIGIN}/c-states.html`);
    const ref = refOf(await ctx.call('snapshot'), /button "Rename me"/);
    await ctx.call('navigate', { url: `${FIXTURE_ORIGIN}/c-states.html?again` });
    const r = await inspect(ctx, { ref });
    return outcome('STALE_DOCUMENT', `${code(r)}: ${message(r)}`, !r.ok && r.error.code === 'STALE_DOCUMENT');
  },
});

defineScenario({
  id: 'C-2.3-semantic',
  set: 'C',
  title: 'Semantic targets match exactly one element or refuse',
  covers: 'a semantic target must match exactly one node; AMBIGUOUS_TARGET, NO_MATCH',
  async run(ctx) {
    await ctx.open(`${FIXTURE_ORIGIN}/c-states.html`);
    const one = await inspect(ctx, { role: 'button', name: 'Rename me' });
    const many = await inspect(ctx, { role: 'button' });
    const none = await inspect(ctx, { role: 'button', name: 'Nope' });
    const nth = await inspect(ctx, { role: 'button', nth: 4 });
    const got = [one, many, none, nth].map(code);
    return outcome(
      'actionable, AMBIGUOUS_TARGET, NO_MATCH, actionable (nth picks one)',
      got.join(', '),
      got.join(',') === 'actionable,AMBIGUOUS_TARGET,NO_MATCH,actionable',
    );
  },
});

defineScenario({
  id: 'C-2.3-cross-frame-point',
  set: 'C',
  title: 'A control in a cross-origin iframe nested two deep is actionable at a converted point',
  covers: 'clicked at the point converted up the frame chain (the click itself is checked under pointer dispatch)',
  async run(ctx) {
    await ctx.open(`${FIXTURE_ORIGIN}/frames-nested.html`);
    await sleep(500);
    const r = await inspect(ctx, { ref: refOf(await ctx.call('snapshot'), /button "Grandchild button"/) });
    const point = r.ok ? r.point : null;
    return outcome(
      'actionable at a top-level point inside both iframes',
      point
        ? `${r.ok && r.description} at (${Math.round(point.x)}, ${Math.round(point.y)})`
        : `${code(r)}: ${message(r)}`,
      !!point && point.x > 20 && point.y > 150,
    );
  },
});

// Pointer dispatch.

defineScenario({
  id: 'C-2.4-click-once',
  set: 'C',
  title: 'A click is delivered once and reaches its target',
  covers: 'retries happen before dispatch: at most one dispatch; the guard saw the press on the target',
  async run(ctx) {
    const tabId = await ctx.open(`${FIXTURE_ORIGIN}/c-states.html`);
    const r = await ctx.call('click', { target: { ref: refOf(await ctx.call('snapshot'), /button "Rename me"/) } });
    const clicks = await evaluate<number>(tabId, undefined, 'window.clicks');
    return outcome(
      'ok; dispatched; reachedTarget true; exactly 1 click',
      `${r.ok ? 'ok' : r.error?.code}; dispatched ${r.receipt?.dispatched}; reachedTarget ${r.receipt?.reachedTarget}; clicks ${clicks}`,
      r.ok && r.receipt?.dispatched === true && r.receipt.reachedTarget === true && clicks === 1,
      r.text,
    );
  },
});

/** Clicks "Save draft" on the hover-swap page and reads what the page saw. */
async function clickSaveDraft(ctx: ScenarioContext, query: string) {
  const tabId = await ctx.open(`${FIXTURE_ORIGIN}/c-hover-swap.html${query}`);
  const r = await ctx.call('click', { target: { ref: refOf(await ctx.call('snapshot'), /button "Save draft"/) } });
  const counts = await evaluate<number[]>(
    tabId,
    undefined,
    '[window.originalClicks, window.replacementClicks, window.downs]',
  );
  const actual = `${r.error?.code ?? 'ok'} (delivered ${r.error?.delivered}): ${r.error?.message}; original ${counts[0]}, replacement ${counts[1]}, mousedowns ${counts[2]}`;
  return { r, actual, untouched: counts.every(n => n === 0) };
}

defineScenario({
  id: 'C-2.4-intercepted',
  set: 'C',
  title: 'Hovering the target puts another button over it before the press',
  covers: 'INTERCEPTED; the covering button’s handlers never run',
  async run(ctx) {
    const { r, actual, untouched } = await clickSaveDraft(ctx, '?mode=cover');
    return outcome(
      'INTERCEPTED, delivered false; no click and no mousedown reached any page handler',
      actual,
      r.error?.code === 'INTERCEPTED' && r.error.delivered === false && untouched,
    );
  },
});

defineScenario({
  id: 'C-2.4-hover-swap',
  set: 'C',
  title: 'Hovering the target replaces it with another button before the press',
  covers: 'NODE_DETACHED after the pointer moved; no press is sent',
  async run(ctx) {
    const { r, actual, untouched } = await clickSaveDraft(ctx, '');
    return outcome(
      'NODE_DETACHED, delivered true (the pointer moved); no press was sent, so no click and no mousedown',
      actual,
      r.error?.code === 'NODE_DETACHED' && r.error.delivered === true && untouched,
    );
  },
});

defineScenario({
  id: 'C-2.4-alert',
  set: 'C',
  title: 'The click handler calls alert()',
  covers: 'one dispatch; the dialog is a pending modal',
  async run(ctx) {
    const tabId = await ctx.open(`${FIXTURE_ORIGIN}/c-alert.html`);
    const snap = await ctx.call('snapshot');
    const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Save settings"/) } });
    const blocked = await ctx.call('click', { target: { ref: refOf(snap, /button "Other action"/) } });
    await ctx.call('handle_dialog', { accept: true });
    const clicks = await evaluate<number>(tabId, undefined, 'window.clicks');
    return outcome(
      'ok with a pending dialog "Settings saved"; the next action is MODAL_PENDING; exactly 1 click',
      `${r.ok ? 'ok' : r.error?.code}; pending ${JSON.stringify(r.pending)}; next ${blocked.error?.code}; clicks ${clicks}`,
      r.ok &&
        r.pending?.[0]?.kind === 'dialog' &&
        /Settings saved/.test(r.pending[0].detail) &&
        blocked.error?.code === 'MODAL_PENDING' &&
        clicks === 1,
    );
  },
});

defineScenario({
  id: 'C-2.4-busy',
  set: 'C',
  title: 'The main thread is busy for three seconds',
  covers: 'the actionability wait absorbs it; no second click',
  async run(ctx) {
    const tabId = await ctx.open(`${FIXTURE_ORIGIN}/c-states.html`);
    const ref = refOf(await ctx.call('snapshot'), /button "Rename me"/);
    await evaluate(
      tabId,
      undefined,
      `setTimeout(() => { const end = Date.now() + 3000; while (Date.now() < end) {} }, 0); 1`,
    );
    await sleep(50);
    const start = performance.now();
    const r = await ctx.call('click', { target: { ref } });
    const ms = Math.round(performance.now() - start);
    const clicks = await evaluate<number>(tabId, undefined, 'window.clicks');
    return outcome(
      'ok after the page frees up; exactly 1 click',
      `${r.ok ? 'ok' : r.error?.code} after ${ms} ms; clicks ${clicks}`,
      r.ok && clicks === 1 && ms > 2000,
    );
  },
});

defineScenario({
  id: 'C-2.4-cross-frame-click',
  set: 'C',
  title: 'A control in a cross-origin iframe, nested two deep, is clicked',
  covers: 'clicked at the point converted up the frame chain',
  async run(ctx) {
    const tabId = await ctx.open(`${FIXTURE_ORIGIN}/frames-nested.html`);
    await sleep(500);
    const r = await ctx.call('click', {
      target: { ref: refOf(await ctx.call('snapshot'), /button "Grandchild button"/) },
    });
    const { controller } = await import('../layer').then(m => m.layer());
    const frames = await controller.tabState(tabId).attachment!.topology.frames();
    const text = await evaluate<string>(
      tabId,
      frames.find(f => f.depth === 2)!.sessionId,
      `document.getElementById('grandchild-button').textContent`,
    );
    return outcome(
      'ok; reachedTarget; the grandchild button says Clicked',
      `${r.ok ? 'ok' : r.error?.code}; reachedTarget ${r.receipt?.reachedTarget}; button "${text}"`,
      r.ok && r.receipt?.reachedTarget === true && text === 'Clicked',
    );
  },
});

defineScenario({
  id: 'C-2.4-closed-shadow-click',
  set: 'C',
  title: 'A control in a closed shadow root is acted on',
  covers: 'captured and acted on',
  async run(ctx) {
    const tabId = await ctx.open(`${FIXTURE_ORIGIN}/shadow-closed.html`);
    const r = await ctx.call('click', { target: { ref: refOf(await ctx.call('snapshot'), /button "Shadow button"/) } });
    const status = await evaluate<string>(tabId, undefined, `document.getElementById('status').textContent`);
    return outcome(
      'ok; reachedTarget; status "Shadow button clicked"',
      `${r.ok ? 'ok' : r.error?.code}; reachedTarget ${r.receipt?.reachedTarget}; status "${status}"`,
      r.ok && r.receipt?.reachedTarget === true && status === 'Shadow button clicked',
    );
  },
});

defineScenario({
  id: 'C-2.4-hover',
  set: 'C',
  title: 'hover moves the pointer without clicking',
  covers: 'the hover tool',
  async run(ctx) {
    const tabId = await ctx.open(`${FIXTURE_ORIGIN}/c-hover.html`);
    const r = await ctx.call('hover', { target: { ref: refOf(await ctx.call('snapshot'), /button "Account menu"/) } });
    const counts = await evaluate<number[]>(tabId, undefined, '[window.enters, window.clicks]');
    const menu = (await ctx.call('snapshot')).page?.snapshot ?? '';
    return outcome(
      '1 enter, 0 clicks; the hover menu appears',
      `enters ${counts[0]}, clicks ${counts[1]}; menu ${/menuitem "Profile"/.test(menu) ? 'shown' : 'hidden'}`,
      r.ok && counts[0] === 1 && counts[1] === 0 && /menuitem "Profile"/.test(menu),
    );
  },
});

defineScenario({
  id: 'C-2.4-scroll',
  set: 'C',
  title: 'scroll by a page, to the bottom and to the top',
  covers: 'scroll: offset changed; reports when the end is reached',
  async run(ctx) {
    await ctx.open(`${FIXTURE_ORIGIN}/large-table.html`);
    const page = await ctx.call('scroll', {});
    const bottom = await ctx.call('scroll', { to: 'bottom' });
    const top = await ctx.call('scroll', { to: 'top' });
    const lines = [page, bottom, top].map(r => r.receipt?.effect.signals.join(', ') ?? r.error?.code);
    return outcome(
      'offset grows by about a page; then "end reached"; then "top reached"',
      lines.join(' | '),
      page.receipt?.effect.verdict === 'changed' &&
        (bottom.receipt?.effect.signals ?? []).includes('end reached') &&
        (top.receipt?.effect.signals ?? []).includes('top reached'),
    );
  },
});

// set, type, press.

const TEXT_PAGE = `${FIXTURE_ORIGIN}/c-text.html`;

defineScenario({
  id: 'C-2.5-framework-inputs',
  set: 'C',
  title: 'A framework-controlled input and textarea',
  covers: 'set updates component state (it survives the next render)',
  async run(ctx) {
    const tabId = await ctx.open(TEXT_PAGE);
    const snap = await ctx.call('snapshot');
    const a = await ctx.call('set', {
      target: { ref: refOf(snap, /textbox "Controlled name"/) },
      value: 'Grace Hopper',
    });
    const b = await ctx.call('set', {
      target: { ref: refOf(snap, /textbox "Controlled notes"/) },
      value: 'line one\nline two',
    });
    await sleep(350);
    const state = await evaluate<{ controlled: string; notes: string }>(tabId, undefined, 'window.formState');
    return outcome(
      'both set; component state holds the values after re-renders; read-back met',
      `${a.receipt?.postcondition?.detail} / ${b.receipt?.postcondition?.detail}; state ${JSON.stringify(state)}`,
      a.ok &&
        b.ok &&
        state.controlled === 'Grace Hopper' &&
        state.notes === 'line one\nline two' &&
        a.receipt?.postcondition?.status === 'met',
    );
  },
});

defineScenario({
  id: 'C-2.5-rich-editor',
  set: 'C',
  title: 'A rich text editor',
  covers: 'set leaves the editor structure intact (nothing writes textContent)',
  async run(ctx) {
    const tabId = await ctx.open(TEXT_PAGE);
    await evaluate(tabId, undefined, `window.richNode = document.getElementById('rich'); 1`);
    const r = await ctx.call('set', {
      target: { ref: refOf(await ctx.call('snapshot'), /textbox "Rich editor"/) },
      value: 'Replaced text',
    });
    const check = await evaluate<{ same: boolean; toolbar: boolean; text: string }>(
      tabId,
      undefined,
      `({ same: window.richNode === document.getElementById('rich'), toolbar: !!document.getElementById('toolbar'), text: document.getElementById('rich').innerText.trim() })`,
    );
    return outcome(
      'text replaced; the same editor element and its toolbar remain',
      `${r.ok ? 'ok' : r.error?.code}; ${JSON.stringify(check)}`,
      r.ok && check.same && check.toolbar && check.text === 'Replaced text',
    );
  },
});

defineScenario({
  id: 'C-2.5-read-back-differs',
  set: 'C',
  title: 'A site reformats the value',
  covers: 'read-back differences are reported, not treated as failure',
  async run(ctx) {
    await ctx.open(TEXT_PAGE);
    const r = await ctx.call('set', {
      target: { ref: refOf(await ctx.call('snapshot'), /textbox "Phone"/) },
      value: '5551234567',
    });
    return outcome(
      'ok; postcondition unmet with the formatted value read back',
      `${r.ok ? 'ok' : r.error?.code}; ${r.receipt?.postcondition?.status}: ${r.receipt?.postcondition?.detail}`,
      r.ok &&
        r.receipt?.postcondition?.status === 'unmet' &&
        /\(555\) 123-4567/.test(r.receipt.postcondition.detail ?? ''),
    );
  },
});

defineScenario({
  id: 'C-2.5-select',
  set: 'C',
  title: 'A native select',
  covers: 'a select without the requested option gives NO_SUCH_OPTION with the options; AMBIGUOUS_OPTION',
  async run(ctx) {
    const tabId = await ctx.open(TEXT_PAGE);
    const snap = await ctx.call('snapshot');
    const country = refOf(snap, /combobox "Country"/);
    const byLabel = await ctx.call('set', { target: { ref: country }, value: 'United Kingdom' });
    const byValue = await ctx.call('set', { target: { ref: country }, value: 'fr' });
    const missing = await ctx.call('set', { target: { ref: country }, value: 'Atlantis' });
    const ambiguous = await ctx.call('set', { target: { ref: refOf(snap, /combobox "Plan"/) }, value: 'Standard' });
    const value = await evaluate<string>(tabId, undefined, `document.getElementById('country').value`);
    return outcome(
      'by label and by value work; Atlantis is NO_SUCH_OPTION listing the options; "Standard" is AMBIGUOUS_OPTION; the select keeps fr',
      `${byLabel.ok}/${byValue.ok}; ${missing.error?.code}: ${missing.error?.message}; ${ambiguous.error?.code}; value ${value}`,
      byLabel.ok &&
        byValue.ok &&
        missing.error?.code === 'NO_SUCH_OPTION' &&
        /«United Kingdom» \(«gb»\)/.test(missing.error.message) &&
        ambiguous.error?.code === 'AMBIGUOUS_OPTION' &&
        value === 'fr',
    );
  },
});

defineScenario({
  id: 'C-2.5-toggles',
  set: 'C',
  title: 'Checkbox and switch are set declaratively and verified',
  covers: 'click only if the state differs; state equals the requested value',
  async run(ctx) {
    const tabId = await ctx.open(TEXT_PAGE);
    const snap = await ctx.call('snapshot');
    const terms = refOf(snap, /checkbox "I agree"/);
    const on = await ctx.call('set', { target: { ref: terms }, value: true });
    const again = await ctx.call('set', { target: { ref: terms }, value: true });
    const dark = await ctx.call('set', { target: { ref: refOf(snap, /switch "Dark mode"/) }, value: true });
    const radioOff = await ctx.call('set', { target: { ref: refOf(snap, /radio "Small"/) }, value: false });
    const states = await evaluate<[boolean, string]>(
      tabId,
      undefined,
      `[document.getElementById('terms').checked, document.getElementById('dark').getAttribute('aria-checked')]`,
    );
    return outcome(
      'checked by one click; the second set dispatches nothing; the switch turns on; a radio cannot be unchecked',
      `on ${on.receipt?.dispatched}, again ${again.receipt?.dispatched} (${again.receipt?.postcondition?.detail}), switch ${dark.ok}, radio off ${radioOff.error?.code}; states ${JSON.stringify(states)}`,
      on.receipt?.dispatched === true &&
        again.receipt?.dispatched === false &&
        dark.ok &&
        radioOff.error?.code === 'NOT_INTERACTABLE' &&
        states[0] === true &&
        states[1] === 'true',
    );
  },
});

defineScenario({
  id: 'C-2.5-native-values',
  set: 'C',
  title: 'Date and range inputs',
  covers: 'native value setter plus input and change; value read back',
  async run(ctx) {
    await ctx.open(TEXT_PAGE);
    const snap = await ctx.call('snapshot');
    const date = await ctx.call('set', { target: { ref: refOf(snap, /"Start date"/) }, value: '2026-10-04' });
    const volume = await ctx.call('set', { target: { ref: refOf(snap, /slider "Volume"/) }, value: '8' });
    return outcome(
      'both set-value with the value read back',
      `${date.receipt?.mechanism} ${date.receipt?.postcondition?.detail}; ${volume.receipt?.mechanism} ${volume.receipt?.postcondition?.detail}`,
      date.receipt?.postcondition?.status === 'met' &&
        volume.receipt?.postcondition?.status === 'met' &&
        date.receipt.mechanism === 'set-value',
    );
  },
});

defineScenario({
  id: 'C-2.5-type-and-press',
  set: 'C',
  title: 'type sends one key per character; press Enter submits a search',
  covers: 'the type and press tools',
  async run(ctx) {
    const tabId = await ctx.open(TEXT_PAGE);
    const snap = await ctx.call('snapshot');
    const typed = await ctx.call('type', { target: { ref: refOf(snap, /textbox "Controlled name"/) }, text: 'abc' });
    const keys = await evaluate<number>(tabId, undefined, 'window.keys');
    await ctx.call('set', { target: { ref: refOf(snap, /searchbox "Search"/) }, value: 'invoices' });
    const pressed = await ctx.call('press', { keys: 'Enter' });
    await sleep(100);
    const searches = await evaluate<string[]>(tabId, undefined, 'window.searches');
    return outcome(
      '3 keydowns for "abc"; Enter in the search field submits "invoices"',
      `${typed.ok ? 'ok' : typed.error?.code}, keydowns ${keys}; press ${pressed.ok ? 'ok' : pressed.error?.code}, searches ${JSON.stringify(searches)}`,
      typed.ok && keys === 3 && pressed.ok && searches.length === 1 && searches[0] === 'invoices',
    );
  },
});

defineScenario({
  id: 'C-2.5-masked-read-back',
  set: 'C',
  title: 'A password set by the agent is never echoed',
  covers: 'password values are masked wherever page content is returned; masked fields are not echoed',
  async run(ctx) {
    await ctx.open(TEXT_PAGE);
    const r = await ctx.call('set', {
      target: { ref: refOf(await ctx.call('snapshot'), /textbox "Password"/) },
      value: 'correct-horse',
    });
    const snap = await ctx.call('snapshot');
    const leaked = JSON.stringify([r, snap]).includes('correct-horse');
    return outcome(
      'set ok; the value appears in no result',
      `${r.ok ? 'ok' : r.error?.code}; ${r.receipt?.postcondition?.detail}; leaked ${leaked}`,
      r.ok && !leaked,
    );
  },
});

defineScenario({
  id: 'C-2.5-cross-frame-text',
  set: 'C',
  title: 'Text into a field inside a cross-origin iframe',
  covers: 'Input.insertText on the root session reaches a field in an out-of-process frame',
  async run(ctx) {
    await ctx.open(`${FIXTURE_ORIGIN}/frames-nested.html`);
    await sleep(500);
    const r = await ctx.call('set', {
      target: { ref: refOf(await ctx.call('snapshot'), /textbox "Child field"/) },
      value: 'from the agent',
    });
    return outcome(
      'ok; read back "from the agent"',
      `${r.ok ? 'ok' : r.error?.code}; ${r.receipt?.postcondition?.detail ?? r.error?.message}`,
      r.ok && r.receipt?.postcondition?.status === 'met',
    );
  },
});

// Effect evidence, settle, expect, wait.

const EFFECTS = `${FIXTURE_ORIGIN}/c-effects.html`;
const signals = (r: Result) => r.receipt?.effect.signals.join(' · ') ?? r.error?.code ?? '';

async function clickOn(ctx: ScenarioContext, pattern: RegExp, extra: Record<string, unknown> = {}) {
  const snap = await ctx.call('snapshot');
  return ctx.call('click', { target: { ref: refOf(snap, pattern) }, ...extra });
}

defineScenario({
  id: 'C-2.6-delayed-request',
  set: 'C',
  title: 'A button whose only effect is a delayed request',
  covers: 'the receipt reports the request',
  async run(ctx) {
    await ctx.open(EFFECTS);
    const r = await clickOn(ctx, /button "Save later"/);
    return outcome(
      'effect changed; signals include request: GET /api/slow?… (query values are not printed)',
      `${r.receipt?.effect.verdict}: ${signals(r)}`,
      r.receipt?.effect.verdict === 'changed' && /request: GET «\/api\/slow\?…»/.test(signals(r)),
    );
  },
});

defineScenario({
  id: 'C-2.6-no-effect',
  set: 'C',
  title: 'A click with no effect settles quickly and says so',
  covers: 'a zero-effect result is reported, not retried; settle is capped at 500 ms with no evidence',
  async run(ctx) {
    const tabId = await ctx.open(EFFECTS);
    const snap = await ctx.call('snapshot');
    const start = performance.now();
    const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Do nothing"/) } });
    const ms = Math.round(performance.now() - start);
    void tabId;
    return outcome(
      'effect none; dispatched once; settled within about a second',
      `${r.receipt?.effect.verdict} (${signals(r) || 'no signals'}) in ${ms} ms`,
      r.receipt?.effect.verdict === 'none' && r.receipt.dispatched === true && ms < 1500,
    );
  },
});

defineScenario({
  id: 'C-2.6-mutations',
  set: 'C',
  title: 'A click that changes its enclosing block',
  covers: 'effect evidence version 1: mutations inside the target’s enclosing block',
  async run(ctx) {
    await ctx.open(EFFECTS);
    const r = await clickOn(ctx, /button "Toggle details"/);
    return outcome(
      'effect changed with mutations in the section',
      `${r.receipt?.effect.verdict}: ${signals(r)}`,
      r.receipt?.effect.verdict === 'changed' && /mutation/.test(signals(r)),
    );
  },
});

defineScenario({
  id: 'C-2.6-navigation',
  set: 'C',
  title: 'Same-document and new-document navigation are reported',
  covers: 'effect evidence: new document or URL change; the receipt names the navigation',
  async run(ctx) {
    await ctx.open(EFFECTS);
    const same = await clickOn(ctx, /button "Change the URL"/);
    const fresh = await clickOn(ctx, /button "Go to the landing page"/);
    return outcome(
      'same-document …#step-2, then new-document …/network-landed.html',
      `${same.receipt?.navigation?.kind} ${same.receipt?.navigation?.url}; ${fresh.receipt?.navigation?.kind} ${fresh.receipt?.navigation?.url}`,
      same.receipt?.navigation?.kind === 'same-document' &&
        /#step-2$/.test(same.receipt.navigation.url) &&
        fresh.receipt?.navigation?.kind === 'new-document' &&
        /network-landed\.html$/.test(fresh.receipt.navigation.url),
    );
  },
});

defineScenario({
  id: 'C-2.6-new-tab',
  set: 'C',
  title: 'A tab opened by an action',
  covers: 'added to the session and reported in the receipt; the agent decides whether to switch',
  async run(ctx) {
    const tabId = await ctx.open(EFFECTS);
    const r = await clickOn(ctx, /button "Open a new tab"/);
    const opened = r.receipt?.newTab?.tabId;
    const inSession = opened !== undefined && ctx.session.hasTab(opened);
    const active = ctx.session.activeTabId;
    if (opened !== undefined) {
      await ctx.session.unshareTab(opened);
      await chrome.tabs.remove(opened).catch(() => undefined);
    }
    return outcome(
      'receipt names the new tab; it is in the session; the active tab is unchanged',
      `newTab ${JSON.stringify(r.receipt?.newTab)}; in session ${inSession}; active ${active === tabId ? 'unchanged' : active}`,
      opened !== undefined && inSession && active === tabId,
    );
  },
});

defineScenario({
  id: 'C-2.6-removed',
  set: 'C',
  title: 'A target that removes itself',
  covers: 'effect evidence: target removed',
  async run(ctx) {
    await ctx.open(EFFECTS);
    const r = await clickOn(ctx, /button "Remove me"/);
    return outcome(
      'effect changed: target removed',
      `${r.receipt?.effect.verdict}: ${signals(r)}`,
      /target removed/.test(signals(r)),
    );
  },
});

defineScenario({
  id: 'C-2.6-expect',
  set: 'C',
  title: 'Postconditions: met, and unmet with the live reading',
  covers: 'expect; an expectation met ends settle early',
  async run(ctx) {
    await ctx.open(EFFECTS);
    const met = await clickOn(ctx, /button "Show a message later"/, { expect: { text: 'Saved!' } });
    const unmet = await clickOn(ctx, /button "Do nothing"/, { expect: { url: 'checkout' } });
    return outcome(
      'met for "Saved!" (shown after 600 ms); unmet for a URL that does not change, with the URL read',
      `${met.receipt?.postcondition?.status}; ${unmet.receipt?.postcondition?.status}: ${unmet.receipt?.postcondition?.detail}`,
      met.receipt?.postcondition?.status === 'met' &&
        unmet.receipt?.postcondition?.status === 'unmet' &&
        /URL is «http/.test(unmet.receipt.postcondition.detail ?? ''),
    );
  },
});

defineScenario({
  id: 'C-2.6-wait',
  set: 'C',
  title: 'wait for text, for an element to go, and a timeout',
  covers: 'the wait tool',
  async run(ctx) {
    await ctx.open(EFFECTS);
    const snap = await ctx.call('snapshot');
    await ctx.call('click', { target: { ref: refOf(snap, /button "Show a message later"/) }, timeoutMs: 100 });
    const text = await ctx.call('wait', { text: 'Saved!', timeoutMs: 3000 });
    const remove = refOf(snap, /button "Remove me"/);
    await ctx.call('click', { target: { ref: remove } });
    const gone = await ctx.call('wait', { target: { ref: remove }, state: 'detached' });
    const timeout = await ctx.call('wait', { text: 'Never shown', timeoutMs: 400 });
    return outcome(
      'text met; detached met; the third is TIMEOUT saying what was seen',
      `${text.ok ? text.text.split('\n')[0] : text.error?.code}; ${gone.ok ? 'detached met' : gone.error?.code}; ${timeout.error?.code}: ${timeout.error?.message}`,
      text.ok && gone.ok && timeout.error?.code === 'TIMEOUT' && /not on the page/.test(timeout.error.message),
    );
  },
});

// Lifecycle, dialogs, policy layer 2, tabs opened by the page, cancellation.

const NAV_PAGE = `${FIXTURE_ORIGIN}/c-navigation.html`;
const DENIED_HOST = '127.0.0.1:8787';

async function withDeniedPartner<T>(ctx: ScenarioContext, fn: () => Promise<T>): Promise<T> {
  await ctx.session.setUrlPolicy({ allow: [], deny: ['127.0.0.1'] });
  try {
    return await fn();
  } finally {
    await ctx.session.setUrlPolicy({ allow: [], deny: [] });
  }
}

async function deniedRequests(): Promise<number> {
  const { readRequests } = await import('../checks/helpers');
  return (await readRequests()).requests.filter(r => r.host === DENIED_HOST).reduce((n, r) => n + r.count, 0);
}

defineScenario({
  id: 'C-2.7-link-denied',
  set: 'C',
  title: 'A link to a denied site, in the same tab and with target=_blank',
  covers: 'URL_NOT_ALLOWED before dispatch (policy layer 2)',
  async run(ctx) {
    return withDeniedPartner(ctx, async () => {
      const { resetRequests } = await import('../checks/helpers');
      const tabId = await ctx.open(NAV_PAGE);
      await resetRequests();
      const snap = await ctx.call('snapshot');
      const same = await ctx.call('click', { target: { ref: refOf(snap, /link "Partner site"$/) } });
      const blank = await ctx.call('click', { target: { ref: refOf(snap, /link "Partner site in a new tab"/) } });
      const js = await ctx.call('click', { target: { ref: refOf(snap, /link "Script link"/) } });
      const url = (await chrome.tabs.get(tabId)).url;
      const hits = await deniedRequests();
      return outcome(
        'both URL_NOT_ALLOWED with nothing dispatched; a javascript: link is not a navigation and is clicked; the page stays; no request at the denied host',
        `${same.error?.code}/${same.error?.delivered}, ${blank.error?.code}; script link ${js.ok ? 'ok' : js.error?.code}; page ${url}; ${hits} denied requests`,
        same.error?.code === 'URL_NOT_ALLOWED' &&
          same.error.delivered === false &&
          blank.error?.code === 'URL_NOT_ALLOWED' &&
          js.ok &&
          url === NAV_PAGE &&
          hits === 0,
      );
    });
  },
});

defineScenario({
  id: 'C-2.7-form-denied',
  set: 'C',
  title: 'A form whose action is a denied site',
  covers: 'URL_NOT_ALLOWED before dispatch; no data is posted (button, set with submit, Enter)',
  async run(ctx) {
    return withDeniedPartner(ctx, async () => {
      const { resetRequests } = await import('../checks/helpers');
      await ctx.open(NAV_PAGE);
      await resetRequests();
      const snap = await ctx.call('snapshot');
      const button = await ctx.call('click', { target: { ref: refOf(snap, /button "Send to partner"/) } });
      const field = refOf(snap, /textbox "Partner note"/);
      const submit = await ctx.call('set', { target: { ref: field }, value: 'secret', submit: true });
      const enter = await ctx.call('press', { keys: 'Enter', target: { ref: field } });
      const hits = await deniedRequests();
      return outcome(
        'button, set with submit and Enter are all URL_NOT_ALLOWED; no request at the denied host',
        `${button.error?.code}, ${submit.error?.code}, ${enter.error?.code}; ${hits} denied requests`,
        [button, submit, enter].every(r => r.error?.code === 'URL_NOT_ALLOWED') && hits === 0,
      );
    });
  },
});

defineScenario({
  id: 'C-2.7-script-location',
  set: 'C',
  title: 'A button whose handler sets location to a denied site',
  covers: 'the document request is failed before it is sent; the page stays; the result reports it',
  async run(ctx) {
    return withDeniedPartner(ctx, async () => {
      const { resetRequests } = await import('../checks/helpers');
      const tabId = await ctx.open(NAV_PAGE);
      await resetRequests();
      const r = await ctx.call('click', {
        target: { ref: refOf(await ctx.call('snapshot'), /button "Go by script"/) },
      });
      const url = (await chrome.tabs.get(tabId)).url;
      const hits = await deniedRequests();
      return outcome(
        'the click is dispatched; the result reports URL_NOT_ALLOWED for the navigation; the page stays; no request at the denied host',
        `${r.ok ? 'ok' : r.error?.code}; ${r.text.split('\n').find(l => l.startsWith('policy:')) ?? 'no policy line'}; page ${url}; ${hits} denied requests`,
        r.ok && /policy: URL_NOT_ALLOWED/.test(r.text) && url === NAV_PAGE && hits === 0,
      );
    });
  },
});

defineScenario({
  id: 'C-2.7-page-popups',
  set: 'C',
  title: 'Tabs opened by page script',
  covers: 'new tabs opened by the page: a disallowed one is closed and reported; an allowed one joins the session',
  async run(ctx) {
    return withDeniedPartner(ctx, async () => {
      await ctx.open(NAV_PAGE);
      const snap = await ctx.call('snapshot');
      const denied = await ctx.call('click', { target: { ref: refOf(snap, /button "Open denied popup"/) } });
      await sleep(300);
      const allowed = await ctx.call('click', { target: { ref: refOf(snap, /button "Open allowed popup"/) } });
      const opened = allowed.receipt?.newTab?.tabId;
      const deniedTabs = (await chrome.tabs.query({})).filter(t =>
        (t.url ?? t.pendingUrl ?? '').startsWith('http://127.0.0.1'),
      ).length;
      const inSession = opened !== undefined && ctx.session.hasTab(opened);
      if (opened !== undefined) {
        await ctx.session.unshareTab(opened);
        await chrome.tabs.remove(opened).catch(() => undefined);
      }
      const report = [denied.text, allowed.text]
        .join('\n')
        .split('\n')
        .find(l => /opened a new tab/.test(l));
      return outcome(
        'the denied popup is closed and reported; the allowed popup is in the session',
        `${report ?? 'no report'}; denied tabs open ${deniedTabs}; allowed popup ${opened} in session ${inSession}`,
        !!report && deniedTabs === 0 && inSession,
      );
    });
  },
});

defineScenario({
  id: 'C-2.7-dialogs',
  set: 'C',
  title: 'confirm, prompt and an alert the page opens by itself',
  covers: 'modal states; handle_dialog; MODAL_PENDING until the dialog is handled',
  async run(ctx) {
    const tabId = await ctx.open(`${FIXTURE_ORIGIN}/c-dialogs.html`);
    const snap = await ctx.call('snapshot');
    await ctx.call('click', { target: { ref: refOf(snap, /button "Ask confirm"/) } });
    const blocked = await ctx.call('snapshot');
    const dismissed = await ctx.call('handle_dialog', { accept: false });
    const confirmResult = await evaluate<string>(tabId, undefined, `document.getElementById('result').textContent`);
    await ctx.call('click', { target: { ref: refOf(snap, /button "Ask prompt"/) } });
    await ctx.call('handle_dialog', { accept: true, promptText: 'Grace' });
    const promptResult = await evaluate<string>(tabId, undefined, `document.getElementById('result').textContent`);
    await ctx.call('click', { target: { ref: refOf(snap, /button "Alert later"/) } });
    await sleep(600);
    const later = await ctx.call('find', { role: 'button' });
    const handled = await ctx.call('handle_dialog', { accept: true });
    const none = await ctx.call('handle_dialog', { accept: true });
    return outcome(
      'snapshot MODAL_PENDING during confirm; dismissed → false; prompt → Grace; the page’s own alert blocks find; handled; no dialog left',
      `${blocked.error?.code}; ${dismissed.ok ? 'dismissed' : dismissed.error?.code} → ${confirmResult}; prompt → ${promptResult}; later: ${later.error?.code}; ${handled.ok ? 'handled' : handled.error?.code}; again: ${none.error?.code}`,
      blocked.error?.code === 'MODAL_PENDING' &&
        dismissed.ok &&
        confirmResult === 'false' &&
        promptResult === 'Grace' &&
        later.error?.code === 'MODAL_PENDING' &&
        handled.ok &&
        none.error?.code === 'INVALID_ARGUMENT',
    );
  },
});

defineScenario({
  id: 'C-2.7-alert-release',
  set: 'C',
  title: 'The release held back by an alert goes out once the dialog is handled',
  covers: 'the outstanding mouse release is sent after the dialog closes; one dispatch',
  async run(ctx) {
    const tabId = await ctx.open(`${FIXTURE_ORIGIN}/c-alert.html`);
    await evaluate(
      tabId,
      undefined,
      `window.ups = 0; document.addEventListener('mouseup', () => window.ups++, true); 1`,
    );
    const snap = await ctx.call('snapshot');
    const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Save settings"/) } });
    const handled = await ctx.call('handle_dialog', { accept: true });
    await sleep(200);
    const counts = await evaluate<number[]>(tabId, undefined, '[window.clicks, window.ups]');
    const next = await ctx.call('click', { target: { ref: refOf(snap, /button "Other action"/) } });
    return outcome(
      'one click, the release delivered after the dialog, and the next action works',
      `${r.ok ? 'ok' : r.error?.code} ${JSON.stringify(r.pending)}; ${handled.ok ? 'handled' : handled.error?.code}; clicks ${counts[0]}, mouseups ${counts[1]}; next ${next.ok ? 'ok' : next.error?.code}`,
      r.ok && handled.ok && counts[0] === 1 && counts[1] >= 1 && next.ok,
    );
  },
});

defineScenario({
  id: 'C-2.7-cancel',
  set: 'C',
  title: 'Cancelling a call before dispatch',
  covers: 'cancellation: checked between stages; cancelling before dispatch is clean',
  async run(ctx) {
    const tabId = await ctx.open(`${FIXTURE_ORIGIN}/c-states.html`);
    const snap = await ctx.call('snapshot');
    const early = new AbortController();
    early.abort();
    const before = await ctx.session.call(
      'click',
      { target: { ref: refOf(snap, /button "Rename me"/) } },
      { signal: early.signal },
    );
    // A disabled button keeps the actionability wait busy; the cancel arrives during it.
    const during = new AbortController();
    setTimeout(() => during.abort(), 300);
    const start = performance.now();
    const waiting = await ctx.session.call(
      'click',
      { target: { ref: refOf(snap, /button "Disabled action"/) }, timeoutMs: 4000 },
      { signal: during.signal },
    );
    const ms = Math.round(performance.now() - start);
    const clicks = await evaluate<number>(tabId, undefined, 'window.clicks');
    return outcome(
      'CANCELLED both times, delivered false, the second within about half a second; no click',
      `${before.error?.code}/${before.error?.delivered}; ${waiting.error?.code} after ${ms} ms; clicks ${clicks}`,
      before.error?.code === 'CANCELLED' &&
        before.error.delivered === false &&
        waiting.error?.code === 'CANCELLED' &&
        ms < 1500 &&
        clicks === 0,
    );
  },
});

defineScenario({
  id: 'C-2.7-tab-closed',
  set: 'C',
  title: 'The tab closes while a call is running',
  covers: 'pending work fails with DEBUGGER_DETACHED; the tab leaves the session',
  async run(ctx) {
    const tabId = await ctx.open(`${FIXTURE_ORIGIN}/c-states.html`);
    setTimeout(() => void chrome.tabs.remove(tabId), 300);
    const r = await ctx.call('wait', { text: 'Never shown', timeoutMs: 4000 });
    await sleep(100);
    return outcome(
      'the wait fails with DEBUGGER_DETACHED (or the tab is gone from the session); the tab is no longer in the session',
      `${r.error?.code}: ${r.error?.message}; in session ${ctx.session.hasTab(tabId)}`,
      ['DEBUGGER_DETACHED', 'TAB_NOT_IN_SESSION'].includes(r.error?.code ?? '') && !ctx.session.hasTab(tabId),
    );
  },
});
