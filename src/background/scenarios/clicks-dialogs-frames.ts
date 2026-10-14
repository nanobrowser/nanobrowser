// Scenarios for clicks, keys, dialogs and frames: form facts, text digests, implicit submission, approvals, dialogs
// and points in out-of-process frames. Each reproduces a reported case in Chrome and checks it is closed. The cases
// that need no browser, or a display Chrome for Testing does not have here (a device scale factor of 2), are unit
// tests: window.test.ts, url-policy.test.ts, controller.test.ts.
import type { Result, ScreenshotData, SnapshotData } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { evaluate, sleep } from '../checks/helpers';
import type { Responder } from '../prompts';
import { approve, decline, withUser } from './set-c-confirm';
import { defineScenario, outcome } from './registry';
import type { ScenarioContext } from './registry';

const PAGE = `${FIXTURE_ORIGIN}/d-clicks-dialogs-frames.html`;
const err = (r: Result) => (r.ok ? 'ok' : `${r.error?.code}/${r.error?.delivered}`);
const counts = (tabId: number) => evaluate<Record<string, number>>(tabId, undefined, 'window.counts');

/** Opens the page and snapshots all of it (the page is longer than the default window). */
async function open(ctx: ScenarioContext): Promise<{ tabId: number; snap: Result<SnapshotData> }> {
  const tabId = await ctx.open(PAGE);
  await sleep(300);
  return { tabId, snap: (await ctx.call('snapshot', { window: 'page' })) as Result<SnapshotData> };
}

/** The refs of every outline line that matches, in order. */
function refsOf(r: Result, pattern: RegExp): string[] {
  const lines = (r.page?.snapshot ?? '').split('\n').filter(l => pattern.test(l));
  const refs = lines.map(l => /\[(\w+)\]/.exec(l)?.[1]).filter((ref): ref is string => !!ref);
  if (!refs.length) throw new Error(`no line matching ${pattern} in:\n${r.page?.snapshot ?? r.text}`);
  return refs;
}
const refOf = (r: Result, pattern: RegExp) => refsOf(r, pattern)[0];

defineScenario({
  id: 'L8-named-form-controls',
  set: 'C',
  title: 'click the submit button of a form whose hidden fields are named action, method, target and elements',
  covers: 'form facts are read past controls that shadow the form’s own properties',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await open(ctx);
      const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Keep note"/) } });
      const p = seen[0]?.kind === 'confirm' ? seen[0].request : undefined;
      const c = await counts(tabId);
      return outcome(
        'one submit prompt naming POST and /submit-clobber; USER_DECLINED; nothing submitted',
        `${err(r)}; prompts ${seen.length}: ${p?.category} (${p?.reason}); counts ${JSON.stringify(c)}`,
        seen.length === 1 &&
          p?.category === 'submit' &&
          /POST \S*\/submit-clobber/.test(p.reason ?? '') &&
          r.error?.code === 'USER_DECLINED' &&
          !c['submit-clobber'],
      );
    });
  },
});

defineScenario({
  id: 'L8-shadow-refs',
  set: 'D',
  title: 'click a button in a list item, and a clickable box, inside a shadow root',
  covers: 'text digests of elements inside a shadow tree match the live page',
  async run(ctx) {
    const { tabId, snap } = await open(ctx);
    const cartLine = (snap.page?.snapshot ?? '').split('\n').find(l => /clickable .*cart/i.test(l)) ?? '';
    const rename = await ctx.call('click', { target: { ref: refsOf(snap, /button "Rename"/)[1] } });
    const cart = await ctx.call('click', { target: { ref: refOf(snap, /clickable .*cart/i) } });
    const c = await counts(tabId);
    return outcome(
      'both clicks ok; the second row’s button and the box were clicked once; the box is named by its text',
      `rename ${err(rename)}, cart ${err(cart)}; counts ${JSON.stringify(c)}; line "${cartLine.trim()}"`,
      rename.ok &&
        cart.ok &&
        c['rename-bob'] === 1 &&
        !c['rename-alice'] &&
        c.cart === 1 &&
        /"Open cart"/.test(cartLine),
    );
  },
});

