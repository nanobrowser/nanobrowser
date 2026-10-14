// One attached tab: the Puppeteer connection, the raw command channel with per-command timeouts,
// event fan-out keyed by (tabId, sessionId), and detach handling.
import { LayerError } from '../protocol/errors';
import type { Attacher, CdpPort, DetachInfo, PagePort, SessionId, TabAttachment, TopologyPort } from '../core/ports';
import { DEFAULT_COMMAND_TIMEOUT_MS, normalizeSessionId, sendRaw } from './cdp-session';
import { connectTab, disconnectTab } from './puppeteer';
import type { PuppeteerConnection } from './puppeteer';
import { PuppeteerFrameTopology } from './frame-topology';
import { PuppeteerPagePort } from './page-port';

type EventHandler = (params: unknown, sessionId: SessionId) => void;

/** Pages the debugger cannot attach to (restricted pages). */
export function isRestrictedUrl(url: string): boolean {
  const u = url.trim().toLowerCase();
  return (
    u.startsWith('chrome://') ||
    u.startsWith('chrome-extension://') ||
    u.startsWith('chrome-search://') ||
    u.startsWith('chrome-untrusted://') ||
    u.startsWith('devtools://') ||
    u.startsWith('edge://') ||
    u.startsWith('view-source:') ||
    u.startsWith('https://chromewebstore.google.com') ||
    u.startsWith('https://chrome.google.com/webstore')
  );
}

const connections = new Map<number, ChromeTabConnection>();
let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (source.tabId === undefined) return;
    connections.get(source.tabId)?.dispatch(normalizeSessionId(source.sessionId), method, params);
  });
  chrome.debugger.onDetach.addListener((source, reason) => {
    if (source.tabId === undefined) return;
    connections.get(source.tabId)?.markDetached({ reason });
  });
}

class ChromeCdpPort implements CdpPort {
  constructor(private readonly connection: ChromeTabConnection) {}

  get tabId() {
    return this.connection.tabId;
  }

  send<T = unknown>(sessionId: SessionId, method: string, params: object = {}, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
    return this.connection.send<T>(sessionId, method, params, timeoutMs);
  }

  on(method: string, handler: EventHandler, only?: { sessionId: SessionId }): () => void {
    return this.connection.subscribe(method, handler, only?.sessionId, only !== undefined);
  }
}

export class ChromeTabConnection implements TabAttachment {
  readonly cdp: CdpPort;
  readonly topology: TopologyPort;
  readonly page: PagePort;
  #detached: DetachInfo | null = null;
  /** Puppeteer is disconnected once: a second disconnect detaches again, and Chrome's refusal goes uncaught. */
  #disconnected = false;
  #detachHandlers = new Set<(info: DetachInfo) => void>();
  #rejectDetached!: (error: Error) => void;
  /** Settles (rejects) when the tab detaches; raced against every pending command. */
  readonly #detachedSignal: Promise<never>;
  #handlers = new Map<string, Set<{ handler: EventHandler; sessionId: SessionId; scoped: boolean }>>();

  private constructor(
    readonly tabId: number,
    private readonly puppeteer: PuppeteerConnection,
  ) {
    this.#detachedSignal = new Promise<never>((_, reject) => (this.#rejectDetached = reject));
    this.#detachedSignal.catch(() => undefined);
    this.cdp = new ChromeCdpPort(this);
    this.topology = new PuppeteerFrameTopology(puppeteer.page, this.cdp);
    this.page = new PuppeteerPagePort(puppeteer.page, this.cdp);
  }

