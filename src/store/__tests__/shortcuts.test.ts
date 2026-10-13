import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  checkShortcut,
  closeDb,
  deleteShortcut,
  listShortcuts,
  parseSkillMd,
  saveShortcut,
  setPinned,
  toSkillMd,
} from '../index';
import type { Shortcut } from '../index';

afterEach(async () => {
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
});

const full: Shortcut = {
  name: 'expense-report',
  description: 'File an expense report in Concur from the receipts I attach.',
  text: 'File an expense report from the attached receipts.\n\nOpen Expenses → Create report …',
  startUrl: 'https://www.concursolutions.com/',
  mode: 'ask',
  model: { providerId: 'p1', model: 'claude-sonnet-5-5' },
};

describe('SKILL.md', () => {
  it('writes the Agent Skills shape with the Nanobrowser fields under metadata', () => {
    expect(toSkillMd(full)).toBe(
      [
        '---',
        'name: expense-report',
        'description: File an expense report in Concur from the receipts I attach.',
        'disable-model-invocation: true',
        'user-invocable: true',
        'metadata:',
        '  nanobrowser:',
        '    start-url: https://www.concursolutions.com/',
        '    mode: ask',
        '    provider: p1',
        '    model: claude-sonnet-5-5',
        '---',
        'File an expense report from the attached receipts.',
        '',
        'Open Expenses → Create report …',
        '',
      ].join('\n'),
    );
  });

  it('reads back what it writes', () => {
    expect(parseSkillMd(toSkillMd(full))).toEqual(full);
    const bare: Shortcut = { name: 'summary', description: '', text: 'Summarise this page.' };
    expect(parseSkillMd(toSkillMd(bare))).toEqual(bare);
  });

  it('quotes values YAML would read differently', () => {
    const tricky: Shortcut = {
      name: 'tricky',
      description: 'Note: yes "quoted" # not a comment 中文',
      text: '---\nnot front matter\n---',
    };
    const md = toSkillMd(tricky);
    expect(md).toContain('description: "Note: yes \\"quoted\\" # not a comment 中文"');
    expect(parseSkillMd(md)).toEqual(tricky);
    expect(parseSkillMd(toSkillMd({ ...tricky, description: 'true' }))?.description).toBe('true');
  });

  it('reads comments, single quotes and a full example', () => {
    const md = [
      '---',
      'name: expense-report',
      "description: 'It''s for Concur'",
      'disable-model-invocation: true      # the user starts it',
      'metadata:',
      '  nanobrowser:',
      '    start-url: https://www.concursolutions.com/',
      '    mode: auto',
      '---',
      'Go.',
    ].join('\n');
    expect(parseSkillMd(md)).toEqual({
      name: 'expense-report',
      description: "It's for Concur",
      text: 'Go.',
      startUrl: 'https://www.concursolutions.com/',
      mode: 'auto',
    });
  });

  it('drops a start URL that is not a web address, and an unknown mode', () => {
    const md = toSkillMd({ name: 'x', description: '', text: 'y' }).replace(
      '---\ny',
      'metadata:\n  nanobrowser:\n    start-url: javascript:alert(1)\n    mode: yolo\n---\ny',
    );
    expect(parseSkillMd(md)).toEqual({ name: 'x', description: '', text: 'y' });
  });

  it('is not a shortcut without front matter or a name', () => {
    expect(parseSkillMd('just text')).toBeNull();
    expect(parseSkillMd('---\ndescription: x\n---\nbody')).toBeNull();
  });
});

describe('checks', () => {
  it('needs a valid unused name, text, and a web start URL', () => {
    expect(checkShortcut(full)).toBeNull();
    expect(checkShortcut({ ...full, name: 'Expense Report' })).toBe('shortcut.error.name');
    expect(checkShortcut({ ...full, name: 'compact' })).toBe('shortcut.error.taken');
    expect(checkShortcut(full, [{ name: 'expense-report' }])).toBe('shortcut.error.taken');
    expect(checkShortcut({ ...full, text: '  ' })).toBe('shortcut.error.text');
    expect(checkShortcut({ ...full, startUrl: 'file:///etc/passwd' })).toBe('shortcut.error.url');
  });
});

describe('the store', () => {
  it('lists pinned shortcuts first, then by name', async () => {
    const a = await saveShortcut({ name: 'alpha', description: '', text: 'a' });
    await saveShortcut({ name: 'beta', description: '', text: 'b' });
    const c = await saveShortcut({ name: 'gamma', description: '', text: 'c', pinned: true });
    expect((await listShortcuts()).map(s => s.name)).toEqual(['gamma', 'alpha', 'beta']);
    await setPinned(c, false);
    await setPinned(a, true);
    expect((await listShortcuts()).map(s => [s.name, s.pinned])).toEqual([
      ['alpha', true],
      ['beta', false],
      ['gamma', false],
    ]);
    await saveShortcut({ id: a, name: 'alpha', description: 'edited', text: 'a2', pinned: true });
    const edited = (await listShortcuts()).find(s => s.id === a);
    expect(edited).toMatchObject({ description: 'edited', text: 'a2', pinned: true });
    await deleteShortcut(a);
    expect((await listShortcuts()).map(s => s.name)).toEqual(['beta', 'gamma']);
  });
});
