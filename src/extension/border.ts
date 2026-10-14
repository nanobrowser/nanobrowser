// The page border: while a run works, a soft glow around each page of its conversation tells the user where the agent
// acts. The worker puts one small function into the top frame of those pages; it draws an element the layer does not
// see (on <html>, no pointer events, hidden from accessibility, its content in a closed shadow root). The border goes
// away when the run stops working, fades out for the model's screenshots, and can be turned off in Settings.
import { settingsStorage } from '@src/store/settings';
import type { RunStatus } from '@src/store/types';

export type BorderState = 'on' | 'hidden' | 'off';

export interface BorderPorts {
  /** The conversation a tab belongs to, if any. */
  conversationOf(tabId: number): Promise<string | null>;
  /** A conversation's tabs. */
  tabsOf(conversationId: string): Promise<number[]>;
  /** Every tab that belongs to a conversation. */
  scopedTabs(): Promise<number[]>;
  /** The Settings switch. */
  enabled(): Promise<boolean>;
  /** Runs `setBorder(state)` in the tab's top frame, or in one document of it; resolves when it has. */
  inject(tabId: number, state: BorderState, documentId?: string): Promise<void>;
}

/** How long a screenshot waits for the border to fade out; past it, the capture goes ahead. */
export const HIDE_WAIT_MS = 300;

export class PageBorder {
  /** Conversations whose run is working now. */
  #running = new Set<string>();
  /** Screenshots in progress, per tab. */
  #capturing = new Map<number, number>();
  /** The fade out of a tab with screenshots in progress: they all wait for the same one. */
  #hiding = new Map<number, Promise<void>>();

  constructor(private readonly ports: BorderPorts) {}

  /** At worker start: no run is working yet, so no page keeps a border from before. */
  async start(): Promise<void> {
    for (const tabId of await this.ports.scopedTabs()) this.#send(tabId, 'off');
  }

  /** A run's status changed. Never waits on a page. */
  async status(conversationId: string, status: RunStatus): Promise<void> {
    if (status === 'running') this.#running.add(conversationId);
    else this.#running.delete(conversationId);
    for (const tabId of await this.ports.tabsOf(conversationId)) await this.#apply(tabId);
  }

  /** Tabs joined or left a conversation. */
  async tabsChanged(added: number[], removed: number[]): Promise<void> {
    for (const tabId of added) await this.#apply(tabId);
    for (const tabId of removed) this.#send(tabId, 'off');
  }

  /** A new document committed in a tab's top frame (a back-forward cache restore included). */
  async committed(tabId: number, documentId?: string): Promise<void> {
    if (await this.#wanted(tabId)) this.#send(tabId, this.#capturing.get(tabId) ? 'hidden' : 'on', documentId);
  }

  /** The Settings switch changed. */
  async settingChanged(): Promise<void> {
    for (const tabId of await this.ports.scopedTabs()) await this.#apply(tabId);
  }

  /**
   * A screenshot of a tab: the border fades out first, waiting at most HIDE_WAIT_MS, and comes back after. A tab with
   * no border is captured at once. Screenshots of one tab that overlap share one fade: a second 'hidden' would return
   * at once while the first is still fading.
   */
  async around<T>(tabId: number, capture: () => Promise<T>): Promise<T> {
    if (!(await this.#wanted(tabId))) return capture();
    const count = this.#capturing.get(tabId) ?? 0;
    this.#capturing.set(tabId, count + 1);
    if (!count) this.#hiding.set(tabId, this.#hide(tabId));
    try {
      await this.#hiding.get(tabId);
      return await capture();
    } finally {
      const left = (this.#capturing.get(tabId) ?? 1) - 1;
      if (left > 0) this.#capturing.set(tabId, left);
      else {
        this.#capturing.delete(tabId);
        this.#hiding.delete(tabId);
        void this.#apply(tabId);
      }
    }
  }

  async #hide(tabId: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.ports.inject(tabId, 'hidden').catch(() => undefined),
      new Promise<void>(resolve => (timer = setTimeout(resolve, HIDE_WAIT_MS))),
    ]);
    clearTimeout(timer);
  }

  async #wanted(tabId: number): Promise<boolean> {
    const conversationId = await this.ports.conversationOf(tabId);
    return conversationId !== null && this.#running.has(conversationId) && (await this.ports.enabled());
  }

