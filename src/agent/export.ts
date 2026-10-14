// Export as Markdown: a conversation, built from the stored branch. Each run's steps are given in brief, by the first
// line of each call's result, the layer's own line where page strings are quoted, so no typed value is written.
import type { Conversation, Entry } from '@src/store/types';
import type { ToolRow } from '@src/ui/protocol';
import { runRows } from '@src/ui/protocol';
import { toDisplay } from './display';

const ICON: Record<ToolRow['status'], string> = { running: '…', done: '✓', failed: '✗', skipped: '–', waiting: '!' };

function stamp(at: string): string {
  return at ? at.replace('T', ' ').slice(0, 16) : '';
}

/** A file name from the title: letters, digits and spaces, at most 60 characters. */
export function exportName(conversation: Conversation): string {
  const base = (conversation.title || 'conversation')
    .replace(/[^\p{L}\p{N} _-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `${base || 'conversation'}.md`;
}

function steps(rows: ToolRow[]): string[] {
  return rows.map(r => {
    const line = r.tool === 'opened' ? 'Looked at the page' : (r.text ?? r.tool).split('\n')[0];
    return `- ${ICON[r.status]} ${line.trim()}`;
  });
}

/** The conversation as Markdown: messages and answers in order, each run's steps in brief. */
export function conversationMarkdown(conversation: Conversation, branch: Entry[], now = new Date()): string {
  const lines = [
    `# ${conversation.title || 'Conversation'}`,
    '',
    `_Exported from Nanobrowser on ${stamp(now.toISOString())}._`,
    '',
  ];
  // The page read when a run began goes with the run's first steps, as in the panel.
  let opened: { messageId: string } | undefined;
  for (const e of toDisplay(branch)) {
    if (e.kind === 'user') {
      opened = e.opened ? { messageId: e.id } : undefined;
      lines.push(`## You · ${stamp(e.at)}`, '');
      for (const q of e.quotes ?? []) lines.push(`> ${q.text.replace(/\n/g, '\n> ')}`, `> — ${q.title || q.url}`, '');
      lines.push(e.text);
      if (e.attachments?.length) lines.push('', `Attached: ${e.attachments.map(a => a.name).join(', ')}`);
      lines.push('');
    } else if (e.kind === 'assistant') {
      const rows = runRows(e.tools, opened);
      opened = undefined;
      if (rows.length) lines.push('Steps:', ...steps(rows), '');
      if (e.text) lines.push(`## Nanobrowser · ${stamp(e.at)}`, '', e.text, '');
    } else if (e.kind === 'notice') {
      lines.push(`> ${e.text}`, '');
    } else if (e.kind === 'download') {
      lines.push(`> Saved the file ${e.name}`, '');
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
