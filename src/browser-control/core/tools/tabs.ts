// The `tabs` tool: the session's tabs. `open` and `close` are in navigate.ts, with the navigation policy.
import { LayerError } from '../../protocol/errors';
import type { TabsArgs } from '../../protocol/schemas';
import type { TabInfo, TabsData } from '../../protocol/results';
import type { ToolContext, ToolOutcome } from '../controller';
import { closeTab, openTab } from './navigate';
import { quote } from '../text';

export async function sessionTabs(ctx: ToolContext): Promise<TabsData> {
  const tabs: TabInfo[] = [];
  for (const tabId of ctx.session.tabIds()) {
    const tab = await ctx.controller.host.tabs.get(tabId);
    if (!tab) {
      ctx.session.forgetTab(tabId);
      continue;
    }
    tabs.push({ tabId, url: tab.url, title: tab.title, active: tabId === ctx.session.activeTabId });
  }
  return { tabs, activeTabId: ctx.session.activeTabId };
}

/** One line per tab, the tool's own, with the page's title and address quoted. */
function render(data: TabsData): string[] {
  return data.tabs.map(
    t => `${t.active ? '*' : ' '} tab ${t.tabId} · ${quote(t.title || '(untitled)')} · ${quote(t.url)}`,
  );
}

export async function tabs(ctx: ToolContext, args: TabsArgs): Promise<ToolOutcome<TabsData>> {
  switch (args.action) {
    case 'list':
      break;
    case 'select': {
      if (args.tabId === undefined) throw new LayerError('INVALID_ARGUMENT', 'tabs select needs tabId');
      ctx.session.setActive(args.tabId);
      // The session's current tab changes; whether it also becomes the visible tab is the host's decision, and the
      // window is never focused.
      if (await ctx.session.shouldReveal(args.tabId)) await ctx.controller.host.tabs.activate(args.tabId);
      break;
    }
    case 'open':
      return openTab(ctx, args);
    case 'close':
      return closeTab(ctx, args);
  }
  const data = await sessionTabs(ctx);
  return { data, lines: [`tabs · ${data.tabs.length} in session`, ...render(data)] };
}
