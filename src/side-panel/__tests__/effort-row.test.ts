// The picker's effort row, as a pure function of capability and value.
import { describe, expect, it } from 'vitest';
import { effortRow } from '../ModelMenu';

describe('the effort row', () => {
  it('is not shown for a model with no effort choice', () => {
    expect(effortRow('none', 'low')).toBeNull();
  });

  it('offers all four for a model that takes None, and for an unknown one', () => {
    expect(effortRow('optional', 'none')).toEqual({ pills: ['none', 'low', 'medium', 'high'], shown: 'none' });
    expect(effortRow(undefined, 'high')).toEqual({ pills: ['none', 'low', 'medium', 'high'], shown: 'high' });
  });

  it('offers Low to High for a model that cannot stop, and shows None as Low', () => {
    expect(effortRow('always', 'none')).toEqual({ pills: ['low', 'medium', 'high'], shown: 'low' });
    expect(effortRow('always', 'medium')?.shown).toBe('medium');
  });
});
