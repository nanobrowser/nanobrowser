// Fixture set C: the confirmation gate. The user is scripted.
import type { ConfirmPolicy, Result } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { evaluate, sleep } from '../checks/helpers';
import { layer } from '../layer';
import { answer, setResponder } from '../prompts';
import type { OpenPrompt, Responder } from '../prompts';
import { defineScenario, outcome } from './registry';
import type { ScenarioContext } from './registry';
import { refOf } from './set-c';

const PAGE = `${FIXTURE_ORIGIN}/c-sensitive.html`;

/** Runs fn with a scripted user, recording every prompt shown. */
export async function withUser<T>(respond: Responder, fn: (seen: OpenPrompt[]) => Promise<T>): Promise<T> {
  const seen: OpenPrompt[] = [];
  const previous = setResponder((p, a) => {
    seen.push(p);
    respond(p, a);
  });
  try {
    return await fn(seen);
  } finally {
    setResponder(previous);
  }
}

export const approve: Responder = (_p, a) => void a('approve');
export const decline: Responder = (_p, a) => void a('decline');
/**
 * Approves only a plain field's own Enter, which is a submit (Enter in a text field with no form), and declines
 * anything else: scenarios about the key guard need that Enter to go ahead so the guard is what stops it.
 */
export const approveFieldEnter: Responder = (p, a) =>
  void a(p.kind === 'confirm' && /Enter in a text field with no form/.test(p.request.reason) ? 'approve' : 'decline');

async function open(ctx: ScenarioContext): Promise<{ tabId: number; snap: Result }> {
  const tabId = await ctx.open(PAGE);
  return { tabId, snap: await ctx.call('snapshot') };
}

const clicks = (tabId: number) => evaluate<Record<string, number>>(tabId, undefined, 'window.clicks');
const submits = (tabId: number) => evaluate<string[]>(tabId, undefined, 'window.submits');

defineScenario({
  id: 'C-2.8-delete-declined',
  set: 'C',
  title: 'A "Delete" button; the scripted user declines',
  covers: 'USER_DECLINED; the click handler never fires',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await open(ctx);
      const r = await ctx.call('click', {
        target: { ref: refOf(snap, /button "Delete"/) },
        intent: 'Delete invoice INV-1042',
      });
      const c = await clicks(tabId);
      const p = seen[0]?.kind === 'confirm' ? seen[0].request : undefined;
      return outcome(
        'one prompt for delete naming the row and the intent; USER_DECLINED, delivered false; no click',
        `prompt ${p?.category}: ${p?.target} (${p?.intent}); ${r.error?.code}/${r.error?.delivered}; clicks ${JSON.stringify(c)}`,
        seen.length === 1 &&
          p?.category === 'delete' &&
          /in row «INV-1042/.test(p.target) &&
          r.error?.code === 'USER_DECLINED' &&
          r.error.delivered === false &&
          Object.keys(c).length === 0,
      );
    });
  },
});

defineScenario({
  id: 'C-2.8-delete-approved',
  set: 'C',
  title: 'An approved delete is dispatched once and recorded',
  covers: 'approved, revalidated, dispatched; the receipt records the category and the approval',
  async run(ctx) {
    return withUser(approve, async seen => {
      const { tabId, snap } = await open(ctx);
      const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Delete"/) } });
      const c = await clicks(tabId);
      return outcome(
        'ok; receipt sensitive delete, confirmedByUser; exactly one click',
        `${r.ok ? 'ok' : r.error?.code}; ${r.receipt?.sensitive}/${r.receipt?.confirmedByUser}; ${r.text.split('\n')[0]}; clicks ${JSON.stringify(c)}`,
        r.ok &&
          seen.length === 1 &&
          r.receipt?.sensitive === 'delete' &&
          r.receipt.confirmedByUser === true &&
          c['row-delete:1042'] === 1,
      );
    });
  },
});

