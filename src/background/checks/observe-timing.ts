// Observe time with the full pipeline (snapshot through the controller) on the sites of the capture timing check.
import type { SnapshotData } from '@src/browser-control';
import { layer } from '../layer';
import { attach } from '../spike-session';
import { DEFAULT_SITES } from './capture-timing';
import { defineCheck } from './registry';
import { sleep, withTab } from './helpers';

export const HEAVY_SITES = [
  'https://github.com/torvalds/linux/blob/master/MAINTAINERS',
  'https://en.wikipedia.org/wiki/List_of_sovereign_states',
  'https://www.theguardian.com/international',
  'https://www.ebay.com/',
  'https://x.com/explore',
  'https://www.google.com/search?q=chrome+devtools+protocol',
];

defineCheck({
  name: 'observe-timing',
  title: 'Observe timing, full pipeline',
  description:
    'For each site: share the tab with the session and call snapshot several times; records round trip, capture time, outline size and refs. Arguments: {"urls": [...], "iterations": 5}.',
  async run(args) {
    const urls = (args.urls as string[] | undefined) ?? [...DEFAULT_SITES, ...HEAVY_SITES];
    const iterations = Number(args.iterations ?? 5);
    const { session } = await layer();
    const sites = [];
    for (const url of urls) {
      try {
        sites.push(
          await withTab(url, async tab => {
            await sleep(Number(args.settleMs ?? 3000));
            await attach(tab.tabId);
            await sleep(1000);
            const runs = [];
            for (let i = 0; i < iterations; i++) {
              const start = performance.now();
              const r = await session.call('snapshot', { tabId: tab.tabId });
              const ms = Math.round(performance.now() - start);
              const data = r.data as SnapshotData | undefined;
              runs.push({
                ms,
                ok: r.ok,
                error: r.error?.code,
                captureMs: data?.captureMs,
                refs: data?.refs,
                chars: r.page?.snapshot?.length,
                status: data?.status,
                frames: data?.frames,
                notices: i === iterations - 1 ? data?.notices : undefined,
              });
            }
            await session.unshareTab(tab.tabId);
            return { url, title: (await chrome.tabs.get(tab.tabId)).title, runs };
          }),
        );
      } catch (error) {
        sites.push({ url, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { iterations, sites };
  },
});
