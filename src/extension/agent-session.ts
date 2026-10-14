// A conversation's layer session as the extension makes it: the hand-over policy, the agent's own labels for the
// boundary, `human` for ask_user, no clock on write cards, 15 minutes for ask_user, and the host's write policy,
// blocked sites and tab placement passed in.
import type { Controller, Session, SessionConfig, TabsData } from '@src/browser-control';
import type { LayerPort } from '@src/agent/ports';
import type { PageBorder } from './border';

/** The extension's labels, defused wherever page text holds them. */
export const AGENT_LABELS = ['[Nanobrowser note', 'browser-state', 'agent-notes', 'custom-instructions'];

/** ask_user waits 15 minutes in agent sessions: a person may be in another window. */
export const ASK_TIMEOUT_MS = 15 * 60_000;

export function createAgentSession(controller: Controller, config: SessionConfig = {}): Session {
  return controller.createSession({
    capabilities: ['human', 'files'],
    // Files come from chat attachments only, never a path on the user's disk.
    uploadSources: ['attachments'],
    handover: true,
    confirmTimeoutMs: Infinity,
    askTimeoutMs: ASK_TIMEOUT_MS,
    boundary: { labels: AGENT_LABELS },
    ...config,
  });
}

/**
 * The tab a `screenshot` captures, found as the session finds it: a ref names its own tab, then `tabId`, then the
 * session's active tab. Null for a ref the session does not know: the call fails, and nothing needs hiding.
 */
export function screenshotTab(session: Session, args: Record<string, unknown>): number | null {
  if (typeof args.ref === 'string') return session.controller.registry.get(args.ref)?.tabId ?? null;
  if (typeof args.tabId === 'number') return args.tabId;
  return session.activeTabId;
}

/** A page dialog blocks the page: a script put into it would wait until the dialog is closed. */
function dialogOpen(session: Session, tabId: number): boolean {
  return session.hasTab(tabId) && session.controller.tabState(tabId).pending.some(m => m.kind === 'dialog');
}

/** The loop's view of a session (src/agent/ports.ts). A screenshot fades the page border out first. */
export function layerPort(session: Session, border?: Pick<PageBorder, 'around'>): LayerPort {
  return {
    call: (tool, args, signal) => {
      const run = () => session.call(tool, args, { signal });
      if (tool !== 'screenshot' || !border) return run();
      const tabId = screenshotTab(session, args);
      if (tabId === null || dialogOpen(session, tabId)) return run();
      return border.around(tabId, run);
    },
    async tabs() {
      const result = await session.call('tabs', { action: 'list' });
      return (result.data as TabsData | undefined) ?? { tabs: [], activeTabId: session.activeTabId };
    },
    tabInfo(tabId) {
      if (!session.hasTab(tabId)) return null;
      const state = session.controller.tabState(tabId);
      return { rev: state.rev, pending: [...state.pending] };
    },
    wrap: (text, source) => session.wrap(text, source),
  };
}
