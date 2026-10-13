// Scenarios for masking in places that are easy to miss: controls found only by layout, frames that cannot be placed,
// selects in evidence, error messages and record contexts. Each reproduces a reported case and checks it is closed.
// Readiness listeners after a failed navigation are a unit test: controller.test.ts.
import type { AuditEntry, Result, ScreenshotData } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { evaluate, sleep } from '../checks/helpers';
import { layer } from '../layer';
import { defineScenario, outcome } from './registry';
import type { ScenarioContext } from './registry';
import { refOf } from './set-c';
import { coloursIn } from './masked-requests-and-screenshots';
import type { Box } from './masked-requests-and-screenshots';

const PAGE = `${FIXTURE_ORIGIN}/d-masked-hidden-regions.html`;
const CODE = '654321';

async function openPage(ctx: ScenarioContext): Promise<{ tabId: number; snap: Result }> {
  const tabId = await ctx.open(PAGE);
  return { tabId, snap: await ctx.call('snapshot') };
}

const read = <T>(tabId: number, expression: string) => evaluate<T>(tabId, undefined, expression);
const err = (r: Result) => (r.ok ? 'ok' : `${r.error?.code}/${r.error?.delivered}`);
/** Runs of 12 or more digits (spaces and dashes allowed between them): most of a card number. */
const digitRuns = (value: unknown) => (JSON.stringify(value).match(/\d(?:[\s-]?\d){11,}/g) ?? []).length;
/** Card numbers and the one-time code of the fixture, counted, never printed. */
const leaks = (value: unknown) => digitRuns(value) + (JSON.stringify(value).includes(CODE) ? 1 : 0);

/** Runs `run` with the audit recorded; returns its value and the entries. */
async function audited<T>(run: () => Promise<T>): Promise<{ value: T; entries: AuditEntry[] }> {
  const { controller } = await layer();
  const entries: AuditEntry[] = [];
  const off = controller.onAudit(e => entries.push(e));
  try {
    return { value: await run(), entries };
  } finally {
    off();
  }
}

defineScenario({
  id: 'L3-layout-names',
  set: 'D',
  title: 'snapshot, find and read a page whose aria-hidden region holds a textarea with a code and a card select',
  covers: 'a control found only by layout is not named by its own content',
  async run(ctx) {
    const { snap } = await openPage(ctx);
    const all = await ctx.call('snapshot', { window: 'page', mode: 'all' });
    const boxes = await ctx.call('find', { role: 'textbox' });
    const selects = await ctx.call('find', { role: 'combobox' });
    const content = await ctx.call('read', {});
    const listed = (snap.page?.snapshot ?? '')
      .split('\n')
      .filter(l => /textbox "Notes"|combobox "Saved card"/.test(l)).length;
    const counts = [snap, all, boxes, selects, content].map(leaks);
    return outcome(
      'both controls listed by their labels; no code or card number in any result',
      `listed by label ${listed}; leaks per result ${counts.join(', ')}`,
      listed === 2 && counts.every(c => c === 0),
    );
  },
});

defineScenario({
  id: 'L3-screenshot-hidden-frame',
  set: 'D',
  title: 'screenshot a page whose aria-hidden region holds a cross-site frame with a filled card field',
  covers: 'a frame that cannot be placed in the outline is blanked in images',
  async run(ctx) {
    const { tabId } = await openPage(ctx);
    await sleep(300);
    const frame = await read<Box>(
      tabId,
      `(() => { const r = document.getElementById('pay-frame').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
    );
    const shot = (await ctx.call('screenshot', {})) as Result<ScreenshotData>;
    if (!shot.data) return outcome('an image', err(shot), false);
    const colours = await coloursIn(shot.data, { x: frame.x + 4, y: frame.y + 4, width: 240, height: 28 });
    return outcome('the frame’s card field is one flat colour in the image', `${colours} colours`, colours === 1);
  },
});

defineScenario({
  id: 'L3-evidence-description',
  set: 'D',
  title: 'set a card select (masked options) in a form whose change handler writes validation text into the form',
  covers: 'block descriptions in evidence do not quote the text of selects',
  async run(ctx) {
    const { value: r, entries } = await audited(async () => {
      const { snap } = await openPage(ctx);
      return ctx.call('set', { target: { ref: refOf(snap, /combobox "Pay with"/) }, value: 'c1' });
    });
    const signals = r.receipt?.effect.signals ?? [];
    const mutation = signals.some(s => /mutation/.test(s));
    return outcome(
      'a mutation signal for the form; no card number in the result or the audit',
      `${err(r)}; mutation signal ${mutation}; leaks in result ${leaks(r)}, in audit ${leaks(entries)}`,
      r.ok && mutation && leaks(r) === 0 && leaks(entries) === 0,
    );
  },
});

defineScenario({
  id: 'L3-ambiguous-cards',
  set: 'D',
  title: 'set two card numbers (option values) on a single select with no sensitive attributes',
  covers: 'the AMBIGUOUS_OPTION error masks a requested card number',
  async run(ctx) {
    const { value: r, entries } = await audited(async () => {
      const { snap } = await openPage(ctx);
      return ctx.call('set', {
        target: { ref: refOf(snap, /combobox "Payment method"/) },
        value: ['4111111111111111', '5555555555554444'],
      });
    });
    return outcome(
      'AMBIGUOUS_OPTION; no card number in the result or the audit',
      `${err(r)}; leaks in result ${leaks(r)}, in audit ${leaks(entries)}`,
      r.error?.code === 'AMBIGUOUS_OPTION' && leaks(r) === 0 && leaks(entries) === 0,
    );
  },
});

defineScenario({
  id: 'L3-record-context-message',
  set: 'D',
  title: 'snapshot, change the status text of a list item that holds a card select, then click its "Use" button',
  covers: 'a changed record context is reported without quoting its content',
  async run(ctx) {
    const { value, entries } = await audited(async () => {
      const { tabId, snap } = await openPage(ctx);
      await read(tabId, `document.getElementById('rec-status').textContent = 'Expired'`);
      const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Use"/) } });
      return { r, used: await read<number>(tabId, 'window.used') };
    });
    const { r, used } = value;
    return outcome(
      'TARGET_CHANGED, nothing clicked; no card number in the result or the audit',
      `${err(r)}; used ${used}; leaks in result ${leaks(r)}, in audit ${leaks(entries)}`,
      r.error?.code === 'TARGET_CHANGED' && used === 0 && leaks(r) === 0 && leaks(entries) === 0,
    );
  },
});
