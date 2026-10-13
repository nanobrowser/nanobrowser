import { describe, expect, it } from 'vitest';
import type { SavedShortcut } from '@src/store/shortcuts';
import { launcherItems } from '../Composer';

const shortcut = (name: string, pinned = false, description = ''): SavedShortcut => ({
  id: name,
  name,
  description,
  text: `text of ${name}`,
  pinned,
  updatedAt: '',
});

const names = (query: string, list: SavedShortcut[]) =>
  launcherItems(query, list).map(i => (i.kind === 'shortcut' ? i.shortcut.name : `/${i.command}`));

describe('the / launcher', () => {
  const list = [shortcut('alpha'), shortcut('news-digest', true), shortcut('compare', false, 'Compare prices')];

  it('lists pinned shortcuts, the others, then /new and /compact', () => {
    expect(names('', list)).toEqual(['news-digest', 'alpha', 'compare', '/new', '/compact']);
  });

  it('filters by name and description, and commands by prefix', () => {
    expect(names('pri', list)).toEqual(['compare']);
    expect(names('comp', list)).toEqual(['compare', '/compact']);
    expect(names('ne', list)).toEqual(['news-digest', '/new']);
    expect(names('zzz', list)).toEqual([]);
  });
});