defineScenario({
  id: 'L8-indented-digest',
  set: 'D',
  title: 'click a clickable card whose markup is deeply indented',
  covers: 'the capture’s and the probe’s text digest agree on whitespace-heavy markup',
  async run(ctx) {
    const { tabId, snap } = await open(ctx);
    const r = await ctx.call('click', { target: { ref: refOf(snap, /clickable "New Wireless/) } });
    const c = await counts(tabId);
    return outcome(
      'ok; the card was clicked once',
      `${err(r)} ${r.error?.message ?? ''}; card ${c.card ?? 0}`,
      r.ok && c.card === 1,
    );
  },
});

defineScenario({
  id: 'L8-scroll-over-link',
  set: 'D',
  title: 'scroll a list of links by one page; hover it',
  covers: 'scroll and hover are not refused when a control is at the container’s centre',
  async run(ctx) {
    const { tabId, snap } = await open(ctx);
    const ref = refOf(snap, /\] scrollable/);
    const scrolled = await ctx.call('scroll', { target: { ref }, by: { pages: 1 } });
    const top = await evaluate<number>(tabId, undefined, `document.getElementById('links').scrollTop`);
    const hovered = await ctx.call('hover', { target: { ref } });
    return outcome(
      'scroll ok and the list moved; hover ok',
      `scroll ${err(scrolled)}, scrollTop ${top}; hover ${err(hovered)}`,
      scrolled.ok && top > 0 && hovered.ok,
    );
  },
});

defineScenario({
  id: 'L8-enter-date-form',
  set: 'C',
  title: 'press Enter in a text field of a form with a date field and no submit button; declined',
  covers: 'a date field does not block implicit submission, so Enter is a submit',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await open(ctx);
      const r = await ctx.call('press', { keys: 'Enter', target: { ref: refOf(snap, /textbox "Amount"/) } });
      const p = seen[0]?.kind === 'confirm' ? seen[0].request : undefined;
      const c = await counts(tabId);
      return outcome(
        'one submit prompt; USER_DECLINED; the form was not submitted',
        `${err(r)}; prompts ${seen.length} ${p?.category ?? ''}; submits ${c['submit-dated'] ?? 0}`,
        seen.length === 1 && p?.category === 'submit' && r.error?.code === 'USER_DECLINED' && !c['submit-dated'],
      );
    });
  },
});

