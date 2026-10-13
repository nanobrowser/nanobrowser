// Scenarios for masked values in element names: what the gate classifies, how names are compared, and when a changed
// name is quoted. Each reproduces a reported case in Chrome and checks it is closed; geometry.test.ts and
// url-policy.test.ts cover the two cases that need no browser.
import type { Result, SnapshotData } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { evaluate, sleep } from '../checks/helpers';
import { decline, withUser } from './set-c-confirm';
import { defineScenario, outcome } from './registry';
import type { ScenarioContext } from './registry';

const PAGE = `${FIXTURE_ORIGIN}/d-masked-names.html`;
const CARD = '4111111111111111';
const err = (r: Result) => (r.ok ? 'ok' : `${r.error?.code}/${r.error?.delivered}`);
const counts = (tabId: number) => evaluate<Record<string, number>>(tabId, undefined, 'window.counts');
const snapshot = (ctx: ScenarioContext) => ctx.call('snapshot', { window: 'page' }) as Promise<Result<SnapshotData>>;
const run = (tabId: number, script: string) => evaluate(tabId, undefined, `${script}; 1`);

function refOf(r: Result, pattern: RegExp): string {
  const line = (r.page?.snapshot ?? '').split('\n').find(l => pattern.test(l));
  const ref = line && /\[(\w+)\]/.exec(line)?.[1];
  if (!ref) throw new Error(`no line matching ${pattern} in:\n${r.page?.snapshot ?? r.text}`);
  return ref;
}

/** The card field inside the "Pay by card" radio: the first textbox after the radio's line. */
function cardFieldOf(r: Result): string {
  const lines = (r.page?.snapshot ?? '').split('\n');
  const from = lines.findIndex(l => /radio "Pay by card/.test(l));
  const ref = /\[(\w+)\] textbox/.exec(lines.slice(from + 1).join('\n'))?.[1];
  if (!ref) throw new Error(`no card field in:\n${r.page?.snapshot ?? r.text}`);
  return ref;
}

defineScenario({
  id: 'L9-secret-equals-label',
  set: 'C',
  title: 'a password field holds "Pay now"; click the button named "Pay now"; declined',
  covers: 'masking a value in names does not rename an unrelated control the gate classifies',
  async run(ctx) {
    return withUser(decline, async seen => {
      const tabId = await ctx.open(PAGE);
      await run(tabId, `document.getElementById('pw').value = 'Pay now'`);
      await sleep(200);
      const snap = await snapshot(ctx);
      const line = (snap.page?.snapshot ?? '').split('\n').find(l => /\] button/.test(l)) ?? '';
      const r = await ctx.call('click', { target: { ref: refOf(snap, /\] button/) } });
      const c = await counts(tabId);
      const p = seen[0]?.kind === 'confirm' ? seen[0].request : undefined;
      return outcome(
        'one pay prompt; USER_DECLINED; no click (the result filter may print the button’s name masked)',
        `line "${line.trim()}"; ${err(r)}; prompts ${seen.length} ${p?.category ?? ''}; clicks ${c.pay ?? 0}`,
        seen.length === 1 && p?.category === 'pay' && r.error?.code === 'USER_DECLINED' && !c.pay,
      );
    });
  },
});