defineScenario({
  id: 'C-2.8-pay-rerendered',
  set: 'C',
  title: 'A "Pay now" button; the user approves after the row re-rendered',
  covers: 'revalidation runs again after approval; the action reaches the right node or fails closed',
  async run(ctx) {
    const { tabId, snap } = await open(ctx);
    return withUser(
      (_p, a) => {
        void evaluate(tabId, undefined, 'window.rerenderPay(); 1').then(() => setTimeout(() => a('approve'), 50));
      },
      async seen => {
        const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Pay now"/) } });
        const c = await clicks(tabId);
        return outcome(
          'prompted for pay; after approval the old node is gone: NODE_DETACHED, nothing dispatched',
          `prompt ${seen[0]?.kind === 'confirm' ? seen[0].request.category : 'none'}; ${r.error?.code}/${r.error?.delivered}; clicks ${JSON.stringify(c)}`,
          seen[0]?.kind === 'confirm' &&
            seen[0].request.category === 'pay' &&
            r.error?.code === 'NODE_DETACHED' &&
            !c.pay,
        );
      },
    );
  },
});

defineScenario({
  id: 'C-2.8-enter-checkout',
  set: 'C',
  title: 'Enter pressed in a field of a checkout form',
  covers: 'classified through the form’s submit control; confirmation requested',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await open(ctx);
      const r = await ctx.call('press', { keys: 'Enter', target: { ref: refOf(snap, /textbox "Card holder"/) } });
      const s = await submits(tabId);
      const p = seen[0]?.kind === 'confirm' ? seen[0].request : undefined;
      return outcome(
        'pay (through "Place order"); declined; nothing submitted',
        `${p?.category}: ${p?.reason}; ${r.error?.code}; submits ${JSON.stringify(s)}`,
        p?.category === 'pay' && r.error?.code === 'USER_DECLINED' && s.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'C-2.8-form-attribute',
  set: 'C',
  title: 'A neutrally labelled submit button outside its form, tied to it with a form attribute',
  covers: 'classified as submit; confirmation requested',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await open(ctx);
      const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Continue"/) } });
      const s = await submits(tabId);
      const p = seen[0]?.kind === 'confirm' ? seen[0].request : undefined;
      return outcome(
        'submit; declined; nothing submitted',
        `${p?.category}: ${p?.reason}; ${r.error?.code}; submits ${JSON.stringify(s)}`,
        p?.category === 'submit' && r.error?.code === 'USER_DECLINED' && s.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'C-2.8-single-field-post',
  set: 'C',
  title: 'Enter in a single-field POST form with no submit button',
  covers: 'classified as submit; confirmation requested',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await open(ctx);
      const r = await ctx.call('set', {
        target: { ref: refOf(snap, /textbox "Quick note"/) },
        value: 'hello',
        submit: true,
      });
      const s = await submits(tabId);
      const p = seen[0]?.kind === 'confirm' ? seen[0].request : undefined;
      return outcome(
        'submit; declined before anything was typed; nothing submitted',
        `${p?.category}: ${p?.reason}; ${r.error?.code}; submits ${JSON.stringify(s)}`,
        p?.category === 'submit' && r.error?.code === 'USER_DECLINED' && s.length === 0,
      );
    });
  },
});

defineScenario({
  id: 'C-2.8-search-form',
  set: 'C',
  title: 'A site search form',
  covers: 'not classified as submit; no prompt',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await open(ctx);
      const r = await ctx.call('set', {
        target: { ref: refOf(snap, /searchbox "Search site"/) },
        value: 'invoices',
        submit: true,
      });
      await sleep(100);
      const s = await submits(tabId);
      return outcome(
        'no prompt; the search is submitted',
        `${seen.length} prompts; ${r.ok ? 'ok' : r.error?.code}; submits ${JSON.stringify(s)}`,
        seen.length === 0 && r.ok && s.includes('search'),
      );
    });
  },
});

