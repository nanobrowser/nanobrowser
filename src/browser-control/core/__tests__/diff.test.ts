import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyDiff, diffLines, renderDiff } from '../perception/diff';
import { RefRegistry } from '../refs';
import type { Capture } from '../perception/capture';
import { buildObservation } from '../perception/observe';

describe('snapshot diffs', () => {
  const before = [
    'main',
    '  [e7] textbox "Search" = "acme"',
    '  [e9] checkbox "Overdue only" (checked)',
    '  [e22] button "Delete"',
  ];
  const after = [
    'main',
    '  [e7] textbox "Search" = "acme"',
    '  [e9] checkbox "Overdue only" (unchecked)',
    '  dialog "Delete invoice INV-1042?"',
    '    [e57] button "Cancel" (focused)',
    '    [e58] button "Delete"',
  ];

  it('is exact: the previous outline with the diff applied is the new one', () => {
    const ops = diffLines(before, after)!;
    expect(applyDiff(before, ops)).toEqual(after);
  });

  it('renders added, removed and changed lines', () => {
    const { text, added, removed, changed } = renderDiff(diffLines(before, after)!, 14);
    expect(text.split('\n')).toEqual([
      'changes since rev 14',
      '-   [e22] button "Delete"',
      '~   [e9] checkbox "Overdue only" (unchecked)   (was: [e9] checkbox "Overdue only" (checked))',
      '+   dialog "Delete invoice INV-1042?"',
      '+     [e57] button "Cancel" (focused)',
      '+     [e58] button "Delete"',
    ]);
    expect([added, removed, changed]).toEqual([['e57', 'e58'], ['e22'], 1]);
  });

  it('says when nothing changed', () => {
    expect(renderDiff(diffLines(before, before)!, 3).text).toBe('no changes since rev 3');
  });

  it('applies exactly between two real outlines of different pages', () => {
    const outline = (page: string) => {
      const capture = JSON.parse(readFileSync(`${__dirname}/payloads/${page}.capture.json`, 'utf8')) as Capture;
      return buildObservation(capture, new RefRegistry('e'), { mode: 'all', budget: 30_000 }).body.split('\n');
    };
    const a = outline('form');
    const b = outline('d-clickables');
    expect(applyDiff(a, diffLines(a, b)!)).toEqual(b);
  });
});
