import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { closeDb, listShortcuts } from '@src/store';
import { addFirstShortcuts } from '../first-run';

afterEach(async () => {
  vi.unstubAllGlobals();
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
});

describe('first run', () => {
  it('adds an unpinned /summarize shortcut', async () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    await addFirstShortcuts();
    const [only, ...rest] = await listShortcuts();
    expect(rest).toEqual([]);
    expect(only).toMatchObject({
      name: 'summarize',
      description: 'Summarize this page',
      text: 'Summarize this page in a few bullet points.',
      pinned: false,
    });
  });

  it("writes it in the browser's language", async () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' });
    await addFirstShortcuts();
    const [only] = await listShortcuts();
    expect(only).toMatchObject({ description: '总结这个页面', text: '用几个要点总结这个页面。' });
  });
});
