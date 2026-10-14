// Fixture set B: observation.
import { chromeAttacher, chromeTabHost, Controller, createChromeController } from '@src/browser-control';
import type { EpochStore, FindMatch, Result } from '@src/browser-control';
import { FIXTURE_CROSS_ORIGIN, FIXTURE_ORIGIN, FIXTURE_PORT } from '../fixtures-config';
import { evaluate, readRequests, resetRequests, sleep } from '../checks/helpers';
import { defineScenario, outcome } from './registry';

const lines = (r: Result) => (r.page?.snapshot ?? '').split('\n').map(l => l.trim());
const refOf = (r: Result, pattern: RegExp) => {
  const line = lines(r).find(l => pattern.test(l));
  return line ? /^\[(\w+)\]/.exec(line)?.[1] : undefined;
};
const stripRefs = (l: string) => l.replace(/^\[\w+\] /, '');

defineScenario({
  id: 'B1-states-values',
  set: 'B',
  title: 'A form shows roles, states and values',
  covers: 'the rendered format: a form showing roles, states and values',
  async run(ctx) {
    await ctx.open(`${FIXTURE_ORIGIN}/form.html`);
    const got = lines(await ctx.call('snapshot')).map(stripRefs);
    const expected = [
      'textbox "Full name" (required) = "Ada Lovelace"',
      'textbox "Email" (readonly) = "ada@example.test"',
      'combobox "Status" (collapsed) = "Overdue"',
      'checkbox "Overdue only" (checked)',
      'checkbox "Include archived" (unchecked)',
      'radio "Pro" (checked)',
      'switch "Notifications" (checked)',
      'slider "Volume" = "7"',
      'textbox "Notes" = "First line\\nSecond line"',
      'button "More options" (collapsed)',
      'button "Bold" (pressed)',
      'button "Save" (disabled)',
      'tab "Table" (selected)',
      'heading "Invoices" (level 2)',
      'row "INV-1042 Acme Corp Delete"',
      'summary "Shipping details" (collapsed)',
    ];
    const missing = expected.filter(e => !got.includes(e));
    return outcome(
      `${expected.length} lines in the rendered format`,
      missing.length ? `missing: ${missing.join(' | ')}` : 'all present',
      !missing.length,
      got,
    );
  },
});

defineScenario({
  id: 'B2-masking',
  set: 'B',
  title: 'Password, card, security-code and one-time-code values are masked everywhere',
  covers: 'sensitive values are masked wherever page content is returned',
  async run(ctx) {
    await ctx.open(`${FIXTURE_ORIGIN}/form.html`);
    const results = [
      await ctx.call('snapshot'),
      await ctx.call('read', {}),
      await ctx.call('read', { format: 'text' }),
      await ctx.call('find', { role: 'textbox' }),
      await ctx.call('find', { text: '4111' }),
    ];
    const blob = JSON.stringify(results);
    const leaked = ['hunter2', '4111 1111', '654321', '"123"'].filter(s => blob.includes(s));
    const masked = lines(results[0]).filter(l => l.endsWith('(masked)')).length;
    const findByValue = (results[4].data as FindMatch[]).length;
    return outcome(
      '4 fields masked; no secret in snapshot, read or find; a masked value cannot be found',
      `${masked} masked; leaked: ${leaked.join(', ') || 'none'}; find by card number: ${findByValue} matches`,
      masked === 4 && !leaked.length && findByValue === 0,
    );
  },
});

defineScenario({
  id: 'B3-same-process-frame',
  set: 'B',
  title: 'A same-process iframe is stitched under its iframe element',
  covers: 'frames: a same-process iframe',
  async run(ctx) {
    await ctx.open(`${FIXTURE_ORIGIN}/form.html`);
    const snap = await ctx.call('snapshot');
    const l = lines(snap);
    const i = l.findIndex(x => /iframe "Embedded"$/.test(x));
    const below = l.slice(i + 1, i + 3).map(stripRefs);
    const iframe = refOf(snap, /iframe "Embedded"$/);
    const within = await ctx.call('find', { role: 'button', within: iframe });
    const match = (within.data as FindMatch[]).map(m => m.line);
    return outcome(
      'the coupon field and Apply button directly under iframe "Embedded"; find within the iframe finds Apply',
      `${below.join(' / ')}; within: ${match.join(', ')}`,
      below[0] === 'textbox "Coupon" = "SPRING"' && below[1] === 'button "Apply"' && match.length === 1,
    );
  },
});