  static async open(tabId: number): Promise<ChromeTabConnection> {
    listen();
    const existing = connections.get(tabId);
    if (existing && !existing.detached) return existing;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new LayerError('TAB_NOT_IN_SESSION', `Tab ${tabId} does not exist`);
    if (isRestrictedUrl(tab.url ?? tab.pendingUrl ?? '')) {
      throw new LayerError('PAGE_NOT_SUPPORTED', `Tab ${tabId} shows a page that cannot be controlled: ${tab.url}`);
    }
    let puppeteer: PuppeteerConnection;
    try {
      puppeteer = await connectTab(tabId).catch(async error => {
        // This extension's debugger is still on the tab though no connection here knows it: the service worker
        // restarted while the tab was attached. Detach it and attach again. Another client's debugger cannot be
        // detached from here, and the second attempt then fails with the same error.
        if (!/already attached/i.test(error instanceof Error ? error.message : String(error))) throw error;
        await chrome.debugger.detach({ tabId }).catch(() => undefined);
        return connectTab(tabId);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/cannot access|cannot attach|chrome:\/\/|extensions gallery/i.test(message)) {
        throw new LayerError('PAGE_NOT_SUPPORTED', `Cannot attach to tab ${tabId}: ${message}`);
      }
      throw new LayerError('INTERNAL', `Cannot attach to tab ${tabId}: ${message}`);
    }
    const connection = new ChromeTabConnection(tabId, puppeteer);
    connections.set(tabId, connection);
    // The operated tab may sit in a window the user is not in; keep the page behaving as focused.
    await connection.cdp
      .send(undefined, 'Emulation.setFocusEmulationEnabled', { enabled: true })
      .catch(() => undefined);
    return connection;
  }

  /** Puppeteer's page, for diagnostics in the test extension's checks only. The layer never uses it. */
  get diagnosticPage(): unknown {
    return this.puppeteer.page;
  }

  get detached(): DetachInfo | null {
    return this.#detached;
  }

  send<T>(sessionId: SessionId, method: string, params: object, timeoutMs: number): Promise<T> {
    if (this.#detached) {
      return Promise.reject(
        new LayerError('DEBUGGER_DETACHED', `Tab ${this.tabId} is detached (${this.#detached.reason})`, {
          delivered: 'unknown',
        }),
      );
    }
    return sendRaw<T>(this.tabId, sessionId, method, params, timeoutMs, this.#detachedSignal);
  }

  subscribe(method: string, handler: EventHandler, sessionId: SessionId, scoped: boolean): () => void {
    let set = this.#handlers.get(method);
    if (!set) this.#handlers.set(method, (set = new Set()));
    const entry = { handler, sessionId, scoped };
    set.add(entry);
    return () => set!.delete(entry);
  }

  dispatch(sessionId: SessionId, method: string, params: unknown): void {
    const set = this.#handlers.get(method);
    if (!set) return;
    for (const entry of [...set]) {
      if (entry.scoped && entry.sessionId !== sessionId) continue;
      try {
        entry.handler(params, sessionId);
      } catch (error) {
        console.error('[browser-control] event handler failed', method, error);
      }
    }
  }

  markDetached(info: DetachInfo): void {
    if (this.#detached) return;
    this.#detached = info;
    connections.delete(this.tabId);
    this.#rejectDetached(
      new LayerError('DEBUGGER_DETACHED', `The debugger detached from tab ${this.tabId} (${info.reason})`, {
        delivered: 'unknown',
      }),
    );
    for (const handler of [...this.#detachHandlers]) {
      try {
        handler(info);
      } catch (error) {
        console.error('[browser-control] detach handler failed', error);
      }
    }
    // Let Puppeteer drop its state, unless close() already did.
    void this.#disconnect().catch(() => undefined);
  }

  #disconnect(): Promise<void> {
    if (this.#disconnected) return Promise.resolve();
    this.#disconnected = true;
    return disconnectTab(this.puppeteer);
  }

  onDetach(handler: (info: DetachInfo) => void): () => void {
    this.#detachHandlers.add(handler);
    return () => this.#detachHandlers.delete(handler);
  }

  async close(): Promise<void> {
    if (this.#detached) return;
    connections.delete(this.tabId);
    try {
      await this.#disconnect();
    } finally {
      this.markDetached({ reason: 'closed_by_layer' });
    }
  }
}

export const chromeAttacher: Attacher = {
  attach: tabId => ChromeTabConnection.open(tabId),
};
