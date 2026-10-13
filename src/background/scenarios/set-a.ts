// Fixture set A: structure and network.
import type { SnapshotData } from '@src/browser-control';
import { FIXTURE_CROSS_ORIGIN, FIXTURE_ORIGIN, FIXTURE_PORT } from '../fixtures-config';
import { countOf, evaluate, readRequests, resetRequests, sleep, waitForLoad } from '../checks/helpers';
import { frameReport } from '../spike-session';
import { layer } from '../layer';
import { defineScenario, outcome } from './registry';

const HOSTS = [FIXTURE_ORIGIN, FIXTURE_CROSS_ORIGIN, `http://[::1]:${FIXTURE_PORT}`];

defineScenario({
  id: 'A1-hosts',
  set: 'A',
  title: 'Fixture pages load on all three hosts',
  covers: 'pages load on both hosts',
  async run(ctx) {
    const titles: string[] = [];
    for (const host of HOSTS) {
      const tabId = await ctx.open(`${host}/index.html`, { attach: false });
      titles.push((await chrome.tabs.get(tabId)).title ?? '');
    }
    return outcome(
      '"Fixtures" on localhost, 127.0.0.1 and [::1]',
      titles.join(', '),
      titles.every(t => t === 'Fixtures'),
    );
  },
});

defineScenario({
  id: 'A2-nested-frames',
  set: 'A',
  title: 'Cross-site iframes nested two deep',
  covers: 'a control in a cross-origin iframe, nested two deep, is captured through its own session',
  async run(ctx) {
    const tabId = await ctx.open(`${FIXTURE_ORIGIN}/frames-nested.html`);
    await sleep(800);
    const frames = (await frameReport(tabId)).frames;
    const snap = await ctx.call('snapshot');
    const sessions = new Set(frames.map(f => f.session)).size;
    const inner = /\[\w+\] button "Grandchild button"/.test(snap.page?.snapshot ?? '');
    return outcome(
      '3 frames on 3 sessions; the grandchild button has a ref in the outline',
      `${frames.length} frames on ${sessions} sessions; grandchild button ${inner ? 'has a ref' : 'missing'}`,
      frames.length === 3 && sessions === 3 && inner,
      snap.page?.snapshot,
    );
  },
});

defineScenario({
  id: 'A3-closed-shadow',
  set: 'A',
  title: 'A closed shadow root',
  covers: 'a control in a closed shadow root is captured (acting on it: set C)',
  async run(ctx) {
    await ctx.open(`${FIXTURE_ORIGIN}/shadow-closed.html`);
    const text = (await ctx.call('snapshot')).page?.snapshot ?? '';
    const ok =
      /\[\w+\] textbox "Shadow field" = "inside closed root"/.test(text) && /\[\w+\] button "Shadow button"/.test(text);
    return outcome('The field and the button inside the closed root have refs', ok ? 'both present' : text, ok);
  },
});

defineScenario({
  id: 'A4-large-table',
  set: 'A',
  title: 'A large table is cut to the budget, and says so',
  covers: 'budget applied before the known set; what is cut is stated',
  async run(ctx) {
    const tabId = await ctx.open(`${FIXTURE_ORIGIN}/large-table.html`);
    const snap = await ctx.call('snapshot');
    const data = snap.data as SnapshotData;
    const text = snap.page?.snapshot ?? '';
    const printed = [...text.matchAll(/\[(\w+)\]/g)].map(m => m[1]);
    // With layout, the window leaves most rows out before the budget is reached; either notice states it.
    const cutNotice = data.notices.find(n => n.startsWith('… outline cut') || n.includes('below the window'));
    // A ref that exists but was cut is rejected (REF_NOT_PRESENTED) until find shows it.
    const { controller } = await layer();
    const shown = new Set(printed);
    const cutRecord = controller.registry.live(tabId).find(r => !shown.has(r.ref) && r.print.role === 'link');
    const cut = cutRecord?.ref ?? '';
    const before = (await ctx.call('read', { ref: cut })).error?.code;
    const find = await ctx.call('find', { role: 'link', name: cutRecord?.print.name ?? '?' });
    const found = ((find.data as Array<{ ref: string }> | undefined) ?? []).map(m => m.ref);
    const after = (await ctx.call('read', { ref: cut })).ok;
    const pass =
      !!cutNotice &&
      // The budget counts the outline; the header line (title, URL, viewport) comes on top.
      text.length - text.indexOf('\n') - 1 <= 30_000 &&
      data.refs === printed.length &&
      before === 'REF_NOT_PRESENTED' &&
      found.includes(cut) &&
      after;
    return outcome(
      'outline within 30,000 characters with a notice saying what was left out; printed refs equal the refs counted; a cut ref is REF_NOT_PRESENTED until find shows it',
      `${text.length} characters, ${printed.length} printed refs (data.refs ${data.refs}); notice: ${cutNotice ?? 'none'}; cut ref ${cut}: ${before}, then ${after ? 'accepted' : 'rejected'} after find (${found.length} matches)`,
      pass,
    );
  },
});

defineScenario({
  id: 'A5-network-endpoints',
  set: 'A',
  title: 'Redirect, form post and slow request reach the counters',
  covers: 'a redirect and a form post show up in the request counters',
  async run(ctx) {
    await resetRequests();
    const tabId = await ctx.open(`${FIXTURE_ORIGIN}/network.html`);
    let load = waitForLoad(tabId);
    await evaluate(tabId, undefined, `document.getElementById('redirect-link').click()`);
    const landed = (await load).url;
    await ctx.call('navigate', { url: `${FIXTURE_ORIGIN}/network.html` });
    load = waitForLoad(tabId);
    await evaluate(tabId, undefined, `document.getElementById('post-form').requestSubmit()`);
    await load;
    const start = performance.now();
    await fetch(`${FIXTURE_ORIGIN}/api/slow?ms=300`);
    const slow = Math.round(performance.now() - start);
    const c = await readRequests();
    const host = `localhost:${FIXTURE_PORT}`;
    const counts = [countOf(c, 'GET', '/redirect', host), countOf(c, 'POST', '/submit', host), c.posts[0]?.body];
    return outcome(
      'landed on network-landed.html; 1 redirect, 1 post with name=Ada; slow request ≥ 300 ms',
      `landed ${landed}; redirects ${counts[0]}, posts ${counts[1]} (${counts[2]}); slow ${slow} ms`,
      landed === `${FIXTURE_ORIGIN}/network-landed.html` &&
        counts[0] === 1 &&
        counts[1] === 1 &&
        counts[2] === 'name=Ada' &&
        slow >= 300,
    );
  },
});
