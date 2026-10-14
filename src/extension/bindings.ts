// TabScope: which conversation each tab belongs to, how it came to be there, and each conversation's tab group. The
// panel's address carries nothing: the worker keeps the map, in storage.session, since tab IDs do not outlive the
// browser session. Grouping needs no permission; the group's title and colour need tabGroups, which is optional.
import { siteOf } from '@src/browser-control';
import type { RunStatus } from '@src/store/types';
import type { ScopeTab } from '@src/ui/protocol';
import { PANEL_PATH } from './panel';

const KEY = 'nb.scope';

interface ScopeState {
  tabs: Record<string, { conversationId: string; origin: ScopeTab['origin'] }>;
  groups: Record<string, { groupId: number; windowId: number }>;
}

let cache: ScopeState | null = null;

async function load(): Promise<ScopeState> {
  if (cache) return cache;
  const stored = (await chrome.storage.session.get(KEY))[KEY] as ScopeState | undefined;
  cache = stored ?? { tabs: {}, groups: {} };
  return cache;
}

async function save(): Promise<void> {
  if (cache) await chrome.storage.session.set({ [KEY]: cache });
}

// Never red: a red group reads as an error.
const COLORS = ['blue', 'purple', 'cyan', 'green', 'orange', 'pink', 'yellow'] as const;

