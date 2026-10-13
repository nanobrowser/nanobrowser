// Scenarios for a payment frame hidden from the outline. L7-hidden-frame-notice checks that a captured frame that
// cannot be placed is reported; outline.test.ts covers it with a recorded capture as well. L7-focused-secret-key checks
// a suspected leak that did not reproduce; probe.test.ts covers the fallback name it was about.
import type { AuditEntry, Result, SnapshotData } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { evaluate, sleep } from '../checks/helpers';
import { layer } from '../layer';
import type { OpenPrompt, Responder } from '../prompts';
import { withUser } from './set-c-confirm';
import { defineScenario, outcome } from './registry';

const PAGE = `${FIXTURE_ORIGIN}/d-hidden-payment-frame.html`;
const FRAME_CARD = '5555555555554444';
const err = (r: Result) => (r.ok ? 'ok' : `${r.error?.code}`);
const read = <T>(tabId: number, expression: string) => evaluate<T>(tabId, undefined, expression);

defineScenario({
  id: 'L7-hidden-frame-notice',
  set: 'D',
  title: 'snapshot a page whose aria-hidden region holds a captured payment frame, then the same page with it shown',
  covers: 'a captured frame that cannot be placed is reported, and the outline is partial',
  async run(ctx) {
    const tabId = await ctx.open(PAGE);
    await sleep(300);
    const hidden = (await ctx.call('snapshot')) as Result<SnapshotData>;
    await read(tabId, `document.getElementById('background').removeAttribute('aria-hidden'); 1`);
    const shown = (await ctx.call('snapshot')) as Result<SnapshotData>;
    const notice = (r: Result<SnapshotData>) => (r.data?.notices ?? []).filter(n => /could not be placed/.test(n));
    const frameLines = (r: Result<SnapshotData>) =>
      (r.page?.snapshot ?? '').split('\n').filter(l => /textbox "Card number"/.test(l)).length;
    const leaked = [hidden, shown].filter(r => JSON.stringify(r).includes(FRAME_CARD)).length;
    return outcome(
      'hidden: partial, one notice that the frame is not shown; shown: complete, the frame’s field listed; no card number',
      `hidden ${hidden.data?.status}, frames ${JSON.stringify(hidden.data?.frames)}, notice "${notice(hidden).join(' | ')}"; shown ${shown.data?.status}, notices ${notice(shown).length}, frame field ${frameLines(shown)}; leaks ${leaked}`,
      hidden.data?.status === 'partial' &&
        hidden.data.frames.captured === 2 &&
        notice(hidden).length === 1 &&
        frameLines(hidden) === 0 &&
        shown.data?.status === 'complete' &&
        notice(shown).length === 0 &&
        frameLines(shown) === 1 &&
        leaked === 0,
    );
  },
});

/** Fixture values for the secret fields, set by script; they are counted in results, never printed. */
const SECRETS: Record<string, string> = {
  pw: 'Hx7-unicorn-Quartz',
  'pw-bare': 'Bq2-lantern-Violet',
  card: '4111111111111111',
  otp: '654321',
};
/** Ways a page can leave a focused field out of the accessibility tree, or not. */
const VARIANTS: Record<string, string> = {
  plain: '',
  'aria-hidden': `el.setAttribute('aria-hidden', 'true');`,
  'aria-hidden region': `el.parentElement.closest('p').setAttribute('aria-hidden', 'true');`,
  'aria-modal elsewhere': `document.getElementById('modal').hidden = false;`,
  'role none': `el.setAttribute('role', 'none');`,
  // The same fields in a same-origin frame inside the aria-hidden region (the frame is added by the scenario).
  'frame in aria-hidden region': '',
};
const FRAMED = 'frame in aria-hidden region';
/** The same form, in a frame the scenario adds to the aria-hidden region. */
const ADD_FRAME = `(() => {
  const frame = document.createElement('iframe');
  frame.id = 'inner-frame';
  frame.style.cssText = 'width: 360px; height: 200px';
  frame.srcdoc = '<form onsubmit="return false"><p><label>Password <input type="password" id="pw"></label></p>' +
    '<p><input type="password" id="pw-bare"></p><p><input id="card" autocomplete="cc-number"></p>' +
    '<p><input id="otp" autocomplete="one-time-code"></p><button type="submit">Sign in</button></form>';
  document.getElementById('background').append(frame);
  return 1;
})()`;

