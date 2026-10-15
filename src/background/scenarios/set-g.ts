// Fixture set G: permissions. First the hand-over policy of a product session (USER_STEP for payments and page
// prompts, no page script), and blocked sites matched with siteOf in every check. The layer's own tests; the scenarios
// with the scripted model are in set-g-loop.ts.
import type {
  ConfirmRequest,
  Result,
  Session,
  SessionConfig,
  UserStepDetails,
  WriteDecision,
  WriteQuestion,
} from '@src/browser-control';
import { setResponder } from '../prompts';
import type { OpenPrompt } from '../prompts';
import { FIXTURE_CROSS_ORIGIN, FIXTURE_ORIGIN } from '../fixtures-config';
import { evaluate, sleep } from '../checks/helpers';
import { layer } from '../layer';
import { defineScenario, outcome } from './registry';
import type { ScenarioContext } from './registry';
import { refOf } from './set-c';

const PAGE = `${FIXTURE_ORIGIN}/g-handover.html`;
export const BLOCKED_SITE = '127.0.0.1:8787';

/** A session as the extension's agent gets it: the hand-over policy, and the user's blocked sites. */
export async function agentSession(
  ctx: ScenarioContext,
  url: string,
  config: SessionConfig = {},
): Promise<{
  session: Session;
  tabId: number;
  call: (tool: string, args?: Record<string, unknown>) => Promise<Result>;
}> {
  const { controller } = await layer();
  const session = controller.createSession({
    handover: true,
    urlPolicy: { allow: [], deny: [], blocked: [BLOCKED_SITE] },
    ...config,
  });
  const tabId = await ctx.open(url, { attach: false });
  session.shareTab(tabId);
  closeLater.push(session);
  return { session, tabId, call: (tool, args = {}) => session.call(tool, { tabId, ...args }) };
}

const closeLater: Session[] = [];
async function closeSessions(): Promise<void> {
  const { controller } = await layer();
  for (const s of closeLater.splice(0)) await controller.closeSession(s);
}

const hits = (tabId: number) => evaluate<string[]>(tabId, undefined, 'window.hits');
const step = (r: Result) => r.error?.details as UserStepDetails | undefined;

function scenario(
  id: string,
  title: string,
  covers: string,
  run: (ctx: ScenarioContext) => Promise<ReturnType<typeof outcome>>,
) {
  defineScenario({
    id,
    set: 'G',
    title,
    covers,
    async run(ctx) {
      try {
        return await run(ctx);
      } finally {
        await closeSessions();
      }
    },
  });
}

scenario('G-6.3-pay-button', 'A pay button is the user’s step', 'USER_STEP by ref, nothing dispatched', async ctx => {
  const a = await agentSession(ctx, PAGE);
  const r = await a.call('click', { target: { ref: refOf(await a.call('snapshot'), /button "Pay now"/) } });
  const h = await hits(a.tabId);
  return outcome(
    'USER_STEP, reason pay, site localhost:8787, delivered false; the page saw nothing',
    `${r.error?.code} ${JSON.stringify(step(r))} delivered ${r.error?.delivered}; hits ${JSON.stringify(h)}`,
    r.error?.code === 'USER_STEP' &&
      step(r)?.reason === 'pay' &&
      step(r)?.site === 'localhost:8787' &&
      r.error.delivered === false &&
      h.length === 0,
  );
});

scenario('G-6.3-pay-semantic', 'A pay button by role and name', 'every route; semantic target', async ctx => {
  const a = await agentSession(ctx, PAGE);
  await a.call('snapshot');
  const r = await a.call('click', { target: { role: 'button', name: 'Pay now' } });
  return outcome('USER_STEP', `${r.error?.code}`, r.error?.code === 'USER_STEP' && (await hits(a.tabId)).length === 0);
});

scenario(
  'G-6.3-pay-link',
  'A pay-labelled link is handed over like a button',
  'a link counts like a button',
  async ctx => {
    const a = await agentSession(ctx, PAGE);
    const r = await a.call('click', { target: { ref: refOf(await a.call('snapshot'), /link "Proceed to checkout"/) } });
    return outcome(
      'USER_STEP',
      `${r.error?.code}: ${r.error?.message}`,
      r.error?.code === 'USER_STEP' && (await hits(a.tabId)).length === 0,
    );
  },
);