function colorOf(conversationId: string): chrome.tabGroups.Color {
  let h = 0;
  for (const c of conversationId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  // @types/chrome types the colours as an enum of these same strings.
  return COLORS[h % COLORS.length] as unknown as chrome.tabGroups.Color;
}

const PREFIX: Partial<Record<RunStatus, string>> = { running: '● ', awaiting_user: '! ' };

export interface ScopeHooks {
  /** The sites the user blocked (a tab on one is not shared). */
  blocked(): string[];
  /**
   * The scope of a conversation changed: its panels get the new list, its session the new tabs. Called with no tabs
   * added or removed when a tab's title, address or icon changed.
   */
  changed(conversationId: string, added: number[], removed: number[]): void;
}

export class TabScope {
  /** The tab that was visible before the current one, per window: a page-opened tab is put back behind it (5.3). */
  #previousActive = new Map<number, number>();
  #currentActive = new Map<number, number>();
  /** Group changes the scope makes itself, so its own listener ignores them. */
  #grouping = new Set<number>();

  constructor(readonly hooks: ScopeHooks) {
    chrome.tabs.onRemoved.addListener(tabId => void this.#forget(tabId));
    chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
      const current = this.#currentActive.get(windowId);
      if (current !== undefined && current !== tabId) this.#previousActive.set(windowId, current);
      this.#currentActive.set(windowId, tabId);
    });
    chrome.tabs.onUpdated.addListener((tabId, info) => {
      if (info.groupId !== undefined) void this.#groupChanged(tabId, info.groupId);
      // The panels show each tab's title, address and icon, which change as its page loads.
      if (info.title !== undefined || info.url !== undefined || info.favIconUrl !== undefined) void this.#shown(tabId);
    });
  }

  async #shown(tabId: number): Promise<void> {
    const conversationId = await this.conversationOf(tabId);
    if (conversationId) this.hooks.changed(conversationId, [], []);
  }

  async conversationOf(tabId: number): Promise<string | null> {
    return (await load()).tabs[tabId]?.conversationId ?? null;
  }

  /** The conversation's tabs: the one it started in first, then the ones the user shared, then the agent's. */
  async tabsOf(conversationId: string): Promise<number[]> {
    const state = await load();
    const rank = { start: 0, user: 1, agent: 2 };
    return Object.entries(state.tabs)
      .filter(([, b]) => b.conversationId === conversationId)
      .sort(([, a], [, b]) => rank[a.origin] - rank[b.origin])
      .map(([tab]) => Number(tab));
  }

  /** Every tab that belongs to a conversation. */
  async scopedTabs(): Promise<number[]> {
    return Object.keys((await load()).tabs).map(Number);
  }

  async originOf(tabId: number): Promise<ScopeTab['origin'] | null> {
    return (await load()).tabs[tabId]?.origin ?? null;
  }

  /** The conversation's tabs as its panels show them. */
  async scopeTabs(conversationId: string): Promise<ScopeTab[]> {
    const state = await load();
    const out: ScopeTab[] = [];
    for (const [id, b] of Object.entries(state.tabs)) {
      if (b.conversationId !== conversationId) continue;
      const tab = await chrome.tabs.get(Number(id)).catch(() => null);
      if (tab)
        out.push({
          tabId: tab.id!,
          title: tab.title ?? '',
          url: tab.url ?? '',
          favIconUrl: tab.favIconUrl,
          origin: b.origin,
        });
    }
    return out;
  }

  /**
   * Shares a tab with a conversation, as one operation: the tab joins the conversation's group, the conversation's
   * panel is enabled on it, and it is bound. A tab on a blocked site stays out; a tab another conversation owns is
   * refused unless `move` says the user agreed.
   */
  async add(
    conversationId: string,
    tabId: number,
    origin: ScopeTab['origin'],
    options: { move?: boolean } = {},
  ): Promise<{ ok: true } | { ok: false; reason: 'blocked' | 'owned' | 'gone'; owner?: string }> {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return { ok: false, reason: 'gone' };
    const site = siteOf(tab.url ?? tab.pendingUrl ?? '');
    if (site && this.hooks.blocked().includes(site)) return { ok: false, reason: 'blocked' };
    const state = await load();
    const current = state.tabs[tabId];
    if (current && current.conversationId !== conversationId) {
      if (!options.move) return { ok: false, reason: 'owned', owner: current.conversationId };
      // The panel stays: disabling it would close the panel the user is looking at (a conversation from Recent tasks
      // taken up in this tab), and enabling it again does not reopen it.
      await this.remove(current.conversationId, tabId, { ungroup: false, keepPanel: true });
    }
    if (current?.conversationId === conversationId) return { ok: true };
    state.tabs[tabId] = { conversationId, origin };
    await save();
    await this.#group(conversationId, tab);
    // The panel follows the group: the conversation's panel is enabled on every tab in it.
    await chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true }).catch(() => undefined);
    this.hooks.changed(conversationId, [tabId], []);
    return { ok: true };
  }

  /** Unshares a tab: it leaves the group, its panel is disabled, and it stays open. */
  async remove(
    conversationId: string,
    tabId: number,
    options: { ungroup?: boolean; keepPanel?: boolean } = {},
  ): Promise<void> {
    const state = await load();
    if (state.tabs[tabId]?.conversationId !== conversationId) return;
    delete state.tabs[tabId];
    await save();
    if (options.ungroup !== false) {
      this.#grouping.add(tabId);
      await chrome.tabs.ungroup(tabId).catch(() => undefined);
      this.#grouping.delete(tabId);
    }
    if (!options.keepPanel) await chrome.sidePanel.setOptions({ tabId, enabled: false }).catch(() => undefined);
    await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => undefined);
    this.hooks.changed(conversationId, [], [tabId]);
  }

  /** Moves a tab out of its conversation to none, keeping its panel (New chat on a tab). */
  async detach(tabId: number): Promise<void> {
    const owner = await this.conversationOf(tabId);
    if (owner) await this.remove(owner, tabId, { keepPanel: true });
  }

  /**
   * The end of a conversation: shared tabs are ungrouped and keep their pages; the tabs the agent opened are closed
   * when the user said so.
   */
  async release(conversationId: string, closeAgentTabs: boolean): Promise<void> {
    const state = await load();
    for (const [id, b] of Object.entries(state.tabs)) {
      if (b.conversationId !== conversationId) continue;
      const tabId = Number(id);
      if (b.origin === 'agent' && closeAgentTabs) {
        delete state.tabs[tabId];
        await chrome.tabs.remove(tabId).catch(() => undefined);
      } else {
        await this.remove(conversationId, tabId, { keepPanel: b.origin === 'start' });
      }
    }
    delete state.groups[conversationId];
    await save();
  }

  async agentTabCount(conversationId: string): Promise<number> {
    const state = await load();
    return Object.values(state.tabs).filter(b => b.conversationId === conversationId && b.origin === 'agent').length;
  }

  /** The group's title and the toolbar badge on its tabs. */
  async status(conversationId: string, status: RunStatus, title: string): Promise<void> {
    const state = await load();
    const group = state.groups[conversationId];
    const short = title.length > 24 ? `${title.slice(0, 23)}…` : title;
    // The title and colour need the tabGroups permission, which the user may not have allowed yet (the badge needs none).
    if (group && chrome.tabGroups) {
      await chrome.tabGroups
        .update(group.groupId, {
          color: colorOf(conversationId),
          title: `${PREFIX[status] ?? ''}Nanobrowser · ${short || 'chat'}`,
        })
        .catch(() => undefined);
    }
    const text = status === 'awaiting_user' || status === 'interrupted' ? '!' : status === 'running' ? '•' : '';
    for (const tabId of await this.tabsOf(conversationId)) {
      await chrome.action.setBadgeText({ tabId, text }).catch(() => undefined);
      if (text) {
        await chrome.action
          .setBadgeBackgroundColor({ tabId, color: text === '!' ? '#d97706' : '#2563eb' })
          .catch(() => undefined);
      }
    }
  }

  /**
   * The watching rule: the view follows the agent only while the user is on one of the conversation's tabs. Never
   * focuses a window.
   */
  async watching(conversationId: string): Promise<boolean> {
    const tabs = await this.tabsOf(conversationId);
    if (!tabs.length) return false;
    const first = await chrome.tabs.get(tabs[0]).catch(() => null);
    if (!first) return false;
    const [active] = await chrome.tabs.query({ active: true, windowId: first.windowId });
    return active?.id !== undefined && tabs.includes(active.id);
  }

  /** A page opened a tab from a background tab and Chrome brought it forward: the user's tab goes back on top. */
  async restoreView(tabId: number): Promise<void> {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.active) return;
    const previous = this.#previousActive.get(tab.windowId);
    if (previous !== undefined) await chrome.tabs.update(previous, { active: true }).catch(() => undefined);
  }

  async #group(conversationId: string, tab: chrome.tabs.Tab): Promise<void> {
    const state = await load();
    const group = state.groups[conversationId];
    this.#grouping.add(tab.id!);
    try {
      // The group stays in the window the conversation started in. Whether it still exists is asked of tabs.query,
      // which needs no permission, since tabGroups is optional.
      const exists = group && (await chrome.tabs.query({ groupId: group.groupId }).catch(() => [])).length > 0;
      if (group && exists) {
        if (tab.windowId !== group.windowId) {
          await chrome.tabs.move(tab.id!, { windowId: group.windowId, index: -1 }).catch(() => undefined);
        }
        await chrome.tabs.group({ groupId: group.groupId, tabIds: [tab.id!] });
      } else {
        const groupId = await chrome.tabs.group({ tabIds: [tab.id!], createProperties: { windowId: tab.windowId } });
        // Without the tabGroups permission the group keeps no title and Chrome's default colour.
        if (chrome.tabGroups) {
          await chrome.tabGroups
            .update(groupId, { color: colorOf(conversationId), title: 'Nanobrowser' })
            .catch(() => undefined);
        }
        state.groups[conversationId] = { groupId, windowId: tab.windowId };
        await save();
      }
    } catch (error) {
      console.warn('[scope] grouping failed', error);
    } finally {
      this.#grouping.delete(tab.id!);
    }
  }

  /** The user dragged a tab into a group or out of one. */
  async #groupChanged(tabId: number, groupId: number): Promise<void> {
    if (this.#grouping.has(tabId)) return;
    const state = await load();
    const owner = state.tabs[tabId]?.conversationId;
    const joined = Object.entries(state.groups).find(([, g]) => g.groupId === groupId)?.[0];
    if (owner && owner !== joined) await this.remove(owner, tabId, { ungroup: false, keepPanel: !!joined });
    if (joined && owner !== joined) {
      const result = await this.add(joined, tabId, 'user', { move: true });
      // A tab on a blocked site is kept out of the group.
      if (!result.ok && result.reason === 'blocked') await chrome.tabs.ungroup(tabId).catch(() => undefined);
    }
  }

  async #forget(tabId: number): Promise<void> {
    const state = await load();
    const binding = state.tabs[tabId];
    if (!binding) return;
    delete state.tabs[tabId];
    await save();
    this.hooks.changed(binding.conversationId, [], [tabId]);
  }
}
