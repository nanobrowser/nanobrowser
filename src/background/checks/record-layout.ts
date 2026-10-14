// Records raw DOMSnapshot payloads of fixture pages, for tier 2 unit tests.
import { captureTier1 } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { attach } from '../spike-session';
import { defineCheck } from './registry';
import { sleep, withTab } from './helpers';
import { SNAPSHOT_STYLES } from './capture-timing';

defineCheck({
  name: 'record-layout',
  title: 'Record layout snapshots',
  description:
    'Captures tier 1 plus raw DOMSnapshot.captureSnapshot per session for fixture pages. Arguments: {"pages": [...]}.',
  async run(args) {
    const pages = (args.pages as string[] | undefined) ?? ['/d-clickables.html', '/form.html', '/frames-nested.html'];
    const out: Record<string, unknown> = {};
    for (const page of pages) {
      out[page] = await withTab(FIXTURE_ORIGIN + page, async tab => {
        const a = await attach(tab.tabId);
        await sleep(800);
        const capture = await captureTier1(tab.tabId, a.cdp, a.topology, { enabledSessions: new Set() });
        const sessions = [...new Set(capture.frames.map(f => f.sessionId))];
        const snapshots: Record<string, unknown> = {};
        for (const s of sessions) {
          snapshots[s ?? 'root'] = await a.cdp.send(
            s,
            'DOMSnapshot.captureSnapshot',
            {
              computedStyles: SNAPSHOT_STYLES,
              includeDOMRects: true,
              includePaintOrder: false,
            },
            10_000,
          );
        }
        return { capture, snapshots };
      });
    }
    return out;
  },
});
