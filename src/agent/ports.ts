// What the agent reaches the browser and the person through: small interfaces the extension passes in, so the loop runs
// with a fake model and a fake layer in tests.
import type { ContentSource, PendingModal, Result, TabsData, UserStepDetails } from '@src/browser-control';

/** The conversation's layer session. */
export interface LayerPort {
  /** Calls a layer tool. The session's policies (hand-over, write policy, blocked sites) apply below this call. */
  call(tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<Result>;
  tabs(): Promise<TabsData>;
  /** The revision the layer last observed on a tab, and what is pending there, for the page header. */
  tabInfo(tabId: number): { rev: number; pending: PendingModal[] } | null;
  /** Wraps untrusted content with the session's nonce (attachments, selections). */
  wrap(text: string, source: ContentSource): string;
}

export interface HandoverRequest {
  toolCallId: string;
  tabId: number;
  details: UserStepDetails;
  /** The call's partial result, stored with the hand-over before the card opens. */
  partial: unknown;
}

/** The person, through the extension's cards. */
export interface HostPort {
  /** Opens the hand-over card and waits until the user gives back or cancels. No time limit. */
  handover(request: HandoverRequest, signal: AbortSignal): Promise<'given-back' | 'cancelled'>;
}
