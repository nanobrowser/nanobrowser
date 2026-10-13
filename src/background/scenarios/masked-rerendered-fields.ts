// Scenarios for masked fields in images and read-backs, and controls in a disabled fieldset's legend. Each reproduces
// a reported case and checks it is closed. Release during attach is a unit test: controller.test.ts.
import type { AuditEntry, Result, ScreenshotData } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { evaluate, sleep } from '../checks/helpers';
import { layer } from '../layer';
import { defineScenario, outcome } from './registry';
import type { ScenarioContext } from './registry';
import { refOf } from './set-c';
import { coloursIn } from './masked-requests-and-screenshots';
import type { Box } from './masked-requests-and-screenshots';

const PAGE = `${FIXTURE_ORIGIN}/d-masked-rerendered-fields.html`;
const CARD = '4111 1111 1111 1111';

async function openPage(ctx: ScenarioContext): Promise<{ tabId: number; snap: Result }> {
  const tabId = await ctx.open(PAGE);
  return { tabId, snap: await ctx.call('snapshot') };
}

const read = <T>(tabId: number, expression: string) => evaluate<T>(tabId, undefined, expression);
const err = (r: Result) => (r.ok ? 'ok' : `${r.error?.code}/${r.error?.delivered}: ${r.error?.message}`);
const boxOf = (tabId: number, id: string) =>
  read<Box>(
    tabId,
    `(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
  );
/** Runs of 12 or more digits (spaces and dashes allowed between them): most of a card number. */
const digitRuns = (value: unknown) => (JSON.stringify(value).match(/\d(?:[\s-]?\d){11,}/g) ?? []).length;

defineScenario({
  id: 'L2-screenshot-rerendered',
  set: 'D',
  title: 'snapshot, then the page replaces its filled card field with a new element, then screenshot',
  covers: 'a masked field whose box cannot be found fails the image closed',
  async run(ctx) {
    const { tabId } = await openPage(ctx);
    await read(tabId, 'window.rerender()');
    const box = await boxOf(tabId, 'live-card');
    const first = (await ctx.call('screenshot', {})) as Result<ScreenshotData>;
    const firstColours = first.data ? await coloursIn(first.data, box) : 0;
    const again = (await ctx.call('screenshot', {})) as Result<ScreenshotData>;
    const againColours = again.data ? await coloursIn(again.data, box) : 0;
    return outcome(
      'the first image is CAPTURE_FAILED or blanks the card; a second screenshot returns it blanked',
      `first ${first.ok ? `ok, ${firstColours} colours` : err(first)}; again ${again.ok ? `ok, ${againColours} colours` : err(again)}`,
      (first.error?.code === 'CAPTURE_FAILED' || firstColours === 1) && againColours === 1,
    );
  },
});

defineScenario({
  id: 'L2-screenshot-aria-hidden',
  set: 'D',
  title: 'screenshot a page with a filled cc-number field inside an aria-hidden region (a page behind a modal)',
  covers: 'field values of controls recovered from layout are blanked in images',
  async run(ctx) {
    const { tabId, snap } = await openPage(ctx);
    await sleep(200);
    const box = await boxOf(tabId, 'hidden-card');
    const shot = (await ctx.call('screenshot', {})) as Result<ScreenshotData>;
    if (!shot.data) return outcome('an image', err(shot), false);
    const colours = await coloursIn(shot.data, box);
    const listed = snap.text.split('\n').filter(l => /textbox "Saved card"|#hidden-card/.test(l)).length;
    return outcome(
      'the field (listed from layout) is one flat colour in the image',
      `${colours} colours in its box; listed ${listed}`,
      colours === 1,
    );
  },
});

defineScenario({
  id: 'L2-set-card-rejected',
  set: 'D',
  title: 'set a card number into a field labelled "Card" (no autocomplete) whose page clears anything but digits',
  covers: 'the read-back of a requested card number is masked even when the field is not',
  async run(ctx) {
    const { controller } = await layer();
    const entries: AuditEntry[] = [];
    const off = controller.onAudit(e => entries.push(e));
    try {
      const { tabId, snap } = await openPage(ctx);
      const r = await ctx.call('set', { target: { ref: refOf(snap, /textbox "Card"/) }, value: CARD });
      const value = await read<string>(tabId, `document.getElementById('plain-card').value`);
      const post = r.receipt?.postcondition;
      return outcome(
        'the page cleared the field; postcondition unmet; no card digits in the result or the audit',
        `field "${value}"; postcondition ${post?.status} (${post?.detail}); digit runs in result ${digitRuns(r)}, in audit ${digitRuns(entries)}`,
        value === '' && post?.status === 'unmet' && digitRuns(r) === 0 && digitRuns(entries) === 0,
      );
    } finally {
      off();
    }
  },
});

defineScenario({
  id: 'L2-fieldset-legend',
  set: 'C',
  title: 'click the checkbox in the first legend of a disabled fieldset',
  covers: 'a control in a disabled fieldset’s first legend is enabled',
  async run(ctx) {
    const { tabId, snap } = await openPage(ctx);
    const r = await ctx.call('click', { target: { ref: refOf(snap, /checkbox "Edit these settings"/) } });
    const checked = await read<boolean>(tabId, `document.getElementById('unlock').checked`);
    return outcome(
      'the click is dispatched and the checkbox is checked',
      `${err(r)}; checked ${checked}`,
      r.ok && checked,
    );
  },
});
