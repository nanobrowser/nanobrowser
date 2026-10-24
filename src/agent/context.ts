// What the model is sent, built from the active branch. Stored messages become the AI SDK's messages; entries that are
// not messages are left out; a `context_edit` replaces a stored text; consecutive messages of one role are sent as one
// message with several parts, so roles alternate on the wire and a note is still a part of its own.
import type { ModelMessage } from '@src/llm';
import type { Entry, EntryOf, MessagePart, StoredMessage } from '@src/store/types';
import { MAX_FILES } from '@src/store/attachments';
import { applyCompaction, latestCompaction } from './compaction';
import { NOTE_LABEL } from './records';

type UserPart = { type: 'text'; text: string } | { type: 'image'; image: string; mediaType: string };
type AssistantPart =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown; providerOptions?: never };
type ToolPart = {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  output: { type: 'text'; value: string } | { type: 'error-text'; value: string };
};

export interface ContextOptions {
  /** Images are removed for models without vision. */
  vision: boolean;
  /** Actions still unverified: the ledger marks their lines. */
  unverified?: ReadonlySet<string>;
}

/** The messages of a branch, with the elisions of `context_edit` entries applied. */
export function messageEntries(branch: Entry[]): Array<EntryOf<'message'>> {
  const edits = new Map<string, string | null>();
  for (const e of branch) if (e.type === 'context_edit') edits.set(e.targetId, e.replacement);
  const out: Array<EntryOf<'message'>> = [];
  for (const e of branch) {
    if (e.type !== 'message') continue;
    const replacement = edits.get(e.id);
    if (replacement === undefined) {
      out.push(e);
      continue;
    }
    if (replacement === null) continue;
    out.push({ ...e, message: elide(e.message, replacement) });
  }
  return out;
}

/** Replaces attached content, or a tool result's text, with a stub; the user's own words stay. */
function elide(message: StoredMessage, stub: string): StoredMessage {
  return {
    ...message,
    parts: message.parts.map(p => {
      if (p.type === 'text' && p.attached) return { ...p, text: stub };
      if (p.type === 'tool-result') return { ...p, text: stub };
      return p;
    }),
  };
}

/** A file the user attached, as sent: an image, or a text file's content (not the note that lists them). */
const isFile = (p: MessagePart) =>
  p.type === 'image' || (p.type === 'text' && p.attached?.kind === 'file' && !p.text.startsWith(NOTE_LABEL));

function userParts(parts: MessagePart[], sent: { keep: Set<MessagePart>; drop?: Set<MessagePart> }): UserPart[] {
  const out: UserPart[] = [];
  for (const p of parts) {
    if (p.type === 'text') {
      // A file left out by the cap keeps a stub; the note that lists the files still has its name and id.
      const left = p.attached && sent.drop?.has(p);
      out.push({ type: 'text', text: left ? `[file ${p.attached!.label}: content left out]` : p.text });
    } else if (p.type === 'image' && sent.keep.has(p)) {
      out.push({ type: 'text', text: p.note });
      out.push({ type: 'image', image: p.data, mediaType: p.mediaType });
    }
  }
  return out;
}

/**
 * Puts each reply's tool results right after it: providers require every result before the next message. A note
 * stored between them (after a restart, a hand-over answered later) moves after the results; nothing is dropped.
 */
export function groupResults(entries: Array<EntryOf<'message'>>): Array<EntryOf<'message'>> {
  const out: Array<EntryOf<'message'>> = [];
  let waiting = new Set<string>();
  let held: Array<EntryOf<'message'>> = [];
  const flush = () => {
    out.push(...held);
    held = [];
  };
  for (const e of entries) {
    const m = e.message;
    if (m.role === 'tool' && waiting.size) {
      out.push(e);
      for (const p of m.parts) if (p.type === 'tool-result') waiting.delete(p.toolCallId);
      if (!waiting.size) flush();
      continue;
    }
    if (m.role === 'assistant') {
      flush();
      out.push(e);
      waiting = new Set(m.parts.filter(p => p.type === 'tool-call').map(p => (p as { toolCallId: string }).toolCallId));
      continue;
    }
    if (waiting.size) held.push(e);
    else out.push(e);
  }
  flush();
  return out;
}

/** How many of the newest screenshots are sent; older ones are left out. */
export const KEEP_SCREENSHOTS = 3;

