// Fixture set D: enrichment.
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { evaluate } from '../checks/helpers';
import { applyDiff } from '@src/browser-control';
import type { Result } from '@src/browser-control';
import { layer } from '../layer';
import { defineScenario, outcome } from './registry';
import { refOf } from './set-c';

const CLICKABLES = `${FIXTURE_ORIGIN}/d-clickables.html`;
const clicks = (tabId: number) => evaluate<string[]>(tabId, undefined, 'window.clicks');

defineScenario({
  id: 'D-3.1-clickable-div',
  set: 'D',
  title: 'A clickable div with no role and no accessible name',
  covers: 'it has a ref; an unchanged page gives no TARGET_CHANGED when it is clicked, a changed text digest does',
  async run(ctx) {
    const tabId = await ctx.open(CLICKABLES);
    const snap = await ctx.call('snapshot');
    const card = refOf(snap, /clickable "Open settings ›"/);
    const icon = refOf(snap, /clickable \(div#icon-only/);
    const first = await ctx.call('click', { target: { ref: card } });
    const iconClick = await ctx.call('click', { target: { ref: icon } });
    await evaluate(
      tabId,
      undefined,
      `document.getElementById('open-settings').firstChild.textContent = 'Open preferences '; 1`,
    );
    const changed = await ctx.call('click', { target: { ref: card } });
    const c = await clicks(tabId);
    return outcome(
      'card and icon clicked once each; after the text changes, TARGET_CHANGED and no further click',
      `${first.ok ? 'ok' : first.error?.code}, icon ${iconClick.ok ? 'ok' : iconClick.error?.code}; then ${changed.error?.code}: ${changed.error?.message}; clicks ${JSON.stringify(c)}`,
      first.ok && iconClick.ok && changed.error?.code === 'TARGET_CHANGED' && c.join(',') === 'open-settings,icon-only',
    );
  },
});

defineScenario({
  id: 'D-3.1-hidden-checkbox-label',
  set: 'D',
  title: 'A hidden checkbox behind a styled label that contains a link',
  covers:
    'set clicks the label at a point off the link, toggles the checkbox and verifies; a hit on the link is never accepted',
  async run(ctx) {
    const tabId = await ctx.open(CLICKABLES);
    const snap = await ctx.call('snapshot');
    const terms = refOf(snap, /checkbox "I accept the terms"/);
    const on = await ctx.call('set', { target: { ref: terms }, value: true });
    const checked = await evaluate<boolean>(tabId, undefined, `document.getElementById('terms').checked`);
    const off = await ctx.call('set', { target: { ref: terms }, value: false });
    const unchecked = await evaluate<boolean>(tabId, undefined, `!document.getElementById('terms').checked`);
    const c = await clicks(tabId);
    return outcome(
      'checked, then unchecked, both verified; the link inside the label was never clicked',
      `on ${on.ok ? on.receipt?.postcondition?.status : on.error?.code}, off ${off.ok ? off.receipt?.postcondition?.status : off.error?.code}; checked ${checked}, unchecked ${unchecked}; clicks ${JSON.stringify(c)}`,
      on.ok && off.ok && checked && unchecked && !c.includes('terms-link'),
    );
  },
});

defineScenario({
  id: 'D-3.1-display-none-checkbox',
  set: 'D',
  title: 'A checkbox hidden with display: none, promoted onto its label',
  covers: 'a hidden native checkbox inside a styled label is promoted onto the visible wrapper',
  async run(ctx) {
    const tabId = await ctx.open(CLICKABLES);
    const snap = await ctx.call('snapshot');
    const r = await ctx.call('set', { target: { ref: refOf(snap, /checkbox "Newsletter"/) }, value: true });
    const checked = await evaluate<boolean>(tabId, undefined, `document.getElementById('newsletter').checked`);
    const after = (await ctx.call('snapshot')).page?.snapshot ?? '';
    return outcome(
      'set true checks it; the next snapshot shows it checked',
      `${r.ok ? 'ok' : r.error?.code}; checked ${checked}; ${/checkbox "Newsletter" \(checked\)/.test(after) ? 'outline checked' : 'outline not updated'}`,
      r.ok && checked && /checkbox "Newsletter" \(checked\)/.test(after),
    );
  },
});

defineScenario({
  id: 'D-3.1-scroll-container',
  set: 'D',
  title: 'A scrollable container found by layout',
  covers: 'scrollable containers get a ref; scroll acts on them',
  async run(ctx) {
    await ctx.open(CLICKABLES);
    const r = await ctx.call('scroll', {
      target: { ref: refOf(await ctx.call('snapshot'), /scrollable "Line 1/) },
      by: { px: 60 },
    });
    return outcome(
      'the container scrolls',
      `${r.receipt?.effect.signals.join(' · ') ?? r.error?.code}`,
      r.receipt?.effect.verdict === 'changed',
    );
  },
});

defineScenario({
  id: 'D-3.1-layout-fails',
  set: 'D',
  title: 'The layout snapshot fails',
  covers: 'the observation is built from the accessibility tree alone and says so',
  async run(ctx) {
    const tabId = await ctx.open(CLICKABLES);
    const { controller } = await layer();
    const capture = controller.tabState(tabId).capture;
    capture.failLayout = true;
    try {
      const r = await ctx.call('snapshot');
      const text = r.page?.snapshot ?? '';
      const notices = (r.data as { notices: string[] }).notices;
      return outcome(
        'ok; no clickable refs; a notice says the layout was not captured',
        `${r.ok ? 'ok' : r.error?.code}; clickable refs ${(text.match(/\] clickable /g) ?? []).length}; ${notices.find(n => n.startsWith('Layout'))}`,
        r.ok && !/\] clickable /.test(text) && notices.some(n => n.startsWith('Layout was not captured')),
      );
    } finally {
      capture.failLayout = false;
    }
  },
});

defineScenario({
  id: 'D-3.1-digest-agrees',
  set: 'D',
  title: 'The text digest has one definition on both sides',
  covers: 'capture computes it from the layout snapshot, the probe from the live node; the two agree on the fixtures',
  async run(ctx) {
    const tabId = await ctx.open(CLICKABLES);
    await ctx.call('snapshot');
    const { controller } = await layer();
    const tab = controller.tabState(tabId);
    const frames = await tab.attachment!.topology.frames();
    const mismatches: string[] = [];
    const layoutRefs = controller.registry.live(tabId).filter(r => r.source === 'layout');
    for (const record of layoutRefs) {
      const frame = frames.find(f => f.frameId === record.frameId)!;
      const objectId = await tab.probe!.resolve(frame, record.backendNodeId);
      const live = await tab.probe!.call<string>(frame, objectId, 'textDigest');
      await tab.probe!.release(frame, objectId);
      if (live !== record.print.text) mismatches.push(`${record.ref}: "${record.print.text}" vs "${live}"`);
    }
    return outcome(
      'every layout ref’s digest equals the probe’s',
      `${layoutRefs.length} layout refs; mismatches: ${mismatches.join('; ') || 'none'}`,
      layoutRefs.length >= 4 && !mismatches.length,
    );
  },
});

// Window and budget.

defineScenario({
  id: 'D-3.2-window-budget',
  set: 'D',
  title: 'A page longer than the window and larger than the budget',
  covers:
    'the notices state what was left out; the refs printed and the refs accepted are the same set; a cut ref is REF_NOT_PRESENTED',
  async run(ctx) {
    const tabId = await ctx.open(`${FIXTURE_ORIGIN}/d-long.html`);
    const { controller } = await layer();
    const budget = ctx.session.config.budget;
    ctx.session.config.budget = 2_500;
    try {
      const snap = await ctx.call('snapshot');
      const text = snap.page?.snapshot ?? '';
      const notices = (snap.data as { notices: string[] }).notices;
      const printed = new Set([...text.matchAll(/\[(\w+)\]/g)].map(m => m[1]));
      const accepted = controller.registry
        .live(tabId)
        .filter(r => ctx.session.known.has(tabId, r.ref))
        .map(r => r.ref);
      const sameSet = accepted.length === printed.size && accepted.every(r => printed.has(r));
      const cut = controller.registry.live(tabId).find(r => !printed.has(r.ref))!;
      const rejected = await ctx.call('click', { target: { ref: cut.ref } });
      const ok = await ctx.call('click', {
        target: { ref: [...printed].find(r => controller.registry.get(r)?.print.role === 'button')! },
      });
      await ctx.call('scroll', { by: { pages: 3 } });
      const later = (await ctx.call('snapshot')).page?.snapshot ?? '';
      const first = Number(/button "Open (\d+)"/.exec(later)?.[1] ?? 0);
      return outcome(
        'notices for the window and the cut; printed = accepted; a cut ref is REF_NOT_PRESENTED, a printed one clicks; after scrolling the outline starts further down',
        `${notices.filter(n => n.startsWith('…')).join(' | ')}; same set ${sameSet} (${printed.size}); cut ${cut.ref}: ${rejected.error?.code}; printed: ${ok.ok ? 'ok' : ok.error?.code}; after scroll first item ${first}`,
        notices.some(n => n.includes('below the window')) &&
          notices.some(n => n.startsWith('… outline cut')) &&
          sameSet &&
          rejected.error?.code === 'REF_NOT_PRESENTED' &&
          ok.ok &&
          first > 30,
      );
    } finally {
      ctx.session.config.budget = budget;
    }
  },
});

// Diffs.

defineScenario({
  id: 'D-3.3-diff',
  set: 'D',
  title: 'An action changes part of the page, with observe: "diff"',
  covers:
    'the previous outline with the diff applied equals a fresh full outline; refs added by the diff are accepted, refs it removed are not',
  async run(ctx) {
    await ctx.open(`${FIXTURE_ORIGIN}/c-effects.html`);
    const snap = await ctx.call('snapshot');
    const before = (snap.page?.snapshot ?? '').split('\n');
    const add = await ctx.call('click', { target: { ref: refOf(snap, /button "Add a row"/) }, observe: 'diff' });
    const after = ((await ctx.call('snapshot')).page?.snapshot ?? '').split('\n');
    const exact = add.page?.diff ? applyDiff(before, add.page.diff.ops).join('\n') === after.join('\n') : false;
    const added = /\+ .*\[(\w+)\] button "New row action 1"/.exec(add.page?.snapshot ?? '')?.[1];
    const useAdded = added ? await ctx.call('click', { target: { ref: added } }) : undefined;
    // Removing an element: the diff drops its ref from the known set.
    const removeRef = refOf(snap, /button "Remove me"/);
    const removal = await ctx.call('click', { target: { ref: removeRef }, observe: 'diff' });
    const reuse = await ctx.call('click', { target: { ref: removeRef } });
    return outcome(
      'changed: diff; it applies exactly to the earlier outline; the added button is accepted; the removed one is REF_NOT_PRESENTED',
      `${add.page?.changed}; exact ${exact}; added ${added}: ${useAdded?.ok ? 'ok' : useAdded?.error?.code}; removal diff: ${(
        removal.page?.snapshot ?? ''
      )
        .split('\n')
        .filter(l => l.startsWith('-'))
        .join(' ')}; reuse ${reuse.error?.code}`,
      add.page?.changed === 'diff' &&
        exact &&
        !!useAdded?.ok &&
        removal.page?.changed === 'diff' &&
        reuse.error?.code === 'REF_NOT_PRESENTED',
      add.page?.snapshot,
    );
  },
});

// Record context and effect evidence version 2.

const RECORDS = `${FIXTURE_ORIGIN}/d-records.html`;
const deleted = (tabId: number) => evaluate<string[]>(tabId, undefined, 'window.deleted');

defineScenario({
  id: 'D-3.4-reused-row',
  set: 'D',
  title: 'A virtualized list reuses a row for another record',
  covers: 'TARGET_CHANGED on the reused "Delete" button; nothing dispatched',
  async run(ctx) {
    const tabId = await ctx.open(RECORDS);
    const snap = await ctx.call('snapshot');
    const alice = refOf(snap, /button "Delete"/);
    await evaluate(tabId, undefined, `document.getElementById('reuse').click(); 1`);
    const r = await ctx.call('click', { target: { ref: alice } });
    const d = await deleted(tabId);
    return outcome(
      'TARGET_CHANGED naming the new content; nothing deleted',
      `${r.error?.code}: ${r.error?.message}; deleted ${JSON.stringify(d)}`,
      r.error?.code === 'TARGET_CHANGED' && /Bob/.test(r.error.message) && d.length === 0,
    );
  },
});

defineScenario({
  id: 'D-3.4-resort',
  set: 'D',
  title: 'A list re-sorts without reusing nodes',
  covers: 'the ref stays on its node and the action goes to the same record',
  async run(ctx) {
    const tabId = await ctx.open(RECORDS);
    const snap = await ctx.call('snapshot');
    const alice = refOf(snap, /button "Delete"/);
    await evaluate(tabId, undefined, `document.getElementById('sort').click(); 1`);
    const r = await ctx.call('click', { target: { ref: alice } });
    const d = await deleted(tabId);
    return outcome(
      'ok; Alice is deleted although her row moved to the end',
      `${r.ok ? 'ok' : r.error?.code}; deleted ${JSON.stringify(d)}`,
      r.ok && d.join(',') === 'Alice',
    );
  },
});

defineScenario({
  id: 'D-3.4-unattributable',
  set: 'D',
  title: 'A page that changes by itself while an action has no effect',
  covers: 'the verdict is unattributable, not changed',
  async run(ctx) {
    await ctx.open(RECORDS);
    const r = await ctx.call('click', { target: { ref: refOf(await ctx.call('snapshot'), /button "Do nothing"/) } });
    return outcome(
      'verdict unattributable; the page changes by itself',
      `${r.receipt?.effect.verdict}: ${r.receipt?.effect.signals.join(' · ')}`,
      r.receipt?.effect.verdict === 'unattributable',
    );
  },
});

defineScenario({
  id: 'D-3.4-signals-v2',
  set: 'D',
  title: 'Alert text, a new dialog, and focus moving elsewhere',
  covers:
    'effect evidence version 2: new alert or validation text; top-level layer added; focus moved to a different element',
  async run(ctx) {
    await ctx.open(RECORDS);
    const snap = await ctx.call('snapshot');
    const error = await ctx.call('click', { target: { ref: refOf(snap, /button "Show error"/) } });
    const dialog = await ctx.call('click', { target: { ref: refOf(snap, /button "Open dialog"/) } });
    const focus = await ctx.call('click', { target: { ref: refOf(snap, /button "Move focus"/) } });
    const s = (r: Result) => r.receipt?.effect.signals.join(' · ') ?? '';
    return outcome(
      'alert "Something went wrong"; +1 top-level layer: dialog "Confirm removal"; focus → input#next',
      `${s(error)} | ${s(dialog)} | ${s(focus)}`,
      /alert «Something went wrong»/.test(s(error)) &&
        /top-level layer: «dialog "Confirm removal"»/.test(s(dialog)) &&
        /focus → «input#next»/.test(s(focus)),
    );
  },
});

// fill_form.

const FILL = `${FIXTURE_ORIGIN}/d-fill.html`;
const formValues = (tabId: number) =>
  evaluate<Record<string, string | boolean>>(
    tabId,
    undefined,
    `(() => { const f = document.getElementById('signup'); return { name: f.name.value, email: f.email.value, country: f.country.value, notes: f.notes.value, terms: f.terms.checked }; })()`,
  );

defineScenario({
  id: 'D-3.5-fill-stops',
  set: 'D',
  title: '`fill_form` where the third of five fields fails',
  covers:
    'one receipt per field up to the failure; the last two fields are untouched; the submit target is not activated',
  async run(ctx) {
    const tabId = await ctx.open(FILL);
    const snap = await ctx.call('snapshot');
    const r = await ctx.call('fill_form', {
      fields: [
        { target: { ref: refOf(snap, /textbox "Full name"/) }, value: 'Ada Lovelace' },
        { target: { ref: refOf(snap, /textbox "Email"/) }, value: 'ada@example.test' },
        { target: { ref: refOf(snap, /combobox "Country"/) }, value: 'Atlantis' },
        { target: { ref: refOf(snap, /textbox "Notes"/) }, value: 'never written' },
        { target: { ref: refOf(snap, /checkbox "I agree"/) }, value: true },
      ],
      submit: { ref: refOf(snap, /button "Create account"/) },
    });
    const data = r.data as { receipts: unknown[]; failedAt?: number } | undefined;
    const values = await formValues(tabId);
    const submits = await evaluate<unknown[]>(tabId, undefined, 'window.submits');
    return outcome(
      'NO_SUCH_OPTION at field 3; 2 receipts; notes and terms untouched; not submitted',
      `${r.error?.code} (delivered ${r.error?.delivered}): ${r.error?.message}; receipts ${data?.receipts.length}, failedAt ${data?.failedAt}; values ${JSON.stringify(values)}; submits ${submits.length}`,
      r.error?.code === 'NO_SUCH_OPTION' &&
        data?.receipts.length === 2 &&
        data.failedAt === 2 &&
        values.name === 'Ada Lovelace' &&
        values.notes === '' &&
        values.terms === false &&
        submits.length === 0,
    );
  },
});

defineScenario({
  id: 'D-3.5-fill-submits',
  set: 'D',
  title: '`fill_form` sets every field and submits',
  covers: 'fill_form: every field set and read back, then the submit control activated (through the confirmation gate)',
  async run(ctx) {
    const tabId = await ctx.open(FILL);
    const snap = await ctx.call('snapshot');
    const r = await ctx.call('fill_form', {
      fields: [
        { target: { ref: refOf(snap, /textbox "Full name"/) }, value: 'Ada Lovelace' },
        { target: { ref: refOf(snap, /textbox "Email"/) }, value: 'ada@example.test' },
        { target: { ref: refOf(snap, /combobox "Country"/) }, value: 'Japan' },
        { target: { ref: refOf(snap, /textbox "Notes"/) }, value: 'two\nlines' },
        { target: { ref: refOf(snap, /checkbox "I agree"/) }, value: true },
      ],
      submit: { ref: refOf(snap, /button "Create account"/) },
    });
    const data = r.data as { receipts: Array<{ sensitive?: string }>; submitted: boolean } | undefined;
    const submits = await evaluate<Array<Record<string, string>>>(tabId, undefined, 'window.submits');
    return outcome(
      '6 receipts (5 fields and the submit, classified submit and approved); one submission with every value',
      `${r.ok ? 'ok' : r.error?.code}; receipts ${data?.receipts.length}, last ${data?.receipts.at(-1)?.sensitive}; submits ${JSON.stringify(submits)}`,
      r.ok &&
        data?.receipts.length === 6 &&
        data.submitted &&
        submits.length === 1 &&
        submits[0].country === 'jp' &&
        submits[0].terms === 'on',
    );
  },
});

// Robustness: a page nested far deeper than any real one.

defineScenario({
  id: 'D-deep-nesting',
  set: 'D',
  title: 'Elements nested 1,500 levels deep',
  covers:
    'degrade loudly: the snapshot works and says what it cut; the shallow button and the deep one found by the layout snapshot both act',
  async run(ctx) {
    const tabId = await ctx.open(`${FIXTURE_ORIGIN}/d-deep.html?depth=1500`);
    await evaluate(
      tabId,
      undefined,
      `window.clicks = []; document.addEventListener('click', e => window.clicks.push(e.target.id)); 1`,
    );
    const snap = await ctx.call('snapshot', { window: 'page' });
    if (!snap.ok) return outcome('a snapshot', `${snap.error?.code}: ${snap.error?.message}`, false);
    const notice = /nested deeper than 256 levels/.test(snap.text);
    const top = await ctx.call('click', { target: { ref: refOf(snap, /button "Top button"/) } });
    const bottom = await ctx.call('click', { target: { ref: refOf(snap, /clickable "Bottom button"/) } });
    const clicks = await evaluate<string[]>(tabId, undefined, 'window.clicks');
    return outcome(
      'snapshot ok with a depth notice; both buttons click',
      `notice ${notice}; top ${top.ok ? 'ok' : top.error?.code}; bottom ${bottom.ok ? 'ok' : `${bottom.error?.code} ${bottom.error?.message}`}; clicks ${JSON.stringify(clicks)}`,
      notice && top.ok && bottom.ok && clicks.join(',') === 'top,bottom',
    );
  },
});
