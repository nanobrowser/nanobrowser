// The fake layer of the agent's unit tests: returns prepared results per
// call and records every call with its arguments.
import type { PendingModal, Result, TabsData } from '@src/browser-control';
import type { HandoverRequest, HostPort, LayerPort } from '../ports';

export type FakeHandler = (args: Record<string, unknown>, index: number) => Result | Promise<Result>;

export class FakeLayer implements LayerPort {
  readonly calls: Array<{ tool: string; args: Record<string, unknown>; at: number }> = [];
  readonly started: string[] = [];
  #handlers: Record<string, FakeHandler>;
  #counts = new Map<string, number>();
  tabsData: TabsData = {
    tabs: [{ tabId: 1, url: 'chrome://newtab/', title: 'New Tab', active: true }],
    activeTabId: 1,
  };
  pending = new Map<number, PendingModal[]>();
  revs = new Map<number, number>([[1, 3]]);

  constructor(handlers: Record<string, FakeHandler> = {}) {
    this.#handlers = handlers;
  }

  async call(tool: string, args: Record<string, unknown>): Promise<Result> {
    this.started.push(tool);
    const n = this.#counts.get(tool) ?? 0;
    this.#counts.set(tool, n + 1);
    this.calls.push({ tool, args, at: this.calls.length });
    const handler = this.#handlers[tool];
    return handler ? handler(args, n) : ok(`${tool} · ok`);
  }

  async tabs(): Promise<TabsData> {
    return this.tabsData;
  }

  tabInfo(tabId: number) {
    return { rev: this.revs.get(tabId) ?? 0, pending: this.pending.get(tabId) ?? [] };
  }

  wrap(text: string): string {
    return `<<<page-content 000000000000>>>\n${text}\n<<<end-page-content 000000000000>>>`;
  }
}

export function ok(text: string, extra: Partial<Result> = {}): Result {
  return { ok: true, text, ...extra };
}

export function receipt(extra: Partial<NonNullable<Result['receipt']>> = {}): NonNullable<Result['receipt']> {
  return {
    action: 'click',
    mechanism: 'pointer',
    dispatched: true,
    effect: { verdict: 'changed', signals: ['1 mutation'] },
    ...extra,
  };
}

export function failed(code: string, message = code, extra: Partial<NonNullable<Result['error']>> = {}): Result {
  return {
    ok: false,
    text: `error ${code}\n${message}`,
    error: { code: code as never, message, delivered: false, hint: '', ...extra },
  };
}

export class FakeHost implements HostPort {
  readonly handovers: HandoverRequest[] = [];
  answer: 'given-back' | 'cancelled' = 'given-back';

  async handover(request: HandoverRequest): Promise<'given-back' | 'cancelled'> {
    this.handovers.push(request);
    return this.answer;
  }
}
