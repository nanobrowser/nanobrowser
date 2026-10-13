// A conversation's layer session as the extension makes it: the hand-over policy, the agent's own labels for the
// boundary, `human` for ask_user, no clock on write cards, 15 minutes for ask_user, and the host's write policy,
// blocked sites and tab placement passed in.
import type { Controller, Session, SessionConfig, TabsData } from '@src/browser-control';
import type { LayerPort } from '@src/agent/ports';

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

/** The loop's view of a session (src/agent/ports.ts). */
export function layerPort(session: Session): LayerPort {
  return {
    call: (tool, args, signal) => session.call(tool, args, { signal }),
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
