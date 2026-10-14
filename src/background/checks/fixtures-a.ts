// Fixture set A loads on every host, the cross-site frames have their own sessions, and a redirect, a form post and a
// slow request show up in the server's request counters.
import { FIXTURE_CROSS_ORIGIN, FIXTURE_ORIGIN, FIXTURE_PORT } from '../fixtures-config';
import { call } from '../rpc';
import { frameReport } from '../spike-session';
import { defineCheck } from './registry';
import { assert, countOf, evaluate, readRequests, resetRequests, sleep, waitForLoad, withTab } from './helpers';

const HOSTS = [FIXTURE_ORIGIN, FIXTURE_CROSS_ORIGIN, `http://[::1]:${FIXTURE_PORT}`];
const PAGES: Array<[string, string]> = [
  ['/index.html', 'Fixtures'],
  ['/frames-nested.html', 'Nested frames'],
  ['/shadow-closed.html', 'Closed shadow root'],
  ['/large-table.html', 'Large table'],
  ['/network.html', 'Network endpoints'],
];

defineCheck({
  name: 'fixtures-a',
  title: 'Fixture set A',
  description:
    'Pages load on all three hosts; nested cross-site frames have distinct sessions; the closed shadow root is closed; the table has 2,000 rows; a redirect, a form post and a slow request reach the request counters.',
  async run() {
    const loads: Record<string, string> = {};
    for (const host of HOSTS) {
      for (const [path, title] of PAGES) {
        const t = await withTab(host + path, async tab => (await chrome.tabs.get(tab.tabId)).title ?? '');
        loads[host + path] = t;
        assert(t === title, `${host}${path} has title "${t}", expected "${title}"`);
      }
    }

    const frames = await withTab(`${FIXTURE_ORIGIN}/frames-nested.html`, async tab => {
      await call('session.attach', { tabId: tab.tabId });
      await sleep(1000);
      return (await frameReport(tab.tabId)).frames;
    });
    assert(frames.length === 3, `expected 3 frames, got ${frames.length}`);
    assert(new Set(frames.map(f => f.sessionId)).size === 3, 'each cross-site frame should have its own session');

    const page = await withTab(`${FIXTURE_ORIGIN}/shadow-closed.html`, async tab => {
      await call('session.attach', { tabId: tab.tabId });
      return evaluate<{ closed: boolean }>(
        tab.tabId,
        undefined,
        `({ closed: document.querySelector('closed-widget').shadowRoot === null })`,
      );
    });
    assert(page.closed, 'shadow root should be closed');

    const rows = await withTab(`${FIXTURE_ORIGIN}/large-table.html`, async tab => {
      await call('session.attach', { tabId: tab.tabId });
      return evaluate<number>(tab.tabId, undefined, `document.querySelectorAll('#rows tr').length`);
    });
    assert(rows === 2000, `expected 2000 rows, got ${rows}`);

    await resetRequests();
    const landed = await withTab(`${FIXTURE_ORIGIN}/network.html`, async tab => {
      await call('session.attach', { tabId: tab.tabId });
      const load = waitForLoad(tab.tabId);
      await evaluate(tab.tabId, undefined, `document.getElementById('redirect-link').click()`);
      return (await load).url;
    });
    assert(landed === `${FIXTURE_ORIGIN}/network-landed.html`, `redirect landed on ${landed}`);

    const submitted = await withTab(`${FIXTURE_ORIGIN}/network.html`, async tab => {
      await call('session.attach', { tabId: tab.tabId });
      const load = waitForLoad(tab.tabId);
      await evaluate(tab.tabId, undefined, `document.getElementById('post-form').requestSubmit()`);
      return (await load).url;
    });
    assert(submitted === `${FIXTURE_ORIGIN}/submit`, `form post landed on ${submitted}`);

    const start = performance.now();
    await fetch(`${FIXTURE_ORIGIN}/api/slow?ms=300`);
    const slowMs = Math.round(performance.now() - start);
    assert(slowMs >= 300, `slow request answered after ${slowMs} ms`);

    const counters = await readRequests();
    const host = `localhost:${FIXTURE_PORT}`;
    const redirects = countOf(counters, 'GET', '/redirect', host);
    const landedCount = countOf(counters, 'GET', '/network-landed.html', host);
    const posts = countOf(counters, 'POST', '/submit', host);
    assert(redirects === 1, `expected 1 redirect, counted ${redirects}`);
    assert(landedCount === 1, `expected 1 landing, counted ${landedCount}`);
    assert(posts === 1, `expected 1 post, counted ${posts}`);
    assert(counters.posts[0]?.body === 'name=Ada', `recorded post body ${counters.posts[0]?.body}`);
    return { loads, frames, rows, landed, submitted, slowMs, counters };
  },
});
