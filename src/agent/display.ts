// What the panel draws for a branch: the user's messages, the agent's replies with a row per tool call, and notices.
// Notes for the model (app-owned messages) are not shown.
import type { AttachmentRef, DisplayEntry, ToolRow } from '@src/ui/protocol';
import type { Entry, EntryOf } from '@src/store/types';

export function userText(entry: EntryOf<'message'>): string {
  return entry.message.parts
    .filter(p => p.type === 'text' && !p.attached)
    .map(p => (p as { text: string }).text)
    .join('\n');
}

/** The files attached to a user message, as the panel shows them. */
export function attachmentRefs(entry: EntryOf<'message'>): AttachmentRef[] {
  return entry.message.parts.flatMap(p =>
    p.type === 'attachment' ? [{ id: p.id, name: p.name, mimeType: p.mimeType, size: p.size }] : [],
  );
}

/** A user message as the panel shows it: the words, the files and selections, and the page read at the run's start. */
export function userDisplay(entry: EntryOf<'message'>): Extract<DisplayEntry, { kind: 'user' }> {
  const attachments = attachmentRefs(entry);
  const quotes = entry.message.parts.flatMap(p =>
    p.type === 'selection' ? [{ text: p.text, url: p.url, title: p.title }] : [],
  );
  // Each run of the message (a Restart, a Retry) attaches its own outline.
  const outline = entry.message.parts.findLast(p => p.type === 'text' && p.attached?.kind === 'outline');
  return {
    kind: 'user',
    id: entry.id,
    text: userText(entry),
    ...(attachments.length ? { attachments } : {}),
    ...(quotes.length ? { quotes } : {}),
    ...(outline ? { opened: true as const } : {}),
    at: entry.at,
  };
}

export function assistantDisplay(entry: EntryOf<'message'>): Extract<DisplayEntry, { kind: 'assistant' }> {
  const text = entry.message.parts
    .filter(p => p.type === 'text')
    .map(p => (p as { text: string }).text)
    .join('');
  const tools: ToolRow[] = entry.message.parts
    .filter(p => p.type === 'tool-call')
    .map(p => {
      const call = p as Extract<typeof p, { type: 'tool-call' }>;
      return { toolCallId: call.toolCallId, tool: call.toolName, args: call.input, status: 'running' };
    });
  return {
    kind: 'assistant',
    id: entry.id,
    text,
    at: entry.at,
    model: entry.meta?.model,
    usage: entry.meta?.usage,
    durationMs: entry.meta?.durationMs,
    runStartedAt: entry.meta?.runStartedAt,
    stopReason: entry.meta?.stopReason,
    tools,
  };
}

/** Builds the display entries of a branch. */
export function toDisplay(branch: Entry[]): DisplayEntry[] {
  const out: DisplayEntry[] = [];
  const rows = new Map<string, ToolRow>();
  for (const e of branch) {
    if (e.type === 'message') {
      if (e.appOwned) continue;
      if (e.message.role === 'user') {
        out.push(userDisplay(e));
      } else if (e.message.role === 'assistant') {
        const display = assistantDisplay(e);
        for (const row of display.tools) rows.set(row.toolCallId, row);
        out.push(display);
      } else {
        for (const p of e.message.parts) {
          if (p.type !== 'tool-result') continue;
          const row = rows.get(p.toolCallId);
          if (!row) continue;
          row.text = p.text;
          row.result = e.result;
          const image = e.message.parts.find(x => x.type === 'image');
          if (image?.type === 'image' && image.thumb) row.thumbnail = image.thumb;
          const skipped = p.text.startsWith('skipped:');
          row.status = skipped ? 'skipped' : p.isError ? 'failed' : 'done';
        }
      }
    } else if (e.type === 'ui' && e.kind === 'download') {
      const data = e.data as { name: string; downloadId: number; bytes: number };
      out.push({
        kind: 'download',
        id: e.id,
        name: data.name,
        downloadId: data.downloadId,
        bytes: data.bytes,
        at: e.at,
      });
    } else if (e.type === 'ui' && e.kind === 'notice') {
      const data = e.data as { text: string; tone?: 'info' | 'warn' | 'error' };
      out.push({ kind: 'notice', id: e.id, text: data.text, tone: data.tone ?? 'info', at: e.at });
    }
  }
  return out;
}