const leaksIn = (value: unknown) => {
  const json = JSON.stringify(value);
  return Object.values(SECRETS).filter(s => json.includes(s)).length;
};

/** Sets up one field and variant: every field emptied and shown, then this one filled, hidden as asked, focused. */
const prepare = (field: string, variant: string) => `(() => {
  const frameDoc = document.getElementById('inner-frame').contentDocument;
  for (const doc of [document, frameDoc]) {
    for (const p of doc.querySelectorAll('form p')) p.removeAttribute('aria-hidden');
    for (const input of doc.querySelectorAll('form input')) {
      input.removeAttribute('aria-hidden');
      input.removeAttribute('role');
      input.value = '';
    }
  }
  document.getElementById('modal').hidden = true;
  const root = ${variant === FRAMED ? 'frameDoc' : 'document'};
  const el = root.getElementById(${JSON.stringify(field)});
  el.value = ${JSON.stringify(SECRETS[field])};
  ${VARIANTS[variant]}
  el.focus();
  return root.activeElement === el;
})()`;

defineScenario({
  id: 'L7-focused-secret-key',
  set: 'C',
  title:
    'press Enter and Space with no target on a focused filled password, card and code field, hidden from accessibility in five ways',
  covers: 'a focused field is never named by its value in a prompt, result or the audit',
  async run(ctx) {
    const { controller } = await layer();
    const tabId = await ctx.open(PAGE);
    await read(tabId, ADD_FRAME);
    await sleep(300);
    const entries: AuditEntry[] = [];
    const off = controller.onAudit(e => entries.push(e));
    // Every key prompts, so the prompt shows how the focused field was described; Enter is approved and sent,
    // Space is declined.
    const respond: Responder = (p, a) =>
      void a(p.kind === 'confirm' && /Enter/.test(p.request.action) ? 'approve' : 'decline');
    ctx.session.setConfirmPolicy('always');
    const rows: string[] = [];
    let total = 0;
    let approximated = 0;
    let unfocused = 0;
    try {
      await withUser(respond, async seen => {
        for (const variant of Object.keys(VARIANTS)) {
          for (const field of Object.keys(SECRETS)) {
            const results: Result[] = [];
            const prompts: OpenPrompt[] = [];
            const before = entries.length;
            for (const keys of ['Enter', 'Space']) {
              if (!(await read<boolean>(tabId, prepare(field, variant)))) unfocused++;
              const from = seen.length;
              results.push(await ctx.call('press', { keys }));
              prompts.push(...seen.slice(from));
            }
            // How the gate described the field: by Chrome's role ("textbox") or by the probe's fallback ("input").
            const roles = prompts.map(p =>
              p.kind === 'confirm' ? /^the focused (\S+)/.exec(p.request.target)?.[1] : '',
            );
            if (roles.includes('input')) approximated++;
            const leaks = leaksIn(results) + leaksIn(prompts) + leaksIn(entries.slice(before));
            total += leaks;
            rows.push(`${variant}/${field}: ${roles.join(',')} ${results.map(err).join(',')} leaks ${leaks}`);
          }
        }
      });
    } finally {
      ctx.session.setConfirmPolicy('sensitive');
      off();
    }
    return outcome(
      'no field value in any result, prompt or audit entry, whether Chrome or the probe’s fallback names the field',
      `${approximated} of ${rows.length} fields named by the fallback; ${unfocused} not focused; leaks ${total}; ${rows.join('; ')}`,
      total === 0 && unfocused === 0,
    );
  },
});