defineScenario({
  id: 'C-2.8-no-prompt',
  set: 'C',
  title: 'No UserPrompt registered, sensitive target',
  covers: 'NEEDS_USER; nothing dispatched',
  async run(ctx) {
    const { controller } = await layer();
    const saved = controller.host.prompt;
    controller.host.prompt = undefined;
    try {
      const { tabId, snap } = await open(ctx);
      const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Delete"/) } });
      const ordinary = await ctx.call('click', { target: { ref: refOf(snap, /button "Show details"/) } });
      const c = await clicks(tabId);
      return outcome(
        'NEEDS_USER for Delete; an ordinary button still works',
        `${r.error?.code}; ordinary ${ordinary.ok ? 'ok' : ordinary.error?.code}; clicks ${JSON.stringify(c)}`,
        r.error?.code === 'NEEDS_USER' && ordinary.ok && !c['row-delete:1042'] && c.details === 1,
      );
    } finally {
      controller.host.prompt = saved;
    }
  },
});

defineScenario({
  id: 'C-2.8-press-focused',
  set: 'C',
  title: '`press` Enter with no target while a "Delete" button has focus',
  covers: 'classified as delete; confirmation requested',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId } = await open(ctx);
      await evaluate(tabId, undefined, `document.getElementById('focus-delete').focus(); 1`);
      const r = await ctx.call('press', { keys: 'Enter' });
      const c = await clicks(tabId);
      const p = seen[0]?.kind === 'confirm' ? seen[0].request : undefined;
      return outcome(
        'delete prompt naming the focused button; declined; no click',
        `${p?.category}: ${p?.target}; ${r.error?.code}; clicks ${JSON.stringify(c)}`,
        p?.category === 'delete' &&
          /Delete draft/.test(p.target) &&
          r.error?.code === 'USER_DECLINED' &&
          !c['focus-delete'],
      );
    });
  },
});

defineScenario({
  id: 'C-2.8-money-confirm',
  set: 'C',
  title: 'A generic "Confirm" next to a money amount',
  covers: 'a generic confirm label next to a money amount is pay',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { snap } = await open(ctx);
      const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Confirm"/) } });
      const p = seen[0]?.kind === 'confirm' ? seen[0].request : undefined;
      return outcome(
        'pay, because of $15.00',
        `${p?.category}: ${p?.reason}; ${r.error?.code}`,
        p?.category === 'pay' && /\$15\.00/.test(p.reason),
      );
    });
  },
});

defineScenario({
  id: 'C-2.8-timeout-withdrawn',
  set: 'C',
  title: 'The user does not answer; a late answer has no effect',
  covers: 'CONFIRMATION_TIMEOUT; the prompt is withdrawn',
  async run(ctx) {
    const timeout = ctx.session.config.confirmTimeoutMs;
    ctx.session.config.confirmTimeoutMs = 600;
    try {
      let late: boolean | undefined;
      const r = await withUser(
        (p, a) => {
          setTimeout(() => (late = a('approve')), 1000);
          void p;
        },
        async () => {
          const { snap } = await open(ctx);
          const result = await ctx.call('click', { target: { ref: refOf(snap, /button "Delete"/) } });
          await sleep(700);
          return result;
        },
      );
      const tabId = ctx.session.activeTabId!;
      const c = await clicks(tabId);
      return outcome(
        'CONFIRMATION_TIMEOUT; the late approval is refused; no click',
        `${r.error?.code}; late answer accepted: ${late}; clicks ${JSON.stringify(c)}`,
        r.error?.code === 'CONFIRMATION_TIMEOUT' && late === false && !c['row-delete:1042'],
      );
    } finally {
      ctx.session.config.confirmTimeoutMs = timeout;
    }
  },
});

