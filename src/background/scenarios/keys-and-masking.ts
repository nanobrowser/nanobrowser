// Scenarios for keys (Enter, Space, newlines) and how they are classified, and for masked values in the audit and in
// evidence. Each reproduces a reported case and checks it is closed.
import type { AuditEntry, Result } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { evaluate } from '../checks/helpers';
import { layer } from '../layer';
import { approve, decline, withUser } from './set-c-confirm';
import type { OpenPrompt } from '../prompts';
import { defineScenario, outcome } from './registry';
import type { ScenarioContext } from './registry';
import { refOf } from './set-c';

const KEYS = `${FIXTURE_ORIGIN}/d-keys.html`;

async function openKeys(ctx: ScenarioContext): Promise<{ tabId: number; snap: Result }> {
  const tabId = await ctx.open(KEYS);
  return { tabId, snap: await ctx.call('snapshot') };
}

const submits = (tabId: number) => evaluate<string[]>(tabId, undefined, 'window.submits');
const clicks = (tabId: number) => evaluate<Record<string, number>>(tabId, undefined, 'window.clicks');
const valueOf = (tabId: number, selector: string) =>
  evaluate<string>(tabId, undefined, `document.querySelector(${JSON.stringify(selector)}).value`);
const prompted = (seen: OpenPrompt[]) =>
  seen.map(p => (p.kind === 'confirm' ? `${p.request.category}: ${p.request.reason}` : p.kind)).join(' | ') || 'none';
const category = (seen: OpenPrompt[]) => (seen[0]?.kind === 'confirm' ? seen[0].request.category : undefined);

defineScenario({
  id: 'R-keys-type-newline',
  set: 'C',
  title: 'type "4111\\n" into the card field of a payment form',
  covers: 'a typed newline is Enter; classified through the form’s "Pay now" button',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await openKeys(ctx);
      const r = await ctx.call('type', { target: { ref: refOf(snap, /textbox "Card number"/) }, text: '4111\n' });
      const s = await submits(tabId);
      return outcome(
        'one prompt for pay; USER_DECLINED; nothing typed or submitted',
        `${prompted(seen)}; ${r.error?.code}; submits ${JSON.stringify(s)}; card "${await valueOf(tabId, '[name=card]')}"`,
        seen.length === 1 &&
          category(seen) === 'pay' &&
          r.error?.code === 'USER_DECLINED' &&
          s.length === 0 &&
          (await valueOf(tabId, '[name=card]')) === '',
      );
    });
  },
});

defineScenario({
  id: 'R-keys-numpad-enter',
  set: 'C',
  title: 'press NumpadEnter in the card field of a payment form',
  covers: 'NumpadEnter dispatches Enter and is classified as Enter',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await openKeys(ctx);
      const r = await ctx.call('press', { target: { ref: refOf(snap, /textbox "Card number"/) }, keys: 'NumpadEnter' });
      const s = await submits(tabId);
      return outcome(
        'one prompt for pay; USER_DECLINED; nothing submitted',
        `${prompted(seen)}; ${r.error?.code}; submits ${JSON.stringify(s)}`,
        seen.length === 1 && category(seen) === 'pay' && r.error?.code === 'USER_DECLINED' && s.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R-keys-focused-space',
  set: 'C',
  title: 'type " " with no target while "Delete account" has focus',
  covers: 'a typed space is Space and activates the focused button; classified as delete',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId } = await openKeys(ctx);
      await evaluate(tabId, undefined, `document.getElementById('delete-account').focus(); 1`);
      const r = await ctx.call('type', { text: ' ' });
      const c = await clicks(tabId);
      return outcome(
        'one prompt for delete; USER_DECLINED; no click',
        `${prompted(seen)}; ${r.error?.code}; clicks ${JSON.stringify(c)}`,
        seen.length === 1 && category(seen) === 'delete' && r.error?.code === 'USER_DECLINED' && !c['delete-account'],
      );
    });
  },
});

