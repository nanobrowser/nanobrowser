// Attach through Puppeteer, list frames with their IDs, send one raw command to a child session.
import { sendRaw } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { call } from '../rpc';
import { frameReport } from '../spike-session';
import type { TabSummary } from '../messages';
import { defineCheck } from './registry';

defineCheck({
  name: 'frame-tree',
  title: 'Frame tree and child session',
  description:
    'Opens a page with nested cross-site iframes, lists frames with frame, session and loader IDs from the Puppeteer accessors and from Page.getFrameTree, and evaluates location.href on each child session.',
  async run(args) {
    const url = (args.url as string | undefined) ?? `${FIXTURE_ORIGIN}/frames-nested.html`;
    const tab = await call<TabSummary>('tabs.open', { url });
    try {
      await call('session.attach', { tabId: tab.tabId });
      // Out-of-process frames attach asynchronously; give the frame manager a moment.
      await new Promise(resolve => setTimeout(resolve, 1000));
      const report = await frameReport(tab.tabId);
      const childSessions: Record<string, unknown> = {};
      for (const frame of report.frames) {
        if (!frame.sessionId) continue;
        const { result } = await sendRaw<{ result: { value: unknown } }>(
          tab.tabId,
          frame.sessionId,
          'Runtime.evaluate',
          { expression: 'location.href', returnByValue: true },
        );
        childSessions[frame.sessionId] = result.value;
      }
      return { ...report, childSessions };
    } finally {
      await call('session.detach', { tabId: tab.tabId }).catch(() => undefined);
      await call('tabs.close', { tabId: tab.tabId }).catch(() => undefined);
    }
  },
});