defineScenario({
  id: 'C-2.8-modal-pending',
  set: 'C',
  title: 'Other actions on the tab wait for the user',
  covers: 'while the prompt is open, other actions on the tab return MODAL_PENDING',
  async run(ctx) {
    let pending: string | undefined;
    const { snap } = await open(ctx);
    const r = await withUser(
      (p, a) => {
        void ctx.call('click', { target: { ref: refOf(snap, /button "Show details"/) } }).then(other => {
          pending = other.error?.code;
          a('decline');
        });
        void p;
      },
      () => ctx.call('click', { target: { ref: refOf(snap, /button "Delete"/) } }),
    );
    return outcome(
      'the second action is MODAL_PENDING; the first is declined',
      `${pending}; ${r.error?.code}`,
      pending === 'MODAL_PENDING' && r.error?.code === 'USER_DECLINED',
    );
  },
});

defineScenario({
  id: 'C-2.8-remember-submit',
  set: 'C',
  title: '"Do not ask again on this site" for submit only',
  covers: 'remember for submit within the session; always ask for pay and delete',
  async run(ctx) {
    return withUser(
      (p, a) => void a(p.kind === 'confirm' && p.request.canRemember ? 'approve-remember' : 'decline'),
      async seen => {
        const { snap } = await open(ctx);
        const first = await ctx.call('click', { target: { ref: refOf(snap, /button "Continue"/) } });
        const second = await ctx.call('click', { target: { ref: refOf(snap, /button "Continue"/) } });
        const del = await ctx.call('click', { target: { ref: refOf(snap, /button "Delete"/) } });
        ctx.session.rememberedSubmitOrigins.clear();
        return outcome(
          'first submit prompts and is remembered; the second does not prompt; delete still prompts',
          `prompts ${seen.length}; first ${first.ok}, second ${second.ok} (${second.receipt?.confirmedByUser}); delete ${del.error?.code}`,
          first.ok && second.ok && seen.length === 2 && del.error?.code === 'USER_DECLINED',
        );
      },
    );
  },
});

async function withPolicy<T>(ctx: ScenarioContext, policy: ConfirmPolicy, fn: () => Promise<T>): Promise<T> {
  ctx.session.setConfirmPolicy(policy);
  try {
    return await fn();
  } finally {
    ctx.session.setConfirmPolicy('sensitive');
  }
}

defineScenario({
  id: 'C-2.8-policies',
  set: 'C',
  title: 'Confirmation policy: always and never',
  covers: 'the confirmation policy: sensitive (default), always, never; set by the user only',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await open(ctx);
      const always = await withPolicy(ctx, 'always', () =>
        ctx.call('click', { target: { ref: refOf(snap, /button "Show details"/) } }),
      );
      const afterAlways = seen.length;
      const never = await withPolicy(ctx, 'never', () =>
        ctx.call('click', { target: { ref: refOf(snap, /button "Delete"/) } }),
      );
      const c = await clicks(tabId);
      return outcome(
        '"always" prompts for an ordinary button (declined); "never" dispatches Delete without a prompt, still recorded as delete',
        `always ${always.error?.code} (${afterAlways} prompt); never ${never.ok ? 'ok' : never.error?.code} sensitive ${never.receipt?.sensitive} confirmed ${never.receipt?.confirmedByUser}; prompts ${seen.length}; clicks ${JSON.stringify(c)}`,
        always.error?.code === 'USER_DECLINED' &&
          afterAlways === 1 &&
          never.ok &&
          never.receipt?.sensitive === 'delete' &&
          never.receipt.confirmedByUser === false &&
          seen.length === 1,
      );
    });
  },
});

void answer;

// ask_user.

const LOGIN = `${FIXTURE_ORIGIN}/c-login.html`;

async function withHuman<T>(ctx: ScenarioContext, fn: () => Promise<T>): Promise<T> {
  const before = [...ctx.session.capabilities];
  ctx.session.setCapabilities([...before, 'human']);
  try {
    return await fn();
  } finally {
    ctx.session.setCapabilities(before);
  }
}