scenario(
  'G-6.3-enter-pay-form',
  'Enter in a card form whose default button pays',
  'Enter in a card form',
  async ctx => {
    const a = await agentSession(ctx, PAGE);
    const snap = await a.call('snapshot');
    const field = refOf(snap, /textbox "Name on card"/);
    await a.call('set', { target: { ref: field }, value: 'Ada Lovelace' });
    const r = await a.call('press', { target: { ref: field }, keys: 'Enter' });
    const h = await hits(a.tabId);
    return outcome(
      'USER_STEP for Enter; the form was not submitted',
      `${r.error?.code}: ${r.error?.message}; hits ${JSON.stringify(h)}`,
      r.error?.code === 'USER_STEP' && step(r)?.reason === 'pay' && !h.includes('card-submit'),
    );
  },
);

scenario(
  'G-6.3-fill-form-pay',
  'fill_form whose submit control pays',
  'the fields are set, the step is handed over, partial result kept',
  async ctx => {
    const a = await agentSession(ctx, PAGE);
    const snap = await a.call('snapshot');
    const r = await a.call('fill_form', {
      fields: [
        { target: { ref: refOf(snap, /textbox "Name on card"/) }, value: 'Ada Lovelace' },
        { target: { ref: refOf(snap, /textbox "Note"/) }, value: 'Leave at the door' },
      ],
      submit: { ref: refOf(snap, /button "Place order"/) },
    });
    const data = r.data as { receipts?: unknown[]; submitted?: boolean } | undefined;
    const values = await evaluate<string[]>(
      a.tabId,
      undefined,
      '[...document.querySelectorAll("#card input")].map(i => i.value)',
    );
    return outcome(
      'USER_STEP with 2 receipts, not submitted, both fields set in the page',
      `${r.error?.code}; receipts ${data?.receipts?.length}; submitted ${data?.submitted}; values ${JSON.stringify(values)}`,
      r.error?.code === 'USER_STEP' &&
        step(r)?.reason === 'pay' &&
        data?.receipts?.length === 2 &&
        data.submitted === false &&
        values[0] === 'Ada Lovelace' &&
        !(await hits(a.tabId)).includes('card-submit'),
    );
  },
);

scenario(
  'G-6.3-prompt-dialog',
  'Accepting a page prompt is the user’s step; dismissing is not',
  'the user answers every prompt dialog; hasBrowserHandler reported',
  async ctx => {
    const a = await agentSession(ctx, PAGE);
    await a.call('click', { target: { ref: refOf(await a.call('snapshot'), /button "Ask my name"/) } });
    const accept = await a.call('handle_dialog', { accept: true, promptText: 'Mallory' });
    const dismiss = await a.call('handle_dialog', { accept: false });
    await sleep(100);
    const h = await hits(a.tabId);
    return outcome(
      'accept: USER_STEP reason prompt with hasBrowserHandler; dismiss: ok; the page got null',
      `${accept.error?.code} ${JSON.stringify(step(accept))}; dismiss ${dismiss.ok}; hits ${JSON.stringify(h)}`,
      accept.error?.code === 'USER_STEP' &&
        step(accept)?.reason === 'prompt' &&
        typeof step(accept)?.hasBrowserHandler === 'boolean' &&
        dismiss.ok &&
        h.includes('prompt:null'),
    );
  },
);

scenario(
  'G-6.3-confirm-plain',
  'A confirm dialog stays with the agent',
  'only prompt dialogs are protected',
  async ctx => {
    const a = await agentSession(ctx, PAGE);
    await a.call('click', { target: { ref: refOf(await a.call('snapshot'), /button "Confirm something"/) } });
    const r = await a.call('handle_dialog', { accept: true });
    await sleep(100);
    return outcome(
      'accepted',
      `${r.ok} ${JSON.stringify(await hits(a.tabId))}`,
      r.ok && (await hits(a.tabId)).includes('confirm:true'),
    );
  },
);

