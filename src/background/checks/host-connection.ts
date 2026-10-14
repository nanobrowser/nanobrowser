// The host connection. Per-command timeouts, event fan-out keyed by (tab, session), detach handling, restricted pages,
// and FrameTopology loader IDs.
import { CdpTimeoutError, LayerError } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { attach } from '../spike-session';
import { defineCheck } from './registry';
import { assert, sleep, withTab } from './helpers';

defineCheck({
  name: 'host-connection',
  title: 'Host connection',
  description:
    'Timeout of a command that never answers; console events from a child session reach only subscribers of that session; closing the tab rejects a pending command with DEBUGGER_DETACHED; closing the connection detaches once, with no refused detach; chrome:// pages give PAGE_NOT_SUPPORTED; every frame has a loader ID.',
  async run() {
    const results: Record<string, unknown> = {};

    await withTab(`${FIXTURE_ORIGIN}/frames-nested.html`, async tab => {
      const a = await attach(tab.tabId);
      await sleep(800);
      const frames = await a.topology.frames();
      assert(frames.length === 3 && frames.every(f => f.loaderId), 'every frame has a loader ID');
      assert(frames[0].sessionId === undefined, 'the main frame is on the root session');
      results.frames = frames.map(f => ({ url: f.url, loaderId: f.loaderId, session: f.sessionId ?? 'root' }));

      // Timeout: a promise that never settles.
      const start = performance.now();
      const timeout = await a.cdp
        .send(undefined, 'Runtime.evaluate', { expression: 'new Promise(() => {})', awaitPromise: true }, 300)
        .then(
          () => 'answered',
          (e: unknown) => (e instanceof CdpTimeoutError ? 'timeout' : String(e)),
        );
      assert(timeout === 'timeout', `expected a timeout, got ${timeout}`);
      results.timeoutMs = Math.round(performance.now() - start);

      // Fan-out: a console message in the grandchild reaches its session's subscriber and the tab-wide one only.
      const grandchild = frames.find(f => f.depth === 2)!;
      const child = frames.find(f => f.depth === 1)!;
      const seen: string[] = [];
      for (const f of frames) await a.cdp.send(f.sessionId, 'Runtime.enable');
      const offs = [
        a.cdp.on('Runtime.consoleAPICalled', () => seen.push('grandchild'), { sessionId: grandchild.sessionId }),
        a.cdp.on('Runtime.consoleAPICalled', () => seen.push('child'), { sessionId: child.sessionId }),
        a.cdp.on('Runtime.consoleAPICalled', (_p, s) =>
          seen.push(`any:${s === grandchild.sessionId ? 'grandchild' : s}`),
        ),
      ];
      await a.cdp.send(grandchild.sessionId, 'Runtime.evaluate', { expression: 'console.log("fan-out")' });
      await sleep(200);
      offs.forEach(off => off());
      assert(seen.includes('grandchild') && !seen.includes('child'), `fan-out by session: ${seen.join(', ')}`);
      assert(seen.includes('any:grandchild'), 'tab-wide subscriber sees the event with its session');
      results.fanOut = seen;

      // Detach: close the tab while a command is pending.
      const pending = a.cdp.send(
        undefined,
        'Runtime.evaluate',
        { expression: 'new Promise(r => setTimeout(r, 4000))', awaitPromise: true },
        4500,
      );
      const detachedReason = new Promise<string>(resolve => a.onDetach(info => resolve(info.reason)));
      await chrome.tabs.remove(tab.tabId);
      const outcome = await pending.then(
        () => 'answered',
        (e: unknown) => (e instanceof LayerError ? e.code : String(e)),
      );
      results.detach = { outcome, reason: await detachedReason, flag: a.detached };
      assert(outcome === 'DEBUGGER_DETACHED', `pending command after tab close: ${outcome}`);
      const after = await a.cdp.send(undefined, 'Runtime.evaluate', { expression: '1' }).then(
        () => 'answered',
        (e: unknown) => (e instanceof LayerError ? e.code : String(e)),
      );
      assert(after === 'DEBUGGER_DETACHED', `command after detach: ${after}`);
    });

    // Close: the layer detaches once, so nothing is left for Chrome to refuse as an unhandled rejection.
    await withTab(`${FIXTURE_ORIGIN}/frames-nested.html`, async tab => {
      const refused: string[] = [];
      const onRejection = (event: PromiseRejectionEvent) => refused.push(String(event.reason));
      self.addEventListener('unhandledrejection', onRejection);
      try {
        const a = await attach(tab.tabId);
        await a.close();
        await sleep(500);
      } finally {
        self.removeEventListener('unhandledrejection', onRejection);
      }
      results.closeRejections = refused;
      assert(!refused.some(r => /not attached/i.test(r)), `close left a refused detach: ${refused.join('; ')}`);
    });

    await withTab('chrome://version', async tab => {
      const outcome = await attach(tab.tabId).then(
        () => 'attached',
        (e: unknown) => (e instanceof LayerError ? e.code : String(e)),
      );
      results.restricted = outcome;
      assert(outcome === 'PAGE_NOT_SUPPORTED', `chrome:// page: ${outcome}`);
    });
    return results;
  },
});