defineScenario({
  id: 'L8-enter-skips-disabled',
  set: 'C',
  title: 'press Enter in a checkbox of a form whose first submit button is disabled and second is "Place order"',
  covers: 'Enter in a control other than a text field submits through the first enabled button',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await open(ctx);
      const r = await ctx.call('press', { keys: 'Enter', target: { ref: refOf(snap, /checkbox "Agree/) } });
      const p = seen[0]?.kind === 'confirm' ? seen[0].request : undefined;
      const c = await counts(tabId);
      return outcome(
        'one pay prompt naming "Place order"; USER_DECLINED; the form was not submitted',
        `${err(r)}; prompts ${seen.length} ${p?.category ?? ''} (${p?.reason ?? ''}); submits ${c['submit-skip'] ?? 0}`,
        seen.length === 1 &&
          p?.category === 'pay' &&
          /Place order/.test(p.reason ?? '') &&
          r.error?.code === 'USER_DECLINED' &&
          !c['submit-skip'],
      );
    });
  },
});

defineScenario({
  id: 'L8-unknown-answer',
  set: 'C',
  title: 'the prompt is answered with a value that is not an answer',
  covers: 'only an approval approves; anything else is a decline',
  async run(ctx) {
    const odd: Responder = (_p, a) => void a('later' as never);
    return withUser(odd, async seen => {
      const { tabId, snap } = await open(ctx);
      const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Remove item"/) } });
      const c = await counts(tabId);
      return outcome(
        'USER_DECLINED; no click',
        `${err(r)}; prompts ${seen.length}; clicks ${c.remove ?? 0}`,
        seen.length === 1 && r.error?.code === 'USER_DECLINED' && !c.remove,
      );
    });
  },
});

defineScenario({
  id: 'L8-count-sensitive',
  set: 'C',
  title: 'click "Pay now" with count 2',
  covers: 'one approval is for one activation; a multiple click on a sensitive target is refused',
  async run(ctx) {
    return withUser(approve, async seen => {
      const { tabId, snap } = await open(ctx);
      const ref = refOf(snap, /button "Pay now"/);
      const twice = await ctx.call('click', { target: { ref }, count: 2 });
      const afterTwice = (await counts(tabId)).pay ?? 0;
      const prompts = seen.length;
      const once = await ctx.call('click', { target: { ref } });
      const c = await counts(tabId);
      return outcome(
        'count 2: INVALID_ARGUMENT, no prompt, no click; count 1: one prompt, one click',
        `count 2 ${err(twice)}, prompts ${prompts}, clicks ${afterTwice}; count 1 ${err(once)}, prompts ${seen.length}, clicks ${c.pay ?? 0}`,
        twice.error?.code === 'INVALID_ARGUMENT' &&
          prompts === 0 &&
          afterTwice === 0 &&
          once.ok &&
          seen.length === 1 &&
          c.pay === 1,
      );
    });
  },
});

defineScenario({
  id: 'L8-already-attached',
  set: 'D',
  title: 'share a tab this extension’s debugger is already attached to, as after a service worker restart',
  covers: 'a debugger left attached by an earlier worker is detached and attached again',
  async run(ctx) {
    const tabId = await ctx.open(PAGE, { attach: false });
    await chrome.debugger.attach({ tabId }, '1.3');
    ctx.session.shareTab(tabId);
    const r = await ctx.call('snapshot', { tabId });
    return outcome('the snapshot succeeds', `${err(r)} ${r.error?.message ?? ''}`, r.ok);
  },
});

defineScenario({
  id: 'L8-dialog-settle',
  set: 'C',
  title: 'click a button whose handler opens a confirm dialog',
  covers: 'settle does not read the blocked page after a dialog (no false "target removed", no long wait)',
  async run(ctx) {
    const { snap } = await open(ctx);
    const start = performance.now();
    const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Open dialog"/) } });
    const ms = Math.round(performance.now() - start);
    const signals = r.receipt?.effect.signals ?? [];
    const handled = await ctx.call('handle_dialog', { accept: false });
    return outcome(
      'ok within 4 s; a dialog signal and no "target removed"; the dialog is handled',
      `${err(r)} in ${ms} ms; signals ${JSON.stringify(signals)}; handle_dialog ${err(handled)}`,
      r.ok &&
        ms < 4_000 &&
        signals.some(s => /^dialog confirm/.test(s)) &&
        !signals.includes('target removed') &&
        handled.ok,
    );
  },
});

defineScenario({
  id: 'L8-click-closes-tab',
  set: 'C',
  title: 'click a button whose handler closes the tab',
  covers: 'a click that closes its own tab returns its receipt, not INTERNAL',
  async run(ctx) {
    const { snap } = await open(ctx);
    const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Close window"/) } });
    return outcome(
      'ok, dispatched, with a receipt that says the tab closed',
      `${err(r)} ${r.error?.message ?? ''}; dispatched ${r.receipt?.dispatched}; signals ${JSON.stringify(r.receipt?.effect.signals)}`,
      r.ok && r.receipt?.dispatched === true && !!r.receipt.effect.signals.some(s => /the tab closed/.test(s)),
    );
  },
});

const WRAPPED = { card: '4111111111111111', code: '493817' };

defineScenario({
  id: 'L8-masked-in-names',
  set: 'D',
  title: 'snapshot, read and find a custom radio and a heading that wrap filled card and code fields',
  covers: 'a masked field’s value is not printed in the name of an element that contains the field',
  async run(ctx) {
    const tabId = await ctx.open(PAGE);
    await evaluate(
      tabId,
      undefined,
      `document.getElementById('wrapped-card').value = '${WRAPPED.card}'; document.getElementById('wrapped-code').value = '${WRAPPED.code}'; 1`,
    );
    await sleep(300);
    const snap = await ctx.call('snapshot', { window: 'page', mode: 'all' });
    const read = await ctx.call('read', {});
    const found = await ctx.call('find', { text: WRAPPED.card.slice(0, 6) });
    const json = JSON.stringify([snap, read, found]);
    const leaks = Object.values(WRAPPED).filter(v => json.includes(v)).length;
    const radio = (snap.page?.snapshot ?? '').split('\n').find(l => /radio "Pay by card/.test(l)) ?? '';
    return outcome(
      'the radio is listed by its text; neither value appears in snapshot, read or find',
      `radio line "${radio.trim()}"; leaks ${leaks}; read ${err(read)}; find ${err(found)}`,
      !!radio && leaks === 0 && read.ok && found.ok,
    );
  },
});

defineScenario({
  id: 'L8-iframe-ref-click',
  set: 'C',
  title: 'click the ref of a cross-site iframe itself',
  covers: 'a click on a frame element is refused; it would land on content nobody classified',
  async run(ctx) {
    const { tabId, snap } = await open(ctx);
    const r = await ctx.call('click', { target: { ref: refOf(snap, /\] iframe "Checkout frame"/i) } });
    await sleep(200);
    const c = await counts(tabId);
    return outcome(
      'NOT_INTERACTABLE, nothing delivered; no press reached the frame',
      `${err(r)}; presses in the frame ${c['child-down'] ?? 0}`,
      r.error?.code === 'NOT_INTERACTABLE' && r.error.delivered === false && !c['child-down'],
    );
  },
});

defineScenario({
  id: 'L8-press-unfocusable',
  set: 'C',
  title: 'press Enter on a clickable div that cannot take focus',
  covers: 'press on a target that does not take focus is INTERCEPTED with nothing sent, not INTERNAL',
  async run(ctx) {
    const { tabId, snap } = await open(ctx);
    const r = await ctx.call('press', { keys: 'Enter', target: { ref: refOf(snap, /clickable "New Wireless/) } });
    const c = await counts(tabId);
    return outcome(
      'INTERCEPTED, delivered false; the card was not activated',
      `${err(r)} ${r.error?.message ?? ''}; card ${c.card ?? 0}`,
      r.error?.code === 'INTERCEPTED' && r.error.delivered === false && !c.card,
    );
  },
});

defineScenario({
  id: 'L8-dialog-message',
  set: 'D',
  title: 'click a button that opens an alert with a 3,000-character message of several lines',
  covers: 'a dialog’s message is printed on one line and cut, so it cannot forge tool lines',
  async run(ctx) {
    const { snap } = await open(ctx);
    const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Long alert"/) } });
    const blocked = await ctx.call('snapshot');
    const handled = await ctx.call('handle_dialog', { accept: true });
    const detail = r.pending?.find(p => p.kind === 'dialog')?.detail ?? '';
    const texts = [r.text, blocked.text, handled.text];
    const forged = texts.filter(t => t.split('\n').some(l => l.startsWith('error INTERNAL (forged)'))).length;
    const longest = Math.max(...texts.map(t => t.length));
    return outcome(
      'the pending detail is one line of at most 300 characters; no result has a forged line or the whole message',
      `click ${err(r)}; detail ${detail.length} chars, ${detail.includes('\n') ? 'several lines' : 'one line'}; forged lines in ${forged} results; longest text ${longest}; handle_dialog ${err(handled)}`,
      r.ok &&
        detail.length > 0 &&
        detail.length <= 300 &&
        !detail.includes('\n') &&
        forged === 0 &&
        longest < 1_500 &&
        handled.ok,
    );
  },
});

defineScenario({
  id: 'L8-scrollbar-frame-click',
  set: 'C',
  title: 'click a 20 px button near the right edge of a cross-site frame that has a classic scrollbar',
  covers: 'a point in an out-of-process frame is converted by the frame’s whole viewport, scrollbar included',
  async run(ctx) {
    const { tabId, snap } = await open(ctx);
    const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Tick"/) } });
    await sleep(200);
    const c = await counts(tabId);
    return outcome(
      'ok; the button in the frame was clicked once',
      `${err(r)} ${r.error?.message ?? ''}; clicks ${c['child-click'] ?? 0}`,
      r.ok && c['child-click'] === 1,
    );
  },
});

defineScenario({
  id: 'L8-screenshot-scale',
  set: 'D',
  title: 'screenshot a page that has a classic scrollbar',
  covers: 'the image scale is the device scale, not the image width over a viewport without its scrollbar',
  async run(ctx) {
    const tabId = await ctx.open(PAGE);
    const r = (await ctx.call('screenshot')) as Result<ScreenshotData>;
    const dpr = await evaluate<number>(tabId, undefined, 'devicePixelRatio');
    return outcome(
      'scale equals the device pixel ratio',
      `${err(r)}; scale ${r.data?.scale}; image ${r.data?.width} px wide; device pixel ratio ${dpr}`,
      r.ok && r.data?.scale === dpr,
    );
  },
});

defineScenario({
  id: 'L8-navigate-failed',
  set: 'D',
  title: 'navigate to an address that refuses the connection',
  covers: 'a navigation that fails in the network is NAVIGATION_FAILED, not INTERNAL',
  async run(ctx) {
    await ctx.open(PAGE);
    // Nothing listens on port 9 (discard): the connection is refused at once.
    const r = await ctx.call('navigate', { url: 'http://127.0.0.1:9/' });
    return outcome(
      'NAVIGATION_FAILED naming the network error',
      `${err(r)} ${r.error?.message ?? r.text}`,
      (r.error?.code as string) === 'NAVIGATION_FAILED' && /ERR_/.test(r.error?.message ?? ''),
    );
  },
});