scenario(
  'G-6.3-blocked-routes',
  'A blocked site by navigate, tabs open, a link and a form',
  'blocked sites are refused first; matched with siteOf',
  async ctx => {
    const a = await agentSession(ctx, PAGE);
    const nav = await a.call('navigate', { url: `${FIXTURE_CROSS_ORIGIN}/network-landed.html` });
    const open = await a.session.call('tabs', { action: 'open', url: `${FIXTURE_CROSS_ORIGIN}/index.html` });
    const snap = await a.call('snapshot');
    const link = await a.call('click', { target: { ref: refOf(snap, /link "A link to the blocked site"/) } });
    await sleep(300);
    const after1 = (await chrome.tabs.get(a.tabId)).url;
    const form = await a.call('click', {
      target: { ref: refOf(await a.call('snapshot'), /button "Send to the blocked site"/) },
    });
    await sleep(300);
    const after2 = (await chrome.tabs.get(a.tabId)).url;
    const blockedTabs = (await chrome.tabs.query({})).filter(t => t.url?.startsWith(FIXTURE_CROSS_ORIGIN));
    return outcome(
      'navigate and tabs open refused; the link and the form do not load the blocked site; no tab on it',
      `navigate ${nav.error?.code}; open ${open.error?.code}; link ${link.error?.code ?? 'ok'} → ${after1}; form ${form.error?.code ?? 'ok'} → ${after2}; tabs ${blockedTabs.length}`,
      nav.error?.code === 'URL_NOT_ALLOWED' &&
        open.error?.code === 'URL_NOT_ALLOWED' &&
        !after1?.startsWith(FIXTURE_CROSS_ORIGIN) &&
        !after2?.startsWith(FIXTURE_CROSS_ORIGIN) &&
        blockedTabs.length === 0,
    );
  },
);

scenario(
  'G-6.3-blocked-tab',
  'A tab already on a blocked site is not shared and not acted on',
  'blocked sites are checked when shared and before each call',
  async ctx => {
    const { controller } = await layer();
    const session = controller.createSession({
      handover: true,
      urlPolicy: { allow: [], deny: [], blocked: [BLOCKED_SITE] },
    });
    closeLater.push(session);
    const tabId = await ctx.open(`${FIXTURE_CROSS_ORIGIN}/index.html`, { attach: false });
    const shared = await session.share(tabId).then(
      () => 'shared',
      (e: Error) => e.message,
    );
    session.shareTab(tabId); // as if it was shared before the user blocked the site
    const r = await session.call('snapshot', { tabId });
    await closeSessions();
    return outcome(
      'share refused; a call on the tab is URL_NOT_ALLOWED',
      `share: ${shared}; snapshot ${r.error?.code}`,
      shared !== 'shared' && r.error?.code === 'URL_NOT_ALLOWED',
    );
  },
);

scenario(
  'G-6.3-no-page-script',
  'A session with a hand-over policy has no eval or devtools',
  'a product session gets no page script',
  async () => {
    const { controller } = await layer();
    const session = controller.createSession({ handover: true, capabilities: ['eval', 'devtools', 'human'] });
    session.setCapabilities(['eval', 'devtools', 'human', 'files']);
    const caps = [...session.capabilities].sort();
    await controller.closeSession(session);
    return outcome('capabilities: files, human', caps.join(', '), caps.join(',') === 'files,human');
  },
);

// The host's policy for writes.

const WRITES = `${FIXTURE_ORIGIN}/g-writes.html`;

/** Answers every confirmation with `answer` after `delayMs`, and records the requests. */
function scriptedUser(
  answer: 'approve' | 'approve-remember' | 'decline',
  delayMs = 0,
  before?: (r: ConfirmRequest) => Promise<void>,
) {
  const seen: ConfirmRequest[] = [];
  setResponder((prompt: OpenPrompt, reply) => {
    if (prompt.kind !== 'confirm') return;
    seen.push(prompt.request);
    void (async () => {
      if (before) await before(prompt.request);
      if (delayMs) await sleep(delayMs);
      reply(answer);
    })();
  });
  return seen;
}

function policy(decision: WriteDecision, asked: WriteQuestion[] = []) {
  return {
    asked,
    decideWrite: (q: WriteQuestion) => {
      asked.push(q);
      return decision;
    },
  };
}

