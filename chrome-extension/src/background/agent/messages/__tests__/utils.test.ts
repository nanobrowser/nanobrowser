import { describe, expect, it } from 'vitest';
import { removeThinkTags } from '../utils';

describe('removeThinkTags', () => {
  it('removes well-formed think blocks', () => {
    expect(removeThinkTags('before<think>internal reasoning</think>after')).toBe('beforeafter');
  });

  it('preserves content before an unmatched closing tag', () => {
    expect(removeThinkTags('Legitimate content</think> /> and after')).toBe('Legitimate content /> and after');
  });
});