defineScenario({
  id: 'C-2.9-takeover',
  set: 'C',
  title: '`ask_user` takeover on a login page; the scripted user signs in and continues',
  covers: 'the tab is MODAL_PENDING meanwhile; the result carries a full observation of the signed-in page',
  async run(ctx) {
    const tabId = await ctx.open(LOGIN);
    const snap = await ctx.call('snapshot');
    let during: string | undefined;
    return withHuman(ctx, () =>
      withUser(
        (_p, a) => {
          void (async () => {
            during = (await ctx.call('click', { target: { ref: refOf(snap, /button "Sign in"/) } })).error?.code;
            // The person signs in themselves, in the page.
            await evaluate(
              tabId,
              undefined,
              `document.getElementById('email').value = 'ada@example.test'; document.getElementById('password').value = 'pw'; document.getElementById('login').requestSubmit(); 1`,
            );
            a({ outcome: 'continue' });
          })();
        },
        async seen => {
          const r = await ctx.call('ask_user', { message: 'Please sign in, then continue.', kind: 'takeover' });
          const outline = r.page?.snapshot ?? '';
          const p = seen[0]?.kind === 'ask' ? seen[0].request : undefined;
          return outcome(
            'a takeover request; MODAL_PENDING for actions meanwhile; ok with a full observation showing the signed-in page',
            `request ${p?.kind}: ${p?.message}; during: ${during}; ${r.ok ? 'ok' : r.error?.code}; outline mentions "Signed in as ada@example.test": ${outline.includes('Signed in as ada@example.test')}`,
            p?.kind === 'takeover' &&
              during === 'MODAL_PENDING' &&
              r.ok &&
              r.page?.changed === 'full' &&
              outline.includes('Signed in as ada@example.test') &&
              /button "Sign out"/.test(outline),
          );
        },
      ),
    );
  },
});

defineScenario({
  id: 'C-2.9-late-answer',
  set: 'C',
  title: '`ask_user` with no answer; the user answers after the wait has ended',
  covers: 'TIMEOUT; the prompt is withdrawn and the late answer has no effect',
  async run(ctx) {
    await ctx.open(LOGIN);
    let late: boolean | undefined;
    return withHuman(ctx, () =>
      withUser(
        (_p, a) => void setTimeout(() => (late = a({ outcome: 'continue' })), 1500),
        async () => {
          const r = await ctx.call('ask_user', {
            message: 'Enter the code from your phone.',
            kind: 'input',
            timeoutMs: 1000,
          });
          await sleep(700);
          return outcome(
            'TIMEOUT; the late answer is refused',
            `${r.error?.code}; late answer accepted: ${late}`,
            r.error?.code === 'TIMEOUT' && late === false,
          );
        },
      ),
    );
  },
});

defineScenario({
  id: 'C-2.9-input-and-cancel',
  set: 'C',
  title: '`ask_user` input returns the answer; cancel is USER_DECLINED; the capability gates the tool',
  covers: 'ask_user input and cancel; the capability "human" gates the tool',
  async run(ctx) {
    await ctx.open(LOGIN);
    const gated = await ctx.call('ask_user', { message: 'Code?', kind: 'input' });
    return withHuman(ctx, async () => {
      const input = await withUser(
        (_p, a) => void a({ outcome: 'continue', data: '482913' }),
        () => ctx.call('ask_user', { message: 'Code?', kind: 'input' }),
      );
      const cancelled = await withUser(
        (_p, a) => void a({ outcome: 'cancel' }),
        () => ctx.call('ask_user', { message: 'Solve the CAPTCHA', kind: 'takeover' }),
      );
      return outcome(
        'CAPABILITY_DISABLED without "human"; the input answer 482913 in data; cancel is USER_DECLINED',
        `${gated.error?.code}; ${JSON.stringify(input.data)}; ${cancelled.error?.code}`,
        gated.error?.code === 'CAPABILITY_DISABLED' &&
          (input.data as { data?: string }).data === '482913' &&
          cancelled.error?.code === 'USER_DECLINED',
      );
    });
  },
});