/** Converts a branch to the AI SDK's messages. */
export function toModelMessages(branch: Entry[], options: ContextOptions): ModelMessage[] {
  let entries = groupResults(messageEntries(branch));
  const compaction = latestCompaction(branch);
  if (compaction) entries = applyCompaction(entries, compaction, options.unverified ?? new Set());
  // Files and screenshots to send: every file the user attached and the newest screenshots, at most MAX_FILES of them
  // together, the newest; no image for a model without vision. A screenshot belongs to a tool result. A text file
  // already elided is a stub and does not count.
  const elided = new Set(branch.flatMap(e => (e.type === 'context_edit' ? [e.targetId] : [])));
  const found = entries.flatMap(e =>
    e.message.parts
      .filter(p => isFile(p) && (p.type === 'image' ? options.vision : !elided.has(e.id)))
      .map(p => ({ p, screenshot: e.message.role === 'tool' })),
  );
  const shots = new Set(found.filter(i => i.screenshot).slice(-KEEP_SCREENSHOTS));
  const keep = new Set<MessagePart>(
    found
      .filter(i => !i.screenshot || shots.has(i))
      .slice(-MAX_FILES)
      .map(i => i.p),
  );
  const drop = new Set(found.filter(i => i.p.type === 'text' && !keep.has(i.p)).map(i => i.p));

  const out: ModelMessage[] = [];
  const push = (message: ModelMessage) => {
    const last = out[out.length - 1];
    if (last && last.role === message.role && Array.isArray(last.content) && Array.isArray(message.content)) {
      (last.content as unknown[]).push(...(message.content as unknown[]));
      return;
    }
    out.push(message);
  };
  // An image that belongs to a tool result travels in a user message after all of its reply's results: a user message
  // between two results leaves the later call without a result, and the request is refused.
  let images: UserPart[] = [];
  const flushImages = () => {
    if (images.length) push({ role: 'user', content: images } as ModelMessage);
    images = [];
  };
  for (const e of entries) {
    const m = e.message;
    if (m.role !== 'tool') flushImages();
    if (m.role === 'user') {
      const content = userParts(m.parts, { keep, drop });
      if (content.length) push({ role: 'user', content } as ModelMessage);
    } else if (m.role === 'assistant') {
      const content: AssistantPart[] = [];
      for (const p of m.parts) {
        if (p.type === 'text' && p.text) content.push({ type: 'text', text: p.text });
        if (p.type === 'tool-call') {
          content.push({
            type: 'tool-call',
            toolCallId: p.toolCallId,
            toolName: p.toolName,
            input: p.input,
            ...(p.providerOptions ? { providerOptions: p.providerOptions as never } : {}),
          });
        }
      }
      // An empty reply (aborted before any text) is not sent: providers refuse empty assistant messages.
      if (content.length) push({ role: 'assistant', content } as ModelMessage);
    } else {
      const content: ToolPart[] = m.parts
        .filter((p): p is Extract<MessagePart, { type: 'tool-result' }> => p.type === 'tool-result')
        .map(p => ({
          type: 'tool-result',
          toolCallId: p.toolCallId,
          toolName: p.toolName,
          output: p.isError ? { type: 'error-text', value: p.text } : { type: 'text', value: p.text },
        }));
      if (content.length) push({ role: 'tool', content } as ModelMessage);
      images.push(
        ...userParts(
          m.parts.filter(p => p.type === 'image'),
          { keep },
        ),
      );
    }
  }
  flushImages();
  return out;
}

/** Characters of a request's messages, for the size estimate; an image counts as 6,000. */
export function contextChars(messages: ModelMessage[], system = ''): number {
  let chars = system.length;
  for (const m of messages) {
    if (typeof m.content === 'string') {
      chars += m.content.length;
      continue;
    }
    for (const p of m.content as Array<Record<string, unknown>>) {
      if (p.type === 'text') chars += String(p.text).length;
      else if (p.type === 'image' || p.type === 'file') chars += 6000;
      else if (p.type === 'tool-call') chars += JSON.stringify(p.input ?? {}).length + String(p.toolName).length;
      else if (p.type === 'tool-result') chars += String((p.output as { value?: unknown })?.value ?? '').length;
    }
  }
  return chars;
}
