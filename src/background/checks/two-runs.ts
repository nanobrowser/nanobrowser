// Two runs act at once in one window: two conversations, each with its panel and its own page in the same window, click
// on their pages while both runs are working.
import { activeBranch, listConversations } from '@src/store/conversations';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { FIXTURE_PROVIDER, panel, scriptReplies, seedFixtureModel } from './panel-chat';

const click = { toolCalls: [{ name: 'click', input: { target: { role: 'button', name: 'Add a row' } } }] };
const look = { toolCalls: [{ name: 'snapshot', input: {} }] };
const done = { toolCalls: [{ name: 'done', input: { outcome: 'success', summary: 'Added a row.' } }] };

defineCheck({
  name: 'two-runs',
  title: 'Two runs at once in one window',
  description: 'Two conversations click on their own pages in one window while both runs work.',
  async run() {
    await seedFixtureModel();
    // The fixture is an OpenAI-compatible endpoint, which has no limit on requests at once.
    await chrome.storage.local.set({ 'nb.providers': [FIXTURE_PROVIDER] });
    // The fake model serves replies in order to whichever run asks; the delayed first two keep both runs working at
    // once, and every reply fits either run.
    await scriptReplies([{ ...click, delayMs: 1200 }, { ...click, delayMs: 1200 }, look, look, done, done]);
    const window = (await chrome.windows.getCurrent()).id!;
    const pages = await Promise.all(
      [0, 1].map(() =>
        chrome.tabs.create({ windowId: window, url: `${FIXTURE_ORIGIN}/c-effects.html`, active: false }),
      ),
    );
    for (const p of pages) await waitForLoad(p.id!);
    const views = await Promise.all(
      pages.map(p =>
        chrome.tabs.create({
          windowId: window,
          url: chrome.runtime.getURL(`/sidepanel.html#tab=${p.id}`),
          active: false,
        }),
      ),
    );
    for (const v of views) await waitForLoad(v.id!);
    await sleep(600);
    const startedAt = Date.now();
    try {
      await Promise.all(pages.map((p, i) => panel(p.id!, 'type-send', { text: `Add a row on page ${i + 1}` })));
      for (let i = 0; i < 80; i++) {
        const statuses = await Promise.all(pages.map(async p => (await panel(p.id!, 'read')).status));
        if (statuses.every(s => s === 'Done')) break;
        await sleep(200);
      }
      const conversations = (await listConversations()).filter(c => /^Add a row on page/.test(c.title));
      const report: Record<string, unknown> = {};
      const windows = new Set<number>();
      for (const c of conversations) {
        const branch = await activeBranch(c.id);
        const clicks = branch.flatMap(e =>
          e.type === 'message' && e.message.role === 'tool'
            ? e.message.parts.filter(p => p.type === 'tool-result' && p.toolName === 'click' && !p.isError)
            : [],
        );
        const intents = branch
          .filter(e => e.type === 'intent' && e.tool === 'click')
          .map(e => Date.parse(e.at) - startedAt);
        for (const tabId of c.tabs) windows.add((await chrome.tabs.get(tabId)).windowId);
        report[c.title] = { status: c.status, clicks: clicks.length, clickAtMs: intents };
      }
      const rows = conversations.map(c => report[c.title] as { status: string; clicks: number; clickAtMs: number[] });
      // Both clicks were dispatched within one reply's delay of each other: the runs were working at the same time.
      const times = rows.flatMap(r => r.clickAtMs);
      const overlap = times.length === 2 && Math.abs(times[0] - times[1]) < 1000;
      report.oneWindow = windows.size === 1;
      report.overlap = overlap;
      if (
        rows.length !== 2 ||
        rows.some(r => r.status !== 'done' || r.clicks !== 1) ||
        !overlap ||
        windows.size !== 1
      ) {
        throw new Error(JSON.stringify(report));
      }
      return report;
    } finally {
      for (const t of [...views, ...pages]) await chrome.tabs.remove(t.id!).catch(() => undefined);
      await chrome.storage.local.set({ 'nb.providers': [FIXTURE_PROVIDER] });
    }
  },
});
