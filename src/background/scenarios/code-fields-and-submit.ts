// Scenarios for code fields (which are masked and which are not) and the expectation and read-back of fill_form.
// Each reproduces a reported case and checks it is closed. A ref of an unshared tab attaching to it again is a unit
// test: controller.test.ts.
import type { ActionReceipt, AuditEntry, Result } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { evaluate } from '../checks/helpers';
import { layer } from '../layer';
import { defineScenario, outcome } from './registry';
import type { ScenarioContext } from './registry';
import { refOf } from './set-c';

const PAGE = `${FIXTURE_ORIGIN}/d-code-fields-and-submit.html`;
/** The codes the user typed into the five code fields, by field id; counted in results, never printed. */
const CODES: Record<string, string> = { vc: '482913', ac: '573024', mc: '619135', vf: '730246', op: '841357' };
const NEW_CODE = '902468';
/** Ordinary code fields: their values are printed. */
const PLAIN: Record<string, string> = { promo: 'SAVE10', zip: '94107', postal: 'SW1A 1AA' };

async function openPage(ctx: ScenarioContext): Promise<{ tabId: number; snap: Result }> {
  const tabId = await ctx.open(PAGE);
  return { tabId, snap: await ctx.call('snapshot') };
}

const read = <T>(tabId: number, expression: string) => evaluate<T>(tabId, undefined, expression);
const err = (r: Result) => (r.ok ? 'ok' : `${r.error?.code}/${r.error?.delivered}`);
/** How many of the codes appear in a value. */
const leaks = (value: unknown) => {
  const json = JSON.stringify(value);
  return [...Object.values(CODES), NEW_CODE].filter(code => json.includes(code)).length;
};

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

/** Types values into fields as a user would leave them: value set, input and change fired. */
function fillAsUser(tabId: number, values: Record<string, string>) {
  return read(
    tabId,
    `(() => { for (const [id, v] of Object.entries(${JSON.stringify(values)})) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } })()`,
  );
}

defineScenario({
  id: 'L4-code-fields',
  set: 'D',
  title: 'snapshot, find, read and set verification, authentication and MFA code fields without autocomplete',
  covers: 'code fields named or labelled as such are masked; promo and postal codes are not',
  async run(ctx) {
    const { value, entries } = await audited(async () => {
      const { tabId, snap } = await openPage(ctx);
      const field = refOf(snap, /textbox "Verification code"/);
      await fillAsUser(tabId, { ...CODES, ...PLAIN });
      const shown = await ctx.call('snapshot', { window: 'page', mode: 'all' });
      const found = await ctx.call('find', { role: 'textbox' });
      const content = await ctx.call('read', {});
      const set = await ctx.call('set', { target: { ref: field }, value: NEW_CODE });
      return { shown, found, content, set };
    });
    const { shown, found, content, set } = value;
    const plain = Object.values(PLAIN).filter(v => (shown.page?.snapshot ?? '').includes(`"${v}"`)).length;
    const counts = [shown, found, content, set, entries].map(leaks);
    return outcome(
      'set ok; no code in any result or the audit; promo, zip and postal values printed',
      `set ${err(set)}; leaks per result ${counts.join(', ')}; plain values printed ${plain} of 3`,
      set.ok && counts.every(c => c === 0) && plain === 3,
    );
  },
});

defineScenario({
  id: 'L4-fill-form-expect',
  set: 'D',
  title: 'fill_form with a submit control and expect {url: "/welcome"} on a form that stays on the page',
  covers: 'the expectation of fill_form is checked and reported',
  async run(ctx) {
    const { tabId, snap } = await openPage(ctx);
    const r = await ctx.call('fill_form', {
      fields: [{ target: { ref: refOf(snap, /textbox "Email"/) }, value: 'ada@example.test' }],
      submit: { ref: refOf(snap, /button "Create account"/) },
      expect: { url: '/welcome' },
    });
    const receipts = (r.data as { receipts?: ActionReceipt[] } | undefined)?.receipts ?? [];
    const last = receipts[receipts.length - 1];
    const signups = await read<number>(tabId, 'window.signups');
    return outcome(
      'submitted once; the submit receipt reports the expectation unmet',
      `${err(r)}; signups ${signups}; last receipt ${last?.action} expect ${last?.postcondition?.status ?? 'none'}`,
      r.ok && signups === 1 && last?.action === 'click' && last.postcondition?.status === 'unmet',
    );
  },
});

defineScenario({
  id: 'L4-submit-readback',
  set: 'D',
  title: 'set a search field with submit: true; the form navigates to another page',
  covers: 'a read-back that cannot be made is not_checked, not a mismatch',
  async run(ctx) {
    const { snap } = await openPage(ctx);
    const r = await ctx.call('set', { target: { ref: refOf(snap, /textbox "Search"/) }, value: 'shoes', submit: true });
    const p = r.receipt?.postcondition;
    return outcome(
      'ok; navigated; the read-back is not_checked',
      `${err(r)}; navigation ${r.receipt?.navigation ? 'yes' : 'no'}; read-back ${p?.status} (${p?.detail})`,
      r.ok && !!r.receipt?.navigation && p?.status === 'not_checked',
    );
  },
});
