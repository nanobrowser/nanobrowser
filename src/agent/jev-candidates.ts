// Candidate actions address only refs the browser showed in a complete snapshot. Text and URLs stay with the agent.
import type { DecisionCandidate } from '@src/llm/jev';

export interface JevObservation {
  tabId: number;
  rev: number;
  url: string;
  title: string;
  outline: string;
  complete: boolean;
}

export function buildJevCandidates(page: JevObservation): DecisionCandidate[] {
  if (!page.complete) return [];
  const candidates: DecisionCandidate[] = [];
  const seen = new Set<string>();
  for (const line of page.outline.split('\n').slice(0, 2000)) {
    const match = /^\s*\[([a-zA-Z][\w-]{0,63})\]\s+(button|link|menuitem|tab|checkbox|radio)\b(.*)$/.exec(line);
    if (!match || /\((?:disabled|hidden|offscreen)\)/i.test(match[3]) || seen.has(match[1])) continue;
    const ref = match[1];
    seen.add(ref);
    candidates.push({
      id: `t${page.tabId}-click-${candidates.length}`,
      label: `${match[2]}${match[3]}`.trim().slice(0, 160),
      action: { name: 'click', parameters: { tabId: page.tabId, target: { ref } } },
    });
    if (candidates.length >= 36) break;
  }
  return candidates;
}