scenario(
  'G-6.4-auto-runs',
  'In Auto mode a write runs with no card, and says so',
  'decideWrite → run; receipt allowedBy',
  async ctx => {
    const seen = scriptedUser('decline');
    const p = policy({ decision: 'run', by: 'auto', canRemember: true });
    const a = await agentSession(ctx, WRITES, { decideWrite: p.decideWrite });
    const r = await a.call('click', { target: { ref: refOf(await a.call('snapshot'), /button "Send"/) } });
    return outcome(
      'no card; the policy was asked for submit on localhost:8787; receipt submit allowed by Auto mode',
      `cards ${seen.length}; asked ${JSON.stringify(p.asked)}; ${r.receipt?.sensitive} ${r.receipt?.allowedBy}; ${r.text.split('\n')[0]}`,
      seen.length === 0 &&
        p.asked[0]?.category === 'submit' &&
        p.asked[0]?.site === 'localhost:8787' &&
        r.receipt?.allowedBy === 'auto' &&
        /submit: allowed by Auto mode/.test(r.text) &&
        (await hits(a.tabId)).includes('send'),
    );
  },
);

scenario('G-6.4-site-rule-runs', 'A site set to Allow runs a write with no card', 'the Allow site rule', async ctx => {
  const seen = scriptedUser('decline');
  const a = await agentSession(ctx, WRITES, {
    decideWrite: policy({ decision: 'run', by: 'site-rule', canRemember: true }).decideWrite,
  });
  const r = await a.call('click', { target: { ref: refOf(await a.call('snapshot'), /button "Delete draft"/) } });
  return outcome(
    'no card; delete allowed by the site rule',
    `cards ${seen.length}; ${r.receipt?.allowedBy}`,
    seen.length === 0 && r.receipt?.allowedBy === 'site-rule',
  );
});

scenario(
  'G-6.4-card',
  'In Ask mode the card names the site and offers Allow on this site for a delete',
  'every write category may be remembered',
  async ctx => {
    const seen = scriptedUser('approve-remember');
    const a = await agentSession(ctx, WRITES, {
      decideWrite: policy({ decision: 'ask', canRemember: true }).decideWrite,
    });
    const r = await a.call('click', {
      target: { ref: refOf(await a.call('snapshot'), /button "Delete draft"/) },
      intent: 'Remove the draft',
    });
    const c = seen[0];
    return outcome(
      'one card: delete, site localhost:8787, canRemember, intent; the click ran, allowed by the user',
      `${seen.length} card: ${c?.category} ${c?.site} canRemember ${c?.canRemember} intent ${c?.intent}; ${r.receipt?.allowedBy}`,
      seen.length === 1 &&
        c.category === 'delete' &&
        c.site === 'localhost:8787' &&
        c.canRemember &&
        c.intent === 'Remove the draft' &&
        r.receipt?.allowedBy === 'user' &&
        (await hits(a.tabId)).includes('delete'),
    );
  },
);

scenario('G-6.4-site-ask', 'A site set to Ask asks with no Allow on this site', 'the Ask site rule', async ctx => {
  const seen = scriptedUser('decline');
  const a = await agentSession(ctx, WRITES, {
    decideWrite: policy({ decision: 'ask', canRemember: false }).decideWrite,
  });
  const r = await a.call('click', { target: { ref: refOf(await a.call('snapshot'), /button "Send"/) } });
  return outcome(
    'a card without Allow on this site; denied: USER_DECLINED, nothing sent',
    `canRemember ${seen[0]?.canRemember}; ${r.error?.code}; hits ${JSON.stringify(await hits(a.tabId))}`,
    seen[0]?.canRemember === false && r.error?.code === 'USER_DECLINED' && !(await hits(a.tabId)).includes('send'),
  );
});

scenario(
  'G-6.4-hosts',
  'The card names the destination host and the frame host when they differ',
  'one action, one site',
  async ctx => {
    const seen = scriptedUser('decline');
    const a = await agentSession(ctx, WRITES, {
      decideWrite: policy({ decision: 'ask', canRemember: true }).decideWrite,
      urlPolicy: { allow: [], deny: [], blocked: [] },
    });
    await sleep(300);
    const snap = await a.call('snapshot');
    await a.call('click', { target: { ref: refOf(snap, /button "Submit feedback"/) } });
    await a.call('click', { target: { ref: refOf(snap, /button "Remove item"/) } });
    return outcome(
      'feedback: site localhost:8787, destination 127.0.0.1:8787; frame button: frame host 127.0.0.1:8787',
      JSON.stringify(seen.map(c => ({ site: c.site, frameHost: c.frameHost, destinationHost: c.destinationHost }))),
      seen.length === 2 &&
        seen[0].site === 'localhost:8787' &&
        seen[0].destinationHost === '127.0.0.1:8787' &&
        seen[1].site === 'localhost:8787' &&
        seen[1].frameHost === '127.0.0.1:8787',
    );
  },
);