defineScenario({
  id: 'B4-skipped-frames',
  set: 'B',
  title: 'Frames skipped by policy are stated',
  covers: 'notices; frames under 10×10 px and invisible frames are skipped with a notice',
  async run(ctx) {
    await ctx.open(`${FIXTURE_ORIGIN}/form.html`);
    const snap = await ctx.call('snapshot');
    const tiny = lines(snap).some(l => /iframe "Tiny" \(not captured: smaller than 10×10 px\)$/.test(l));
    const notices = (snap.data as { notices: string[] }).notices;
    const hidden = notices.includes('… 1 frame not captured: not rendered.');
    return outcome(
      'the tiny iframe says why it was not captured; the hidden iframe is in the notices; status partial',
      `tiny ${tiny ? 'noted' : 'missing'}; notices: ${notices.join(' | ')}`,
      tiny && hidden && (snap.data as { status: string }).status === 'partial',
    );
  },
});

defineScenario({
  id: 'B5-capture-fails',
  set: 'B',
  title: 'A capture that fails',
  covers: 'a capture that fails gives status failed and no refs presented; never the previous state',
  async run(ctx) {
    const tabId = await ctx.open(`${FIXTURE_ORIGIN}/busy.html?ms=0`);
    const first = await ctx.call('snapshot');
    const knownBefore = ctx.session.known.size(tabId);
    // Block the page's main thread for 25 s: the frame tree read (5 s budget) and the AX capture (10 s) both run out.
    const blockedUntil = Date.now() + 25_000;
    await evaluate(
      tabId,
      undefined,
      `setTimeout(() => { const end = Date.now() + 25000; while (Date.now() < end) {} }, 0); 1`,
    );
    await sleep(100);
    const failed = await ctx.call('snapshot');
    const knownAfter = ctx.session.known.size(tabId);
    await sleep(Math.max(0, blockedUntil - Date.now()) + 200);
    return outcome(
      'CAPTURE_FAILED, no outline returned, and the known set of the tab emptied',
      `${failed.error?.code ?? 'ok'}; outline ${failed.page ? 'returned' : 'absent'}; known refs ${knownBefore} → ${knownAfter}`,
      first.ok && failed.error?.code === 'CAPTURE_FAILED' && !failed.page && knownBefore > 0 && knownAfter === 0,
      failed.text,
    );
  },
});

defineScenario({
  id: 'B6-two-tabs',
  set: 'B',
  title: 'Two tabs share no label; a ref acts on its own tab',
  covers: 'two tabs in one session; a ref from the first is used while the second is active',
  async run(ctx) {
    const first = await ctx.open(`${FIXTURE_ORIGIN}/form.html`);
    const a = await ctx.call('snapshot');
    const second = await ctx.open(`${FIXTURE_ORIGIN}/frames-nested.html`);
    await sleep(600);
    const b = await ctx.call('snapshot');
    const refs = (r: Result) => new Set([...(r.page?.snapshot ?? '').matchAll(/\[(\w+)\]/g)].map(m => m[1]));
    const shared = [...refs(a)].filter(r => refs(b).has(r));
    const apply = refOf(a, /button "Apply"$/);
    const active = ctx.session.activeTabId;
    const read = await ctx.call('read', { ref: apply, format: 'text' });
    const mismatch = await ctx.call('read', { ref: apply, tabId: second });
    return outcome(
      'no shared label; with the second tab active, read of a first-tab ref reads the first tab; a conflicting tabId is REF_TAB_MISMATCH',
      `shared ${shared.length}; active tab is ${active === second ? 'second' : 'first'}; read "${(read.data as { content: string } | undefined)?.content}"; with tabId: ${mismatch.error?.code}`,
      shared.length === 0 &&
        active === second &&
        read.ok &&
        read.text.includes(`tab ${first}`) &&
        mismatch.error?.code === 'REF_TAB_MISMATCH',
    );
  },
});

defineScenario({
  id: 'B7-restart',
  set: 'B',
  title: 'A ref kept from before a service worker restart',
  covers: 'REF_UNKNOWN; the next epoch prefix is used',
  async run(ctx) {
    await ctx.open(`${FIXTURE_ORIGIN}/form.html`);
    const snap = await ctx.call('snapshot');
    const kept = refOf(snap, /textbox "Full name"/)!;
    // A new controller reserves an epoch exactly as the worker does at start; the agent's old label meets it.
    const restarted = await createChromeController();
    const session = restarted.createSession();
    const after = await session.call('read', { ref: kept });
    return outcome(
      'the new lifetime has a different prefix and answers REF_UNKNOWN for the kept label',
      `kept ${kept}; new prefix ${restarted.epoch.prefix}; ${after.error?.code ?? 'ok'}`,
      !kept.startsWith(restarted.epoch.prefix) && after.error?.code === 'REF_UNKNOWN',
    );
  },
});

