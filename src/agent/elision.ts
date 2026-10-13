// The check before every request, and step 1 of context management. Pure: the threshold of a model, and which stored
// texts step 1 replaces with stubs. The loop stores each replacement as a `context_edit` entry, so the model sees the
// same history before and after a restart.
import { requestOutputLimit } from '@src/llm';
import type { ModelProfile } from '@src/llm';
import type { Entry, EntryOf } from '@src/store/types';
import { messageEntries } from './context';

/** The share of the window a request may fill before the steps run, by window size (as in WebBrain). */
export function ratioFor(window: number): number {
  if (window <= 32_768) return 0.65;
  if (window <= 65_536) return 0.7;
  if (window <= 131_072) return 0.75;
  return 0.8;
}

/** Past this the request cannot be sent: the window less the output limit counted (at most a quarter). */
export function hardLimit(profile: ModelProfile, window = profile.contextWindow): number {
  return window - Math.min(requestOutputLimit(profile), Math.floor(window / 4));
}

/** `min(ratio × window, window − output limit)`, in tokens. */
export function contextThreshold(profile: ModelProfile, window = profile.contextWindow): number {
  return Math.min(Math.floor(ratioFor(window) * window), hardLimit(profile, window));
}

/** Step 1 runs only when it saves at least this many tokens, unless the request is over the threshold. */
export function elisionChunk(window: number): number {
  return Math.max(1_000, Math.floor(window * 0.05));
}

export interface Elision {
  targetId: string;
  replacement: string;
  /** Characters saved. */
  saved: number;
}

// The fixed line before a boundary, the boundary and its content.
const BOUNDARY =
  /(?:The text between the page-content markers[^\n]*\n)?<<<page-content (\w+)[^\n]*>>>[\s\S]*?<<<end-page-content \1>>>/g;

export function pageStub(tabId: number | string, rev: number | string): string {
  return `[tab ${tabId} rev ${rev}: page content elided]`;
}

/** A tool result's text with its page payload replaced by the stub; the receipt lines outside it stay word for word. */
export function elideText(text: string, stub: string): string {
  return text.replace(BOUNDARY, stub);
}

interface StoredPage {
  page?: { tabId?: number; rev?: number };
}

/**
 * What step 1 replaces: outlines, `read` content and diffs older than the newest one per tab, and content attached to a
 * user message older than the newest one. Receipts and the user's own words stay.
 */
export function planElision(branch: Entry[]): Elision[] {
  const entries = messageEntries(branch);
  const edited = new Set(
    branch.filter(e => e.type === 'context_edit').map(e => (e as EntryOf<'context_edit'>).targetId),
  );
  const out: Elision[] = [];
  const newestPerTab = new Set<string>();
  const users = entries.filter(e => e.message.role === 'user' && !e.appOwned);
  const newestUser = users.at(-1)?.id;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const m = e.message;
    if (m.role === 'tool') {
      const part = m.parts.find(p => p.type === 'tool-result');
      if (!part || part.type !== 'tool-result' || !part.text.includes('<<<page-content ')) continue;
      const page = (e.result as StoredPage | undefined)?.page;
      const tab = String(page?.tabId ?? '?');
      if (edited.has(e.id)) {
        newestPerTab.add(tab);
        continue;
      }
      if (!newestPerTab.has(tab)) {
        newestPerTab.add(tab);
        continue;
      }
      const replacement = elideText(part.text, pageStub(tab, page?.rev ?? '?'));
      if (replacement.length < part.text.length) {
        out.push({ targetId: e.id, replacement, saved: part.text.length - replacement.length });
      }
    } else if (m.role === 'user' && e.id !== newestUser && !edited.has(e.id)) {
      const attached = m.parts.filter(p => p.type === 'text' && p.attached);
      if (!attached.length) continue;
      const first = attached[0] as { attached: { kind: string; label: string } };
      const stub =
        first.attached.kind === 'outline'
          ? `[${first.attached.label}: page content elided]`
          : `[${first.attached.kind} ${first.attached.label}: content elided]`;
      const size = attached.reduce((n, p) => n + (p as { text: string }).text.length, 0);
      if (size > stub.length * attached.length) {
        out.push({ targetId: e.id, replacement: stub, saved: size - stub.length * attached.length });
      }
    }
  }
  return out.reverse();
}
