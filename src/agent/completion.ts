// Verification debt: the agent must not claim success for an action whose outcome it has not seen. An action's result
// normally shows the page after it (observe: 'diff'), so debt arises only when the result does not show what the action
// did, and only evidence about the tab afterwards clears it.
import type { Result } from '@src/browser-control';
import type { DebtItem } from '@src/store/types';
import { PAGE_ACTIONS } from './tools';

export interface DebtEntry extends DebtItem {
  /** The tab's revision when the action's result was read; a later page state must be newer. */
  rev: number;
}

/** Whether a page action's result leaves its outcome unseen. */
export function createsDebt(tool: string, result: Result | undefined): boolean {
  if (!PAGE_ACTIONS.has(tool) || !result) return false;
  if (!result.ok) return result.error?.delivered === true || result.error?.delivered === 'unknown';
  const r = result.receipt;
  if (r?.dispatched === 'unknown') return true;
  if (result.pageError || result.pending?.length) return true;
  if (
    r &&
    (r.effect.verdict === 'none' || r.effect.verdict === 'unattributable') &&
    r.postcondition?.status !== 'met'
  ) {
    return true;
  }
  if (r?.postcondition?.status === 'unmet') return true;
  return false;
}

/** A label for the refusal and the final answer: "click button «Submit» on tab 12". */
export function debtLabel(tool: string, result: Result | undefined, tabId: number): string {
  const target = result?.receipt?.target ?? (result?.error ? result.error.code : '');
  return `${tool}${target ? ` ${target}` : ''} on tab ${tabId}`;
}

/** Whether a later result on the tab is evidence of its state after the action. */
export function clearsDebt(tool: string, result: Result, item: DebtEntry): boolean {
  if (!result.ok || result.pageError) return false;
  const page = result.page;
  if (['snapshot', 'find', 'read', 'screenshot'].includes(tool)) {
    // A read of the same tab that succeeds takes a new capture after any dispatched action.
    return (page?.tabId ?? item.tabId) === item.tabId;
  }
  if (tool === 'wait') {
    const met = (result.data as { met?: string } | undefined)?.met;
    if (met && met !== 'time') return (page?.tabId ?? item.tabId) === item.tabId;
  }
  if (
    page &&
    page.tabId === item.tabId &&
    (page.changed === 'diff' || page.changed === 'full') &&
    page.rev > item.rev
  ) {
    return true;
  }
  return result.receipt?.postcondition?.status === 'met' && page?.tabId === item.tabId;
}

/** The refusal of done(success) while debt is left. */
export function refusal(open: DebtEntry[]): string {
  return `refused: you have not seen the result of ${open.length === 1 ? 'this action' : 'these actions'}: ${open
    .map(d => d.label)
    .join(
      '; ',
    )}. Observe the page (snapshot, find or read) to verify, then call done again, or call done with "partial".`;
}

/** The lines the final answer adds for actions that can never be verified. */
export function unverifiedLines(items: DebtEntry[]): string[] {
  return items.filter(d => d.state === 'unverifiable').map(d => `${d.label}: not verified, the tab closed.`);
}
