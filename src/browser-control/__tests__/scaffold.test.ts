import { describe, expect, it } from 'vitest';
import * as layer from '../index';

describe('browser-control entry', () => {
  it('loads', () => {
    expect(layer).toBeTypeOf('object');
  });
});
