// Labelled screenshots of real sites, to check by eye that every visible clickable has a ref.
import type { ScreenshotData, SnapshotData } from '@src/browser-control';
import { layer } from '../layer';
import { attach } from '../spike-session';
import { defineCheck } from './registry';
import { sleep, withTab } from './helpers';

defineCheck({
  name: 'real-site-labels',
  title: 'Real-site labelled screenshots',
  description: 'Snapshot and a labelled viewport screenshot per site. Arguments: {"urls": [...]}.',
  async run(args) {
    const urls = (args.urls as string[] | undefined) ?? [
      'https://news.ycombinator.com/',
      'https://github.com/puppeteer/puppeteer',
      'https://www.bbc.com/news',
      'https://stackoverflow.com/questions',
    ];
    const { session } = await layer();
    const out = [];
    for (const url of urls) {
      out.push(
        await withTab(url, async tab => {
          await sleep(3000);
          await attach(tab.tabId);
          const snap = await session.call('snapshot', { tabId: tab.tabId, window: 'viewport' });
          const shot = await session.call('screenshot', { tabId: tab.tabId, labels: true });
          const data = shot.data as ScreenshotData | undefined;
          await session.unshareTab(tab.tabId);
          return {
            url,
            refs: (snap.data as SnapshotData | undefined)?.refs,
            outline: snap.page?.snapshot?.slice(0, 3000),
            image: data ? `data:image/png;base64,${data.base64}` : shot.text,
          };
        }),
      );
    }
    return out;
  },
});
