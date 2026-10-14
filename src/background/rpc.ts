// The method registry behind the panel port. Checks and the autorun hook call the same methods.
import type { PanelEvent } from './messages';

export type Handler = (params: unknown) => Promise<unknown>;

const handlers = new Map<string, Handler>();
const listeners = new Set<(event: PanelEvent) => void>();

export function register(method: string, handler: Handler): void {
  handlers.set(method, handler);
}

export async function call<T = unknown>(method: string, params?: unknown): Promise<T> {
  const handler = handlers.get(method);
  if (!handler) throw new Error(`Unknown method ${method}`);
  return (await handler(params)) as T;
}

export function emit(event: string, data: unknown): void {
  for (const listener of listeners) listener({ event, data });
}

export function onEmit(listener: (event: PanelEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