defineScenario({
  id: 'R-keys-checkbox-enter',
  set: 'C',
  title: 'press Enter on a checkbox of a payment form; the user approves',
  covers: 'Enter on a checkbox submits its form implicitly, so it is classified through the form',
  async run(ctx) {
    return withUser(approve, async seen => {
      const { tabId, snap } = await openKeys(ctx);
      const r = await ctx.call('press', { target: { ref: refOf(snap, /checkbox "Save this card"/) }, keys: 'Enter' });
      const s = await submits(tabId);
      return outcome(
        'one prompt for pay; approved; the payment form is submitted once',
        `${prompted(seen)}; ${r.ok ? 'ok' : r.error?.code}; submits ${JSON.stringify(s)}`,
        seen.length === 1 && category(seen) === 'pay' && r.ok && s.join() === 'payment',
      );
    });
  },
});

defineScenario({
  id: 'R-keys-textarea-newline',
  set: 'C',
  title: 'type two lines into a textarea of a payment form',
  covers: 'a newline typed into a textarea edits it; no prompt, nothing submitted',
  async run(ctx) {
    return withUser(approve, async seen => {
      const { tabId, snap } = await openKeys(ctx);
      const r = await ctx.call('type', {
        target: { ref: refOf(snap, /textbox "Note to seller"/) },
        text: 'Leave at\nthe door',
      });
      const s = await submits(tabId);
      const note = await valueOf(tabId, '[name=note]');
      return outcome(
        'no prompt; ok; the textarea holds both lines; nothing submitted',
        `${prompted(seen)}; ${r.ok ? 'ok' : r.error?.code}; note ${JSON.stringify(note)}; submits ${JSON.stringify(s)}`,
        seen.length === 0 && r.ok && note === 'Leave at\nthe door' && s.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R-search-pay-enter',
  set: 'C',
  title: 'press Enter in a single-field GET form whose button is "Pay now"',
  covers: 'the search exemption suppresses submit only; pay through the default button still prompts',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await openKeys(ctx);
      const r = await ctx.call('press', { target: { ref: refOf(snap, /textbox "Gift code"/) }, keys: 'Enter' });
      const s = await submits(tabId);
      return outcome(
        'one prompt for pay; USER_DECLINED; nothing submitted',
        `${prompted(seen)}; ${r.error?.code}; submits ${JSON.stringify(s)}`,
        seen.length === 1 && category(seen) === 'pay' && r.error?.code === 'USER_DECLINED' && s.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R-guard-focus-move',
  set: 'C',
  title: 'type "abc" into a field whose page moves focus on the first key',
  covers: 'the text guard checks every key; the text never reaches the other field',
  async run(ctx) {
    const { tabId, snap } = await openKeys(ctx);
    await evaluate(tabId, undefined, 'window.moveFocusOnKey(); 1');
    const r = await ctx.call('type', { target: { ref: refOf(snap, /textbox "First field"/) }, text: 'abc' });
    const first = await valueOf(tabId, '#first');
    const second = await valueOf(tabId, '#second');
    return outcome(
      'INTERCEPTED, delivered true, naming the second field; neither field holds any text',
      `${r.error?.code}/${r.error?.delivered}: ${r.error?.message}; first "${first}", second "${second}"`,
      r.error?.code === 'INTERCEPTED' &&
        r.error.delivered === true &&
        /input#second/.test(r.error.message) &&
        first === '' &&
        second === '',
    );
  },
});

const SECRETS = `${FIXTURE_ORIGIN}/d-secrets.html`;

defineScenario({
  id: 'R-audit-redacted',
  set: 'D',
  title: 'type, set and fill_form values, and a rejected call, as audit listeners see them',
  covers: 'typed and set values are redacted before the audit; booleans and targets stay',
  async run(ctx) {
    const { controller } = await layer();
    const entries: AuditEntry[] = [];
    const off = controller.onAudit(e => entries.push(e));
    try {
      await ctx.open(SECRETS);
      const snap = await ctx.call('snapshot');
      const key = refOf(snap, /textbox "Access key"/);
      const otp = refOf(snap, /textbox "Verification"/);
      await ctx.call('type', { target: { ref: key }, text: 'typed-secret-1' });
      await ctx.call('set', { target: { ref: otp }, value: '135790', expect: { value: '135790' } });
      await ctx.call('fill_form', { fields: [{ target: { ref: key }, value: 'filled-secret-2' }] });
      const rejected = await ctx.call('type', { target: { ref: 'zz9' }, text: 'rejected-secret-3' });
      const logged = JSON.stringify(entries.filter(e => !e.tool.startsWith('(')));
      const leaks = ['typed-secret-1', '135790', 'filled-secret-2', 'rejected-secret-3'].filter(s =>
        logged.includes(s),
      );
      return outcome(
        'four entries; none holds a value; each value is a length placeholder; the rejected call is logged too',
        `${entries.length} entries; leaks ${JSON.stringify(leaks)}; rejected ${rejected.error?.code}; ${entries.map(e => JSON.stringify(e.args)).join(' | ')}`,
        leaks.length === 0 &&
          (logged.match(/‹redacted, \d+ characters›/g) ?? []).length >= 5 &&
          entries.some(e => e.tool === 'type' && !e.ok),
      );
    } finally {
      off();
    }
  },
});

defineScenario({
  id: 'R-expect-masked',
  set: 'D',
  title: 'set a password field with an expectation that is not met',
  covers: 'an unmet expect.value on a sensitive field does not print the live value',
  async run(ctx) {
    await ctx.open(SECRETS);
    const snap = await ctx.call('snapshot');
    const r = await ctx.call('set', {
      target: { ref: refOf(snap, /textbox "Access key"/) },
      value: 'new-secret-9',
      expect: { value: 'something else' },
    });
    return outcome(
      'postcondition unmet, "value differs (masked)"; the value appears nowhere in the result',
      `${r.receipt?.postcondition?.status}: ${r.receipt?.postcondition?.detail}; leaked ${JSON.stringify(r).includes('new-secret-9')}`,
      r.receipt?.postcondition?.status === 'unmet' &&
        /masked/.test(r.receipt.postcondition.detail ?? '') &&
        !JSON.stringify(r).includes('new-secret-9'),
    );
  },
});

defineScenario({
  id: 'R-evidence-masked',
  set: 'D',
  title: 'press a letter in a one-time-code field with a neutral label',
  covers: 'the effect evidence of any tool masks a sensitive field’s value',
  async run(ctx) {
    await ctx.open(SECRETS);
    const snap = await ctx.call('snapshot');
    const r = await ctx.call('press', { target: { ref: refOf(snap, /textbox "Verification"/) }, keys: 'x' });
    const signals = r.receipt?.effect.signals ?? [];
    return outcome(
      'signal "target value changed (masked)"; the code appears nowhere in the result',
      `${signals.join('; ')}; leaked ${JSON.stringify(r).includes('246810')}`,
      signals.includes('target value changed (masked)') && !JSON.stringify(r).includes('246810'),
    );
  },
});

defineScenario({
  id: 'R-masking-limit',
  set: 'D',
  title: 'a one-time-code field after 302 filled fields, with a neutral label and name',
  covers: 'a field past the attribute lookup limit is still masked (layout attributes, else fail closed)',
  async run(ctx) {
    await ctx.open(`${SECRETS}?fields=300`);
    const snap = await ctx.call('snapshot', { window: 'page' });
    const found = await ctx.call('find', { name: 'Reference' });
    const read = await ctx.call('read', { format: 'text' });
    const line = found.text.split('\n').find(l => /Reference/.test(l)) ?? '(not found)';
    const leaked = [snap, found, read].some(r => JSON.stringify(r).includes('654321'));
    return outcome(
      'the late code is printed masked by snapshot, find and read; "Field 300" is printed in clear',
      `${line.trim()}; leaked ${leaked}; Field 300 ${/value 300/.test(snap.page?.snapshot ?? '')}`,
      /"••••••" \(masked\)/.test(line) && !leaked && /value 300/.test(snap.page?.snapshot ?? ''),
    );
  },
});

const RESULTS = `${FIXTURE_ORIGIN}/d-results.html`;
const RECORDS = `${FIXTURE_ORIGIN}/d-records.html`;

defineScenario({
  id: 'R-baseline-rename',
  set: 'D',
  title: 'a button shown as "Preview" is renamed "Delete account", then a scoped snapshot that does not print it',
  covers: 'revalidation compares with what the session was shown; an unrelated capture does not move it',
  async run(ctx) {
    return withUser(approve, async seen => {
      const tabId = await ctx.open(RESULTS);
      const snap = await ctx.call('snapshot');
      const preview = refOf(snap, /button "Preview"/);
      await evaluate(tabId, undefined, `document.getElementById('doc-action').textContent = 'Delete account'; 1`);
      // A scoped snapshot always captures afresh (a find may reuse the last capture), and prints only its scope.
      const scoped = await ctx.call('snapshot', { scope: refOf(snap, /button "Other action"/) });
      const r = await ctx.call('click', { target: { ref: preview } });
      const c = await evaluate<string[]>(tabId, undefined, 'window.clicks');
      return outcome(
        'the scoped snapshot prints only "Other action"; the click is TARGET_CHANGED ("was button "Preview""); no prompt, no click',
        `scoped ${JSON.stringify(scoped.page?.snapshot?.trim())}; ${r.error?.code}: ${r.error?.message}; prompts ${prompted(seen)}; clicks ${JSON.stringify(c)}`,
        !/Delete account|Preview/.test(scoped.page?.snapshot ?? '') &&
          r.error?.code === 'TARGET_CHANGED' &&
          /Preview/.test(r.error.message) &&
          seen.length === 0 &&
          c.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'R-baseline-row',
  set: 'D',
  title: 'a virtualized row is reused for another record, then a scoped snapshot that does not print its button',
  covers: 'the record context fingerprint is the one the session was shown; nothing is deleted',
  async run(ctx) {
    const tabId = await ctx.open(RECORDS);
    const snap = await ctx.call('snapshot');
    const alice = refOf(snap, /button "Delete"/);
    await evaluate(tabId, undefined, `document.getElementById('reuse').click(); 1`);
    await ctx.call('snapshot', { scope: refOf(snap, /button "Sort descending"/) });
    const r = await ctx.call('click', { target: { ref: alice } });
    const d = await evaluate<string[]>(tabId, undefined, 'window.deleted');
    return outcome(
      'TARGET_CHANGED naming the new content; nothing deleted',
      `${r.error?.code}: ${r.error?.message}; deleted ${JSON.stringify(d)}`,
      r.error?.code === 'TARGET_CHANGED' && /Bob/.test(r.error.message) && d.length === 0,
    );
  },
});

defineScenario({
  id: 'R-observe-after-dialog',
  set: 'D',
  title: 'click "Ask confirm" with observe "full": the page state cannot be read',
  covers: 'the receipt stands (dispatched); the observation failure is pageError, not the call’s error',
  async run(ctx) {
    await ctx.open(`${FIXTURE_ORIGIN}/c-dialogs.html`);
    const snap = await ctx.call('snapshot');
    const start = performance.now();
    const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Ask confirm"/) }, observe: 'full' });
    const ms = Math.round(performance.now() - start);
    await ctx.call('handle_dialog', { accept: false });
    return outcome(
      'ok; receipt dispatched with the dialog signal; pageError MODAL_PENDING; no page (no capture is attempted)',
      `${r.ok ? 'ok' : r.error?.code}; dispatched ${r.receipt?.dispatched}; ${r.receipt?.effect.signals.join('; ')}; pageError ${r.pageError?.code}; page ${!!r.page}; ${ms} ms`,
      r.ok &&
        r.receipt?.dispatched === true &&
        r.pageError?.code === 'MODAL_PENDING' &&
        !r.page &&
        /page: MODAL_PENDING/.test(r.text),
    );
  },
});

defineScenario({
  id: 'R-select-reverted',
  set: 'D',
  title: 'set "Paid" on selects whose page reverts to "Pending", at once and 200 ms later',
  covers: 'the selection is read back after settle and compared with the request',
  async run(ctx) {
    await ctx.open(RESULTS);
    const snap = await ctx.call('snapshot');
    const now = await ctx.call('set', { target: { ref: refOf(snap, /combobox "Status"/) }, value: 'Paid' });
    const later = await ctx.call('set', { target: { ref: refOf(snap, /combobox "Later status"/) }, value: 'Paid' });
    const kept = await ctx.call('set', { target: { ref: refOf(snap, /combobox "Status"/) }, value: 'Pending' });
    const pc = (r: Result) => `${r.receipt?.postcondition?.status}: ${r.receipt?.postcondition?.detail}`;
    return outcome(
      'both reverted selects are unmet, "selected "Pending", requested "Paid""; selecting "Pending" is met',
      `${pc(now)} | ${pc(later)} | ${pc(kept)}`,
      [now, later].every(
        r =>
          r.receipt?.postcondition?.status === 'unmet' &&
          r.receipt.postcondition.detail === 'selected «Pending», requested «Paid»',
      ) && kept.receipt?.postcondition?.status === 'met',
    );
  },
});