  async #apply(tabId: number): Promise<void> {
    if (!(await this.#wanted(tabId))) return this.#send(tabId, 'off');
    if (!this.#capturing.get(tabId)) this.#send(tabId, 'on');
  }

  /** Started and not waited for: a page with a dialog open holds an injection until the dialog closes. */
  #send(tabId: number, state: BorderState, documentId?: string): void {
    void this.ports.inject(tabId, state, documentId).catch(() => undefined);
  }
}

/**
 * Runs in the page, in the extension's isolated world, passed whole to chrome.scripting.executeScript: it must not use
 * anything from outside its own body. It keeps its element on the isolated world's globalThis, which page script
 * cannot see, so later calls find it (a closed shadow root cannot be reached from its host).
 */
export function setBorder(state: BorderState): Promise<void> | void {
  const KEY = '__nanobrowserBorder';
  type Border = { host: HTMLElement; glow: HTMLElement; timer: ReturnType<typeof setInterval>; onHide: () => void };
  const g = globalThis as unknown as Record<string, Border | undefined>;
  const remove = () => {
    const b = g[KEY];
    if (!b) return;
    clearInterval(b.timer);
    removeEventListener('pagehide', b.onHide);
    b.host.remove();
    g[KEY] = undefined;
  };
  if (state === 'off') return remove();
  let b = g[KEY];
  if (!b || !b.host.isConnected) {
    remove();
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('data-nanobrowser-border', '');
    host.style.cssText =
      'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;display:block;contain:strict';
    const root = host.attachShadow({ mode: 'closed' });
    const blue = 'rgb(0 115 220 / 0.6)';
    const violet = 'rgb(124 92 255 / 0.6)';
    const along = (side: string) => `linear-gradient(${side}, ${violet}, ${blue} 25%, ${blue} 75%, ${violet})`;
    root.innerHTML = `<style>
      .glow { position: absolute; inset: 0; transition: opacity 150ms ease; }
      .pulse { position: absolute; inset: 0; animation: breathe 2s ease-in-out infinite alternate; }
      @keyframes breathe { from { opacity: 0.6; } to { opacity: 1; } }
      @media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
      .edge { position: absolute; }
      .t, .b { left: 0; right: 0; height: 16px; background: ${along('to right')}; }
      .l, .r { top: 0; bottom: 0; width: 16px; background: ${along('to bottom')}; }
      .t { top: 0; mask-image: linear-gradient(to bottom, #000, transparent); }
      .b { bottom: 0; mask-image: linear-gradient(to top, #000, transparent); }
      .l { left: 0; mask-image: linear-gradient(to right, #000, transparent); }
      .r { right: 0; mask-image: linear-gradient(to left, #000, transparent); }
    </style><div class="glow"><div class="pulse"><div class="edge t"></div><div class="edge b"></div><div class="edge l"></div><div class="edge r"></div></div></div>`;
    document.documentElement.appendChild(host);
    // A page kept in the back-forward cache keeps its DOM, and its timers wait: it must not keep a border.
    const onHide = () => remove();
    addEventListener('pagehide', onHide);
    // When the extension is updated, reloaded, turned off or removed, its id is gone, and the border goes with it.
    const timer = setInterval(() => {
      if (!globalThis.chrome?.runtime?.id) remove();
    }, 2000);
    b = { host, glow: root.querySelector('.glow') as HTMLElement, timer, onHide };
    g[KEY] = b;
  }
  const glow = b.glow;
  if (state === 'on') {
    glow.style.opacity = '1';
    return;
  }
  if (glow.style.opacity === '0') return;
  // A hidden tab paints nothing until the capture, so the border can go at once.
  if (document.visibilityState === 'hidden') {
    glow.style.transition = 'none';
    glow.style.opacity = '0';
    return;
  }
  glow.style.transition = '';
  return new Promise<void>(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      // One frame so the faded state is painted before the capture.
      requestAnimationFrame(() => resolve());
    };
    glow.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 200);
    glow.style.opacity = '0';
  });
}

/** Puts `setBorder(state)` into the top frame of a tab, or into one document of it. */
export async function injectBorder(tabId: number, state: BorderState, documentId?: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: documentId ? { tabId, documentIds: [documentId] } : { tabId },
    func: setBorder,
    args: [state],
    injectImmediately: true,
  });
}

/** New documents in a tab's top frame, and the Settings switch. Registered at worker start. */
export function listenForBorder(border: PageBorder): void {
  chrome.webNavigation.onCommitted.addListener(details => {
    if (details.frameId === 0) void border.committed(details.tabId, details.documentId).catch(() => undefined);
  });
  let enabled: boolean | undefined;
  settingsStorage.subscribe(() => {
    const next = settingsStorage.getSnapshot()?.pageBorder;
    if (next === undefined || next === enabled) return;
    const changed = enabled !== undefined;
    enabled = next;
    if (changed) void border.settingChanged().catch(() => undefined);
  });
  void settingsStorage.get().then(settings => (enabled ??= settings?.pageBorder));
}
