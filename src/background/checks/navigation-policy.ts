// Navigate, tabs open and close, and the navigation policy: a URL checked before any command is sent, a request blocked
// at the network, and a page detected after it committed. 127.0.0.1 plays the denied site; the server's request
// counters prove what reached it.
import type { Result, TabsData } from '@src/browser-control';
import { FIXTURE_CROSS_ORIGIN, FIXTURE_ORIGIN, FIXTURE_PORT } from '../fixtures-config';
import { layer } from '../layer';
import { attach } from '../spike-session';
import { defineCheck } from './registry';
import { assert, countOf, evaluate, readRequests, resetRequests, sleep, withTab } from './helpers';

const DENIED_HOST = `127.0.0.1:${FIXTURE_PORT}`;
const deniedHits = async () =>
  (await readRequests()).requests.filter(r => r.host === DENIED_HOST).reduce((n, r) => n + r.count, 0);

defineCheck({
  name: 'navigation-policy',
  title: 'Navigation and its policy',
  description:
    'With 127.0.0.1 denied: navigate to it, and to an allowed URL that redirects to it, by the tool and by page script; back to a denied history entry; a back-forward restore; tabs open and close. Nothing may reach the denied host.',
  async run() {
    const { session } = await layer();
    const out: Record<string, unknown> = {};
    const code = (r: Result) => r.error?.code ?? 'ok';
    try {
      // Blocked schemes need no list.
      await session.setUrlPolicy({ allow: [], deny: [] });
      await withTab(`${FIXTURE_ORIGIN}/network.html`, async tab => {
        await attach(tab.tabId);
        assert(
          code(await session.call('navigate', { url: 'chrome://settings' })) === 'URL_NOT_ALLOWED',
          'chrome:// blocked',
        );
        assert(code(await session.call('navigate', {})) === 'INVALID_ARGUMENT', 'navigate needs url or action');

        await session.setUrlPolicy({ allow: [], deny: ['127.0.0.1'] });
        await resetRequests();

        // Layer 1: a denied URL is refused before any command.
        const direct = await session.call('navigate', { url: `${FIXTURE_CROSS_ORIGIN}/network-landed.html` });
        assert(code(direct) === 'URL_NOT_ALLOWED', `direct: ${direct.text}`);
        out.direct = direct.text;

        // Layer 3: an allowed URL that redirects to the denied site; the hop is stopped, the page stays.
        const redirect = await session.call('navigate', {
          url: `${FIXTURE_ORIGIN}/redirect?to=${encodeURIComponent(`${FIXTURE_CROSS_ORIGIN}/network-landed.html`)}`,
        });
        assert(code(redirect) === 'URL_NOT_ALLOWED', `redirect: ${redirect.text}`);
        const stayed = (await chrome.tabs.get(tab.tabId)).url;
        assert(stayed === `${FIXTURE_ORIGIN}/network.html`, `page after blocked redirect: ${stayed}`);
        out.redirect = redirect.text;

        // Layer 3 for a navigation started by page script; reported in the next result.
        await evaluate(tab.tabId, undefined, `location.href = '${FIXTURE_CROSS_ORIGIN}/network-landed.html'; 1`);
        await sleep(800);
        const next = await session.call('tabs', { action: 'list' });
        assert(/policy: URL_NOT_ALLOWED/.test(next.text), `script navigation not reported: ${next.text}`);
        out.script = next.text;

        // An allowed navigation works and waits for readiness.
        const allowed = await session.call('navigate', {
          url: `${FIXTURE_ORIGIN}/network-landed.html`,
          observe: 'full',
        });
        assert(allowed.ok && allowed.page?.url === `${FIXTURE_ORIGIN}/network-landed.html`, `allowed: ${allowed.text}`);
        assert(allowed.page?.snapshot?.includes('Landed after the redirect'), 'observe full returns the outline');
        out.allowed = allowed.text.split('\n')[0];

        // Back and forward are checked against the history entry first.
        const back = await session.call('navigate', { action: 'back' });
        assert(back.ok, `back: ${back.text}`);
        const forward = await session.call('navigate', { action: 'forward' });
        assert(forward.ok, `forward: ${forward.text}`);

        const counters = await readRequests();
        out.counters = counters.requests;
        assert((await deniedHits()) === 0, 'nothing reached the denied host');
        assert(
          countOf(counters, 'GET', '/redirect', `localhost:${FIXTURE_PORT}`) === 1,
          'the allowed first hop was sent',
        );
      });

      // Layer 1 on history, and layer 3 or 4 on a back-forward restore started by script.
      await session.setUrlPolicy({ allow: [], deny: [] });
      await withTab(`${FIXTURE_CROSS_ORIGIN}/network.html`, async tab => {
        await attach(tab.tabId);
        assert((await session.call('navigate', { url: `${FIXTURE_ORIGIN}/network-landed.html` })).ok, 'to localhost');
        await session.setUrlPolicy({ allow: [], deny: ['127.0.0.1'] });
        await resetRequests();
        const back = await session.call('navigate', { action: 'back' });
        assert(code(back) === 'URL_NOT_ALLOWED', `back to a denied entry: ${back.text}`);
        await evaluate(tab.tabId, undefined, `history.back(); 1`);
        await sleep(1500);
        const report = await session.call('tabs', { action: 'list' });
        const url = (await chrome.tabs.get(tab.tabId)).url;
        assert(/policy: URL_NOT_ALLOWED/.test(report.text), `history.back by script not reported: ${report.text}`);
        assert(!url?.startsWith(FIXTURE_CROSS_ORIGIN), `still on the denied site: ${url}`);
        out.history = { back: back.text, report: report.text, url, deniedHits: await deniedHits() };
      });

      // tabs open is checked first, and starts blank so layer 3 covers its first request.
      const opened = await session.call('tabs', { action: 'open', url: `${FIXTURE_CROSS_ORIGIN}/index.html` });
      assert(code(opened) === 'URL_NOT_ALLOWED', `open denied: ${opened.text}`);
      const ok = await session.call('tabs', { action: 'open', url: `${FIXTURE_ORIGIN}/index.html` });
      assert(ok.ok, `open: ${ok.text}`);
      const openedId = (ok.data as TabsData & { opened: number }).opened;
      assert((await chrome.tabs.get(openedId)).url === `${FIXTURE_ORIGIN}/index.html`, 'opened tab loaded its URL');
      const viaRedirect = await session.call('tabs', {
        action: 'open',
        url: `${FIXTURE_ORIGIN}/redirect?to=${encodeURIComponent(`${FIXTURE_CROSS_ORIGIN}/index.html`)}`,
      });
      assert(code(viaRedirect) === 'URL_NOT_ALLOWED', `open via redirect: ${viaRedirect.text}`);
      const closed = await session.call('tabs', { action: 'close', tabId: openedId });
      assert(closed.ok && !(closed.data as TabsData).tabs.some(t => t.tabId === openedId), `close: ${closed.text}`);
      for (const t of session.tabIds()) {
        const info = await chrome.tabs.get(t).catch(() => null);
        if (info?.url === 'about:blank') await session.call('tabs', { action: 'close', tabId: t });
      }
      assert((await deniedHits()) === 0, 'nothing reached the denied host');
      out.tabs = [opened.text, ok.text, viaRedirect.text].map(t => t.split('\n')[0]);
      return out;
    } finally {
      await session.setUrlPolicy({ allow: [], deny: [] });
    }
  },
});
