// Port client for the service worker (src/background/panel-port.ts).
import { useEffect, useState } from 'react';
import { PANEL_PORT } from '@src/background/messages';
import type { PanelEvent, PanelRequest, PanelResponse } from '@src/background/messages';

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

class PanelClient {
  #port: chrome.runtime.Port | null = null;
  #nextId = 1;
  #pending = new Map<number, Pending>();
  #listeners = new Set<(event: PanelEvent) => void>();

  #connect(): chrome.runtime.Port {
    if (this.#port) return this.#port;
    const port = chrome.runtime.connect({ name: PANEL_PORT });
    port.onMessage.addListener((message: PanelResponse | PanelEvent) => {
      if ('event' in message) {
        for (const listener of this.#listeners) listener(message);
        return;
      }
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error));
    });
    port.onDisconnect.addListener(() => {
      this.#port = null;
      for (const pending of this.#pending.values()) pending.reject(new Error('Service worker disconnected'));
      this.#pending.clear();
    });
    this.#port = port;
    return port;
  }

  call<T = unknown>(method: string, params?: unknown): Promise<T> {
    const port = this.#connect();
    const id = this.#nextId++;
    const request: PanelRequest = { id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      port.postMessage(request);
    });
  }

  subscribe(listener: (event: PanelEvent) => void): () => void {
    this.#connect();
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

export const client = new PanelClient();

/** Subscribes to one pushed event while the component is mounted. */
export function useEvent(name: string, handler: (data: unknown) => void): void {
  useEffect(
    () =>
      client.subscribe(event => {
        if (event.event === name) handler(event.data);
      }),
    [name, handler],
  );
}

/** Runs an async call and keeps its state for display. */
export function useCall<T>() {
  const [state, setState] = useState<{ busy: boolean; result?: T; error?: string }>({ busy: false });
  const run = async (method: string, params?: unknown): Promise<T | undefined> => {
    setState({ busy: true });
    try {
      const result = await client.call<T>(method, params);
      setState({ busy: false, result });
      return result;
    } catch (error) {
      setState({ busy: false, error: error instanceof Error ? error.message : String(error) });
      return undefined;
    }
  };
  return { ...state, run };
}
