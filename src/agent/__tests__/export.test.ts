import { describe, expect, it } from 'vitest';
import type { Conversation, Entry, EntryBody } from '@src/store/types';
import { conversationMarkdown, exportName } from '../export';
import { attachmentParts } from '../attachments';

let n = 0;
const e = (body: EntryBody): Entry =>
  ({ ...body, id: `e${++n}`, parentId: null, conversationId: 'c', at: '2026-10-07T09:00:00Z' }) as Entry;
const conversation = { id: 'c', title: 'Book a table: Friday?', status: 'done' } as Conversation;

const branch = [
  e({ type: 'message', message: { role: 'user', parts: [{ type: 'text', text: 'Book a table for two on Friday' }] } }),
  e({
    type: 'message',
    message: {
      role: 'assistant',
      parts: [
        { type: 'tool-call', toolCallId: 'a', toolName: 'set', input: { target: { ref: 'a3' }, value: 'hunter2' } },
      ],
    },
  }),
  e({
    type: 'message',
    message: {
      role: 'tool',
      parts: [
        {
          type: 'tool-result',
          toolCallId: 'a',
          toolName: 'set',
          text: 'set · [a3] textbox «Name» · set-value · dispatched\nmore',
          isError: false,
        },
      ],
    },
  }),
  e({
    type: 'message',
    message: { role: 'assistant', parts: [{ type: 'text', text: 'Booked for **Friday at 8pm**.' }] },
  }),
  e({ type: 'ui', kind: 'download', data: { name: 'booking.md', downloadId: 4, bytes: 120 } }),
];

describe('export', () => {
  it('writes the conversation with its steps in brief', () => {
    const md = conversationMarkdown(conversation, branch, new Date('2026-10-07T10:00:00Z'));
    expect(md).toContain('# Book a table: Friday?');
    expect(md).toContain('## You · 2026-10-07 09:00\n\nBook a table for two on Friday');
    expect(md).toContain('- ✓ set · [a3] textbox «Name» · set-value · dispatched');
    expect(md).toContain('Booked for **Friday at 8pm**.');
    expect(md).toContain('> Saved the file booking.md');
    expect(md).not.toContain('hunter2');
  });

  it('lists the page read when the run began, and no done that went through', () => {
    const md = conversationMarkdown(conversation, [
      e({
        type: 'message',
        message: {
          role: 'user',
          parts: [
            { type: 'text', text: 'What does this page say?' },
            { type: 'text', text: 'OUTLINE', attached: { kind: 'outline', label: 'tab 1 rev 2' } },
          ],
        },
      }),
      e({
        type: 'message',
        message: { role: 'assistant', parts: [{ type: 'tool-call', toolCallId: 'd', toolName: 'done', input: {} }] },
      }),
      e({
        type: 'message',
        message: {
          role: 'tool',
          parts: [{ type: 'tool-result', toolCallId: 'd', toolName: 'done', text: 'done: success', isError: false }],
        },
      }),
      e({ type: 'message', message: { role: 'assistant', parts: [{ type: 'text', text: 'It lists plugins.' }] } }),
    ]);
    expect(md).toContain('Steps:\n- ✓ Looked at the page\n');
    expect(md).not.toContain('done: success');
    expect(md).not.toContain('OUTLINE');
  });

  it('names the file from the title', () => {
    expect(exportName(conversation)).toBe('Book a table Friday.md');
  });
});

describe('a selection', () => {
  it('goes inside the boundary with its site, after the extension’s line', async () => {
    const parts = await attachmentParts(
      [{ type: 'selection', text: 'Kettle: 49.90', url: 'https://shop.example/kettle?id=1', title: 'Kettle «sale»' }],
      {
        conversationId: 'c',
        wrap: text => text,
        wrapPage: (text, site) => `<<<page-content N site=${site}>>>\n${text}\n<<<end-page-content N>>>`,
        contextWindow: 16_384,
        vision: false,
      },
    );
    expect(parts).toHaveLength(1);
    const part = parts[0] as { text: string; attached: { kind: string } };
    expect(part.attached.kind).toBe('selection');
    expect(part.text).toBe(
      '[Nanobrowser note: the user selected this text on the page «Kettle sale» («https://shop.example/kettle?id=1»).]\n<<<page-content N site=shop.example>>>\nKettle: 49.90\n<<<end-page-content N>>>',
    );
  });
});