defineScenario({
  id: 'L9-masked-name-changes',
  set: 'C',
  title:
    'controls named from a card field inside them: the field is filled, or the control renamed, after the snapshot',
  covers:
    'a name with a masked value is compared exactly, and a changed name is not quoted when it may hold a field’s value',
  async run(ctx) {
    const tabId = await ctx.open(PAGE);
    // Shown while its field was empty, clicked after the field was filled.
    const empty = await snapshot(ctx);
    // Filled through the layer, as an agent fills it: the value is then known to the result filter.
    const typed = await ctx.call('set', { target: { ref: cardFieldOf(empty) }, value: CARD });
    await sleep(200);
    const filled = await ctx.call('click', { target: { ref: refOf(empty, /radio "Pay by card/) } });
    // A control whose whole name is a masked value is renamed "Remove account …" on the same node.
    await run(tabId, `document.getElementById('card-only').value = '${CARD}'`);
    await sleep(200);
    const masked = await snapshot(ctx);
    const ref = refOf(masked, /\] button "••••••"/);
    const same = await ctx.call('hover', { target: { ref } });
    await run(tabId, `document.getElementById('only-field').prepend('Remove account ')`);
    await sleep(200);
    const renamed = await ctx.call('click', { target: { ref } });
    const c = await counts(tabId);
    const leaks = [empty, typed, filled, masked, same, renamed].filter(r => JSON.stringify(r).includes(CARD)).length;
    return outcome(
      'filled after the snapshot: TARGET_CHANGED; unchanged: usable; renamed: TARGET_CHANGED and not clicked; the card number in no result',
      `set ${err(typed)}; filled ${err(filled)}; unchanged ${err(same)}; renamed ${err(renamed)}; clicks ${JSON.stringify(c)}; leaks ${leaks}`,
      filled.error?.code === 'TARGET_CHANGED' &&
        same.ok &&
        renamed.error?.code === 'TARGET_CHANGED' &&
        !c['only-field'] &&
        leaks === 0,
    );
  },
});

defineScenario({
  id: 'L9-shadow-host-digest',
  set: 'D',
  title: 'click a button in a row that holds a shadow widget, and a clickable custom element with slotted text',
  covers: 'the capture’s digest leaves out shadow content under an element, as the probe’s does',
  async run(ctx) {
    const tabId = await ctx.open(PAGE);
    const snap = await snapshot(ctx);
    const rename = await ctx.call('click', { target: { ref: refOf(snap, /button "Rename"/) } });
    const slotted = await ctx.call('click', { target: { ref: refOf(snap, /clickable .*orders/i) } });
    const c = await counts(tabId);
    return outcome(
      'both clicks ok, each counted once',
      `rename ${err(rename)} ${rename.error?.message ?? ''}; slotted ${err(slotted)} ${slotted.error?.message ?? ''}; counts ${JSON.stringify(c)}`,
      rename.ok && slotted.ok && c['rename-carol'] === 1 && c.slotted === 1,
    );
  },
});

defineScenario({
  id: 'L9-toggle-dialog',
  set: 'C',
  title: 'set a checkbox whose click opens an alert',
  covers: 'the read-back of a toggle does not wait behind the dialog its click opened',
  async run(ctx) {
    await ctx.open(PAGE);
    const snap = await snapshot(ctx);
    const start = performance.now();
    const r = await ctx.call('set', { target: { ref: refOf(snap, /checkbox "Notify me"/) }, value: true });
    const ms = Math.round(performance.now() - start);
    const handled = await ctx.call('handle_dialog', { accept: true });
    return outcome(
      'ok within 3 s with the dialog pending; the dialog is handled',
      `${err(r)} in ${ms} ms; pending ${JSON.stringify(r.pending?.map(p => p.kind))}; handle_dialog ${err(handled)}`,
      r.ok && ms < 3_000 && !!r.pending?.some(p => p.kind === 'dialog') && handled.ok,
    );
  },
});

// More cases of masked values in names: the name the gate classifies, names compared as strings, and aria-labelledby.
defineScenario({
  id: 'L9-digit-secret-label',
  set: 'C',
  title: 'a field shown as text and named password holds "Pay now 2"; click the button named "Pay now 2"; declined',
  covers: 'the gate classifies the name Chrome gives, whatever is masked in what is printed',
  async run(ctx) {
    return withUser(decline, async seen => {
      const tabId = await ctx.open(PAGE);
      await run(
        tabId,
        `document.getElementById('pw').value = 'Pay now 2'; document.getElementById('pay').textContent = 'Pay now 2'`,
      );
      await sleep(200);
      const snap = await snapshot(ctx);
      const r = await ctx.call('click', { target: { ref: refOf(snap, /\] button/) } });
      const c = await counts(tabId);
      const p = seen[0]?.kind === 'confirm' ? seen[0].request : undefined;
      const leaks = JSON.stringify([snap, r, seen]).includes('Pay now 2');
      return outcome(
        'one pay prompt; USER_DECLINED; no click; the value in no result or prompt',
        `${err(r)}; prompts ${seen.length} ${p?.category ?? ''} (${p?.reason ?? ''}); clicks ${c.pay ?? 0}; value printed: ${leaks}`,
        seen.length === 1 && p?.category === 'pay' && r.error?.code === 'USER_DECLINED' && !c.pay && !leaks,
      );
    });
  },
});

defineScenario({
  id: 'L9-name-collision',
  set: 'C',
  title: 'a control named by a masked value is renamed to a name with the same 32-bit fingerprint',
  covers: 'a name with a masked value is compared as a string, not by a fingerprint',
  async run(ctx) {
    return withUser(decline, async seen => {
      const tabId = await ctx.open(PAGE);
      // fingerprint('token--xu22b6') === fingerprint('Remove account -9qlbqu') (FNV-1a, 32 bits).
      await run(tabId, `document.getElementById('card-only').value = 'token--xu22b6'`);
      await sleep(200);
      const snap = await snapshot(ctx);
      const ref = refOf(snap, /\] button "••••••"/);
      await run(tabId, `document.getElementById('only-field').textContent = 'Remove account -9qlbqu'`);
      await sleep(200);
      const r = await ctx.call('click', { target: { ref } });
      const c = await counts(tabId);
      return outcome(
        'TARGET_CHANGED; no click',
        `${err(r)}; prompts ${seen.length}; clicks ${c['only-field'] ?? 0}`,
        r.error?.code === 'TARGET_CHANGED' && !c['only-field'],
      );
    });
  },
});

defineScenario({
  id: 'L9-labelled-by-field',
  set: 'C',
  title: 'a button named by aria-labelledby from an empty card field; the field is filled after the snapshot',
  covers: 'a changed name is not quoted when aria-labelledby points at a field',
  async run(ctx) {
    const tabId = await ctx.open(PAGE);
    await run(tabId, `document.getElementById('pay').setAttribute('aria-labelledby', 'card')`);
    await sleep(200);
    const snap = await snapshot(ctx);
    const ref = refOf(snap, /\] button/);
    await ctx.call('set', { target: { ref: cardFieldOf(snap) }, value: CARD });
    await sleep(200);
    const r = await ctx.call('click', { target: { ref } });
    return outcome(
      'TARGET_CHANGED; the card number is not in the result',
      `${err(r)} ${(r.error?.message ?? '').split(CARD).join('[the card number]')}`,
      r.error?.code === 'TARGET_CHANGED' && !JSON.stringify(r).includes(CARD),
    );
  },
});

