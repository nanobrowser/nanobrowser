import { afterEach, describe, expect, it, vi } from 'vitest';
import old from '../../../fixtures/upgrade/old-storage.json';
import { deleteOldChats, isOldChatKey, localTime, oldChatsFilename, oldChatsMarkdown, readOldChats } from '../legacy';

function fakeLocal(initial: Record<string, unknown>) {
  const data: Record<string, unknown> = structuredClone(initial);
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (keys: string[] | string | null) => {
          if (keys === null) return structuredClone(data);
          const list = typeof keys === 'string' ? [keys] : keys;
          return structuredClone(Object.fromEntries(list.filter(k => k in data).map(k => [k, data[k]])));
        },
        set: async (items: Record<string, unknown>) => void Object.assign(data, items),
        remove: async (keys: string[] | string) => {
          for (const k of typeof keys === 'string' ? [keys] : keys) delete data[k];
        },
        onChanged: { addListener: () => undefined },
      },
    },
  });
  return data;
}

afterEach(() => vi.unstubAllGlobals());

describe('the old conversations', () => {
  it('knows which keys are theirs', () => {
    expect(['chat_sessions_meta', 'chat_messages_x', 'chat_agent_step_x'].every(isOldChatKey)).toBe(true);
    expect(['nb.settings', 'favorites', 'chat'].some(isOldChatKey)).toBe(false);
  });

  it('reads each conversation with its messages', async () => {
    fakeLocal(old);
    const chats = await readOldChats();
    expect(chats.map(c => [c.chat.id, c.messages.length])).toEqual([
      ['s1', 2],
      ['s2', 2],
    ]);
  });

  it('writes one Markdown file, newest first, each message under its actor and time', async () => {
    fakeLocal(old);
    const md = oldChatsMarkdown(await readOldChats(), 1760000000000);
    expect(md.startsWith('# Nanobrowser v0.2: legacy conversations\n')).toBe(true);
    expect(md.indexOf('## Compare laptops')).toBeLessThan(md.indexOf('## Find a flight'));
    expect(md).toContain(`**User** · ${localTime(1751000000000)}\n\nFind a cheap flight to a made-up city.`);
    expect(md).toContain('**Navigator** · ');
    expect(md).toContain('**Planner** · ');
    // The agent's step records are not part of it.
    expect(md).not.toContain('"history"');
  });

  it('names the file with the date', () => {
    expect(oldChatsFilename(new Date(2026, 9, 12, 9, 5).getTime())).toBe(
      'nanobrowser-v0.2-conversations-2026-10-12.md',
    );
  });

  it('deletes the list, the messages and the step records, and nothing else', async () => {
    const data = fakeLocal({ ...old, 'nb.settings': {} });
    await deleteOldChats();
    expect(Object.keys(data).filter(isOldChatKey)).toEqual([]);
    expect(data).toHaveProperty('nb.settings');
    expect(data).toHaveProperty('favorites');
  });
});
