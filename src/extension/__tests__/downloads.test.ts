import { describe, expect, it } from 'vitest';
import { isNumberedCopy } from '../downloads';

describe('isNumberedCopy', () => {
  it('is true for the name with a number Chrome added', () => {
    expect(isNumberedCopy('prices (1).csv', 'prices.csv')).toBe(true);
    expect(isNumberedCopy('prices (12).csv', 'prices.csv')).toBe(true);
    expect(isNumberedCopy('notes (2)', 'notes')).toBe(true);
    expect(isNumberedCopy('a.b (1).txt', 'a.b.txt')).toBe(true);
  });

  it('is false for any other name', () => {
    expect(isNumberedCopy('39eecd9e-590f-403d-a28a-57b1137e9af3.csv', 'hn-top.csv')).toBe(false);
    expect(isNumberedCopy('prices.csv', 'prices.csv')).toBe(false);
    expect(isNumberedCopy('prices (x).csv', 'prices.csv')).toBe(false);
    expect(isNumberedCopy('prices (1).txt', 'prices.csv')).toBe(false);
    expect(isNumberedCopy('other (1).csv', 'prices.csv')).toBe(false);
  });
});