// Three more places a masked value was printed. One filter on every result and prompt covers them.
defineScenario({
  id: 'L9-result-filter',
  set: 'C',
  title:
    'a masked value in a focused button’s name (press with no target) and in a default button’s name (Enter in a field)',
  covers: 'a masked value is replaced in every result and prompt',
  async run(ctx) {
    return withUser(decline, async seen => {
      const SECRET = 'Pay now 2';
      const tabId = await ctx.open(PAGE);
      await run(
        tabId,
        `document.getElementById('pw').value = '${SECRET}'; document.getElementById('pay').textContent = '${SECRET}'`,
      );
      await sleep(200);
      await snapshot(ctx);
      await run(tabId, `document.getElementById('pay').focus()`);
      const focused = await ctx.call('press', { keys: 'Enter' });
      await run(
        tabId,
        `const form = document.createElement('form'); form.method = 'post'; form.action = '/submit'; const input = document.createElement('input'); input.setAttribute('aria-label', 'Query'); form.append(input); const button = document.getElementById('pay'); button.type = 'submit'; form.append(button); document.body.append(form)`,
      );
      await sleep(200);
      const withForm = await snapshot(ctx);
      const enter = await ctx.call('press', { keys: 'Enter', target: { ref: refOf(withForm, /textbox "Query"/) } });
      const prompts = seen.length;
      const c = await counts(tabId);
      const leaks = JSON.stringify([focused, enter, seen]).includes(SECRET) ? 1 : 0;
      return outcome(
        'both keys prompt for pay and are declined; the value in no result or prompt; no click',
        `focused ${err(focused)}, Enter ${err(enter)}, prompts ${prompts}; leaks ${leaks}; clicks ${JSON.stringify(c)}`,
        focused.error?.code === 'USER_DECLINED' &&
          enter.error?.code === 'USER_DECLINED' &&
          prompts === 2 &&
          leaks === 0 &&
          !c.pay,
      );
    });
  },
});
