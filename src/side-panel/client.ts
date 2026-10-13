// The panel's end of the panel protocol. The port reconnects when the worker restarts, and subscribes again with the
// last sequence number it saw, so it gets what it missed.
import { PANEL_PORT_NAME } from '@src/ui/protocol';
import type { PanelCommand, PanelEvent } from '@src/ui/protocol';

export class PanelClient {
  #port: chrome.runtime.Port | null = null;
  #listeners = new Set<(event: PanelEvent) => void>();
  #lastSeq: number | undefined;
  #subscription: { tabId: number; conversationId: string | null } | null = null;
  #closed = false;

  constructor(readonly tabId: number) {}

  #connect(): chrome.runtime.Port {
    if (this.#port) return this.#port;
    const port = chrome.runtime.connect({ name: PANEL_PORT_NAME });
    port.onMessage.addListener((event: PanelEvent) => {
      if (event.type === 'bound') {
        this.#subscription = { tabId: this.tabId, conversationId: event.conversationId };
        this.#lastSeq = undefined;
      }
      if (event.seq) this.#lastSeq = event.seq;
      for (const listener of this.#listeners) listener(event);
    });
    port.onDisconnect.addListener(() => {
      this.#port = null;
      if (this.#closed) return;
      // The worker went away (restart, update): connect again and catch up.
      setTimeout(() => {
        if (this.#closed) return;
        const sub = this.#subscription;
        this.send({
          type: 'subscribe',
          tabId: this.tabId,
          conversationId: sub?.conversationId ?? null,
          sinceSeq: sub?.conversationId ? this.#lastSeq : undefined,
        });
      }, 300);
    });
    this.#port = port;
    return port;
  }

  send(command: PanelCommand): void {
    try {
      this.#connect().postMessage(command);
    } catch {
      this.#port = null;
      this.#connect().postMessage(command);
    }
  }

  subscribe(conversationId: string | null = null): void {
    this.#subscription = { tabId: this.tabId, conversationId };
    this.send({ type: 'subscribe', tabId: this.tabId, conversationId });
  }

  onEvent(listener: (event: PanelEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  close(): void {
    this.#closed = true;
    this.#port?.disconnect();
  }
}

/** The tab this panel belongs to: the active tab of its window when the panel loads. */
export async function panelTabId(): Promise<number> {
  // Unattended checks open the panel page in a tab of its own and name the tab it stands for. Only autorun builds read
  // this; a normal build takes nothing from the address.
  if (import.meta.env.WXT_AUTORUN_URL) {
    const named = /[#&]tab=(\d+)/.exec(location.hash)?.[1];
    if (named) return Number(named);
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new Error('The panel has no tab');
  return tab.id;
}
