// Messages between the test panel and the service worker, over a runtime port named PANEL_PORT.

export const PANEL_PORT = 'test-panel';

export interface PanelRequest {
  id: number;
  method: string;
  params?: unknown;
}

export type PanelResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/** Pushed by the service worker without a request. */
export interface PanelEvent {
  event: string;
  data: unknown;
}

export interface TabSummary {
  tabId: number;
  windowId: number;
  url: string;
  title: string;
  active: boolean;
}

export interface CheckSummary {
  name: string;
  title: string;
  description: string;
}

export interface CheckReport {
  name: string;
  ok: boolean;
  startedAt: string;
  durationMs: number;
  result?: unknown;
  error?: string;
}