scenario(
  'G-6.4-site-changed',
  'The tab left the site while the user decided',
  'the site is checked again after the decision: TARGET_CHANGED',
  async ctx => {
    let tab = 0;
    scriptedUser('approve', 0, async () => {
      await chrome.tabs.update(tab, { url: `${FIXTURE_CROSS_ORIGIN}/g-writes.html` });
      await sleep(800);
    });
    const a = await agentSession(ctx, WRITES, {
      decideWrite: policy({ decision: 'ask', canRemember: true }).decideWrite,
      urlPolicy: { allow: [], deny: [], blocked: [] },
    });
    tab = a.tabId;
    const r = await a.call('click', { target: { ref: refOf(await a.call('snapshot'), /button "Send"/) } });
    return outcome(
      'TARGET_CHANGED, nothing dispatched',
      `${r.error?.code} delivered ${r.error?.delivered}: ${r.error?.message}`,
      r.error?.code === 'TARGET_CHANGED' && r.error.delivered === false,
    );
  },
);

scenario(
  'G-6.4-no-clock',
  'A session can wait for the card without a clock',
  'a card with no clock: confirmTimeoutMs Infinity',
  async ctx => {
    scriptedUser('approve', 1500);
    const a = await agentSession(ctx, WRITES, {
      decideWrite: policy({ decision: 'ask', canRemember: true }).decideWrite,
      confirmTimeoutMs: Infinity,
    });
    const r = await a.call('click', { target: { ref: refOf(await a.call('snapshot'), /button "Send"/) } });
    return outcome(
      'approved after 1.5 s; no timeout',
      `${r.ok ? 'ok' : r.error?.code}`,
      r.ok && r.receipt?.allowedBy === 'user',
    );
  },
);

// The classifier enrichments.
const ENRICH = `${FIXTURE_ORIGIN}/g-enrich.html`;

scenario(
  'G-6.5-secret-set',
  'set, type and a printable key into secret fields are the user’s step',
  'secret input is the user’s step',
  async ctx => {
    const a = await agentSession(ctx, ENRICH);
    const snap = await a.call('snapshot');
    const pw = refOf(snap, /textbox "Password"/);
    const otp = refOf(snap, /textbox "One-time code"/);
    const set = await a.call('set', { target: { ref: pw }, value: 'hunter2' });
    const type = await a.call('type', { target: { ref: otp }, text: '123456' });
    await evaluate(a.tabId, undefined, 'document.querySelector("[name=password]").focus()');
    const press = await a.call('press', { keys: 'a' });
    const card = await a.call('set', {
      target: { ref: refOf(snap, /combobox "Saved card"/) },
      value: 'Visa ending 4242',
    });
    const values = await evaluate<string>(
      a.tabId,
      undefined,
      '[...document.querySelectorAll("#login input, #login select")].map(i => i.value).join("|")',
    );
    return outcome(
      'USER_STEP reason secret four times; nothing typed into any field',
      `${[set, type, press, card].map(r => `${r.error?.code}/${step(r)?.reason}`).join(' ')}; values ${values}`,
      [set, type, press, card].every(r => r.error?.code === 'USER_STEP' && step(r)?.reason === 'secret') &&
        values === '||||',
    );
  },
);

scenario('G-6.5-not-secret', 'A promo code and an email are ordinary fields', 'what must not match', async ctx => {
  const a = await agentSession(ctx, ENRICH);
  const snap = await a.call('snapshot');
  const email = await a.call('set', { target: { ref: refOf(snap, /textbox "Email"/) }, value: 'ada@example.com' });
  const promo = await a.call('set', { target: { ref: refOf(snap, /textbox "Promo code"/) }, value: 'SPRING24' });
  return outcome('both set', `${email.ok} ${promo.ok}`, email.ok && promo.ok);
});

scenario(
  'G-6.5-fill-secret',
  'fill_form stops at a secret field, keeping the fields it set',
  'secret input is the user’s step; fill_form keeps the fields it set',
  async ctx => {
    const a = await agentSession(ctx, ENRICH);
    const snap = await a.call('snapshot');
    const r = await a.call('fill_form', {
      fields: [
        { target: { ref: refOf(snap, /textbox "Email"/) }, value: 'ada@example.com' },
        { target: { ref: refOf(snap, /textbox "Password"/) }, value: 'hunter2' },
      ],
    });
    const data = r.data as { receipts?: unknown[] } | undefined;
    return outcome(
      'USER_STEP secret after one field',
      `${r.error?.code}/${step(r)?.reason}; receipts ${data?.receipts?.length}`,
      r.error?.code === 'USER_STEP' && step(r)?.reason === 'secret' && data?.receipts?.length === 1,
    );
  },
);

