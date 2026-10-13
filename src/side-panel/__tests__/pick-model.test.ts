import { describe, expect, it } from 'vitest';
import { pickModel } from '../Composer';

const a = { providerId: 'p1', model: 'a' };
const b = { providerId: 'p1', model: 'b' };
const models = [
  { ref: a, label: 'a · P1', name: 'a' },
  { ref: b, label: 'b · P1', name: 'b' },
];

describe('pickModel', () => {
  it('keeps the wanted model when it is configured', () => {
    expect(pickModel(models, b, a)).toEqual(b);
  });

  it('falls back to the default model when the wanted one is gone', () => {
    expect(pickModel(models, { providerId: 'old', model: 'b' }, b)).toEqual(b);
  });

  it('falls back to the first model when neither is configured', () => {
    expect(pickModel(models, { providerId: 'old', model: 'x' }, { providerId: 'gone', model: 'y' })).toEqual(a);
    expect(pickModel(models, null, null)).toEqual(a);
  });

  it('is null only with no model configured', () => {
    expect(pickModel([], a, b)).toBeNull();
  });
});