defineScenario({
  id: 'B8-epoch-store-fails',
  set: 'B',
  title: 'Storage for the epoch counter fails at start, twice in a row',
  covers: 'labels use the long uppercase form; no label from either lifetime matches the other',
  async run() {
    const failing: EpochStore = {
      read: async () => {
        throw new Error('storage unavailable');
      },
      write: async () => {
        throw new Error('storage unavailable');
      },
    };
    const host = { attacher: chromeAttacher, tabs: chromeTabHost, epochStore: failing };
    const [one, two] = [await Controller.create(host), await Controller.create(host)];
    const label = (c: Controller, n: number) =>
      c.registry.assign({ tabId: 1, sessionId: undefined, frameId: 'F', loaderId: 'L', backendNodeId: n }, 'ax', {
        role: 'button',
        name: '',
        tag: '',
        text: '',
        nth: null,
        context: null,
      }).ref;
    const a = [1, 2, 3].map(n => label(one, n));
    const b = [1, 2, 3].map(n => label(two, n));
    const overlap = a.filter(x => b.includes(x));
    const pass =
      /^[A-Z]{12}$/.test(one.epoch.prefix) &&
      /^[A-Z]{12}$/.test(two.epoch.prefix) &&
      !one.epoch.persisted &&
      overlap.length === 0;
    return outcome(
      'two different 12-letter uppercase prefixes; no shared label',
      `${a.join(', ')} / ${b.join(', ')}`,
      pass,
    );
  },
});

defineScenario({
  id: 'B9-live-value',
  set: 'B',
  title: 'A value changed with no DOM mutation shows in the next snapshot',
  covers: 'an action edits a field, then snapshot with no DOM mutation shows the new value (the capture is fresh)',
  async run(ctx) {
    const tabId = await ctx.open(`${FIXTURE_ORIGIN}/live-value.html`);
    const before = lines(await ctx.call('snapshot')).map(stripRefs);
    await evaluate(
      tabId,
      undefined,
      `document.getElementById('q').value = 'after'; document.getElementById('c').checked = true; 1`,
    );
    const after = lines(await ctx.call('snapshot')).map(stripRefs);
    const ok =
      before.includes('textbox "Search" = "before"') &&
      after.includes('textbox "Search" = "after"') &&
      after.includes('checkbox "Remember me" (checked)');
    return outcome(
      'value "before" → "after", checkbox unchecked → checked',
      after.filter(l => /Search|Remember/.test(l)).join(' | '),
      ok,
    );
  },
});

const DENIED = `127.0.0.1:${FIXTURE_PORT}`;
const deniedHits = async () =>
  (await readRequests()).requests.filter(r => r.host === DENIED).reduce((n, r) => n + r.count, 0);

defineScenario({
  id: 'B10-navigate-denied',
  set: 'B',
  title: 'navigate to a denied URL',
  covers: 'policy layer 1: a denied URL is blocked',
  async run(ctx) {
    try {
      await ctx.session.setUrlPolicy({ allow: [], deny: ['127.0.0.1'] });
      await ctx.open(`${FIXTURE_ORIGIN}/network.html`);
      await resetRequests();
      const r = await ctx.call('navigate', { url: `${FIXTURE_CROSS_ORIGIN}/network-landed.html` });
      const hits = await deniedHits();
      return outcome(
        'URL_NOT_ALLOWED, nothing sent to the denied host',
        `${r.error?.code ?? 'ok'}; ${hits} requests at ${DENIED}`,
        r.error?.code === 'URL_NOT_ALLOWED' && hits === 0,
      );
    } finally {
      await ctx.session.setUrlPolicy({ allow: [], deny: [] });
    }
  },
});

defineScenario({
  id: 'B11-redirect-denied',
  set: 'B',
  title: 'navigate to an allowed URL that redirects to a denied one',
  covers: 'the redirect hop is failed; nothing reaches the denied site',
  async run(ctx) {
    try {
      await ctx.session.setUrlPolicy({ allow: [], deny: ['127.0.0.1'] });
      const tabId = await ctx.open(`${FIXTURE_ORIGIN}/network.html`);
      await resetRequests();
      const r = await ctx.call('navigate', {
        url: `${FIXTURE_ORIGIN}/redirect?to=${encodeURIComponent(`${FIXTURE_CROSS_ORIGIN}/network-landed.html`)}`,
      });
      const hits = await deniedHits();
      const url = (await chrome.tabs.get(tabId)).url;
      return outcome(
        'URL_NOT_ALLOWED; the page stays on network.html; nothing reaches the denied host',
        `${r.error?.code ?? 'ok'}; page ${url}; ${hits} requests at ${DENIED}`,
        r.error?.code === 'URL_NOT_ALLOWED' && hits === 0 && url === `${FIXTURE_ORIGIN}/network.html`,
        r.text,
      );
    } finally {
      await ctx.session.setUrlPolicy({ allow: [], deny: [] });
    }
  },
});