scenario(
  'G-6.5-grant',
  'Authorize is an access grant; a cookie banner’s Allow is not',
  'grant, a protected category',
  async ctx => {
    scriptedUser('approve');
    const a = await agentSession(ctx, ENRICH, {
      decideWrite: policy({ decision: 'run', by: 'auto', canRemember: true }).decideWrite,
    });
    const snap = await a.call('snapshot');
    const authorize = await a.call('click', { target: { ref: refOf(snap, /button "Authorize"/) } });
    const allow = await a.call('click', { target: { ref: refOf(snap, /button "Allow"/) } });
    return outcome(
      'Authorize: USER_STEP grant (in Auto mode too); Allow: clicked',
      `${authorize.error?.code}/${step(authorize)?.reason}; allow ${allow.ok}; hits ${JSON.stringify(await hits(a.tabId))}`,
      authorize.error?.code === 'USER_STEP' &&
        step(authorize)?.reason === 'grant' &&
        allow.ok &&
        !(await hits(a.tabId)).includes('authorize'),
    );
  },
);

scenario('G-6.5-consent-page', 'Continue on a consent page grants access', 'the consent-path rule', async ctx => {
  const a = await agentSession(ctx, `${FIXTURE_ORIGIN}/oauth/consent.html`, {
    decideWrite: policy({ decision: 'run', by: 'auto', canRemember: true }).decideWrite,
  });
  const r = await a.call('click', { target: { ref: refOf(await a.call('snapshot'), /button "Continue"/) } });
  const granted = await evaluate<boolean>(a.tabId, undefined, '!!window.granted');
  return outcome(
    'USER_STEP grant; nothing submitted',
    `${r.error?.code}/${step(r)?.reason}; granted ${granted}`,
    r.error?.code === 'USER_STEP' && step(r)?.reason === 'grant' && !granted,
  );
});

scenario(
  'G-6.5-enter-no-form',
  'Enter in a comment box with no form asks; in a search box it does not',
  'Enter in a field that has no form is submit, unless it is a search field',
  async ctx => {
    const seen = scriptedUser('decline');
    const a = await agentSession(ctx, ENRICH, {
      decideWrite: policy({ decision: 'ask', canRemember: true }).decideWrite,
    });
    const snap = await a.call('snapshot');
    const comment = await a.call('press', { target: { ref: refOf(snap, /textbox "Write a comment"/) }, keys: 'Enter' });
    const search = await a.call('press', {
      target: { ref: refOf(snap, /searchbox "Search the site"/) },
      keys: 'Enter',
    });
    const filter = await a.call('press', { target: { ref: refOf(snap, /textbox "Filter"/) }, keys: 'Enter' });
    const h = await hits(a.tabId);
    return outcome(
      'comment: one card, declined, no Enter reached it; search and a field with search vocabulary: no card, Enter sent',
      `cards ${seen.length} (${seen[0]?.category}); comment ${comment.error?.code}; search ${search.ok}; filter ${filter.ok}; hits ${JSON.stringify(h)}`,
      seen.length === 1 &&
        seen[0].category === 'submit' &&
        comment.error?.code === 'USER_DECLINED' &&
        search.ok &&
        filter.ok &&
        !h.includes('comment') &&
        h.includes('search') &&
        h.includes('filter'),
    );
  },
);

scenario(
  'G-6.5-save-and-reply',
  'A script-driven Save and Create, and Send in a one-textarea form, ask; a cookie banner’s Reject all does not',
  '"Save" and "create" are submission vocabulary; the single-field search rule; the cookie-banner exception',
  async ctx => {
    const seen = scriptedUser('decline');
    const a = await agentSession(ctx, ENRICH, {
      decideWrite: policy({ decision: 'ask', canRemember: true }).decideWrite,
    });
    const snap = await a.call('snapshot');
    const save = await a.call('click', { target: { ref: refOf(snap, /button "Save"/) } });
    const send = await a.call('click', { target: { ref: refOf(snap, /button "Send"/) } });
    const create = await a.call('click', { target: { ref: refOf(snap, /button "Create"/) } });
    const reject = await a.call('click', { target: { ref: refOf(snap, /button "Reject all"/) } });
    const h = await hits(a.tabId);
    return outcome(
      'three cards (Save, Send, Create), all submit and declined; a cookie banner’s Reject all: no card, clicked',
      `cards ${seen.map(c => c.category).join(',')}; ${save.error?.code} ${send.error?.code} ${create.error?.code}; reject ${reject.ok}; hits ${JSON.stringify(h)}`,
      seen.length === 3 &&
        seen.every(c => c.category === 'submit') &&
        save.error?.code === 'USER_DECLINED' &&
        send.error?.code === 'USER_DECLINED' &&
        create.error?.code === 'USER_DECLINED' &&
        reject.ok &&
        h.includes('reject-all') &&
        !h.includes('create'),
    );
  },
);

// Background tabs. Whether a tab becomes visible is the host's decision; the window is never focused.
scenario(
  'G-6.6-hidden-open-select',
  'tabs open and select in a session the user is not watching',
  'activation decided by the host; placement in the background',
  async ctx => {
    const joined: string[] = [];
    const a = await agentSession(ctx, WRITES, { reveal: () => false, onTabJoined: (id, how) => joined.push(how) });
    const user = await chrome.tabs.create({ url: 'about:blank', active: true });
    try {
      const opened = await a.session.call('tabs', { action: 'open', url: `${FIXTURE_ORIGIN}/index.html` });
      const openedId = (opened.data as { opened?: number } | undefined)?.opened;
      const visibleAfterOpen = (await chrome.tabs.query({ active: true, windowId: user.windowId }))[0]?.id;
      await a.session.call('tabs', { action: 'select', tabId: a.tabId });
      const visibleAfterSelect = (await chrome.tabs.query({ active: true, windowId: user.windowId }))[0]?.id;
      const snap = await a.session.call('snapshot', { tabId: openedId });
      if (openedId) await a.session.call('tabs', { action: 'close', tabId: openedId });
      return outcome(
        'the user’s tab stays visible after open and select; the session works on the hidden tab; the host saw the tab join',
        `opened ${openedId}; visible after open ${visibleAfterOpen === user.id ? 'user' : visibleAfterOpen}; after select ${visibleAfterSelect === user.id ? 'user' : visibleAfterSelect}; active ${a.session.activeTabId === a.tabId}; snapshot ${snap.ok}; joined ${joined.join(',')}`,
        !!openedId &&
          visibleAfterOpen === user.id &&
          visibleAfterSelect === user.id &&
          a.session.activeTabId === a.tabId &&
          snap.ok &&
          joined.includes('opened'),
      );
    } finally {
      await chrome.tabs.remove(user.id!).catch(() => undefined);
    }
  },
);

scenario(
  'G-6.6-not-discardable',
  'A tab the session holds is not discardable',
  'no discarding while held',
  async ctx => {
    const a = await agentSession(ctx, WRITES);
    await sleep(100);
    const held = (await chrome.tabs.get(a.tabId)).autoDiscardable;
    const { controller } = await layer();
    await controller.closeSession(a.session);
    await sleep(100);
    const released = (await chrome.tabs.get(a.tabId)).autoDiscardable;
    return outcome(
      'autoDiscardable false while held, true after',
      `${held} → ${released}`,
      held === false && released === true,
    );
  },
);

// The agent goes to a page in the tab it works in, even from a page the debugger cannot attach to.
scenario(
  'G-nav-from-restricted',
  'navigate from a chrome:// page',
  'the URL is loaded through chrome.tabs, then the tab is attached',
  async ctx => {
    const a = await agentSession(ctx, 'chrome://version/');
    const nav = await a.call('navigate', { url: `${FIXTURE_ORIGIN}/index.html` });
    const snap = await a.call('snapshot');
    const url = (await chrome.tabs.get(a.tabId)).url;
    return outcome(
      'navigate succeeds in the same tab, which can then be observed',
      `navigate ${nav.ok ? 'ok' : nav.error?.code}; snapshot ${snap.ok}; url ${url}`,
      nav.ok && snap.ok && url === `${FIXTURE_ORIGIN}/index.html`,
    );
  },
);
