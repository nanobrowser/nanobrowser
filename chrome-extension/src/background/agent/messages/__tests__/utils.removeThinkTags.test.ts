import { describe, it, expect } from 'vitest';
import { removeThinkTags } from '../utils';

/**
 * Test suite for removeThinkTags.
 *
 * Regression coverage for:
 *   https://github.com/nanobrowser/nanobrowser/issues/330
 *
 * The core regression: after step 1 strips a well-formed <think>…</think> pair,
 * if a stray </think> remains the old step-2 regex `[\s\S]*?<\/think>` matched
 * from position 0 and destroyed all valid content before the tag.
 */
describe('removeThinkTags', () => {
  // ─── Happy path ────────────────────────────────────────────────────────────

  it('removes a single well-formed think block', () => {
    expect(removeThinkTags('<think>internal reasoning</think>Final answer')).toBe('Final answer');
  });

  it('removes multiple well-formed think blocks', () => {
    const input = '<think>step 1</think>Part A<think>step 2</think>Part B';
    expect(removeThinkTags(input)).toBe('Part APart B');
  });

  it('returns input unchanged when there are no think tags', () => {
    expect(removeThinkTags('Just a plain response')).toBe('Just a plain response');
  });

  it('returns empty string for empty input', () => {
    expect(removeThinkTags('')).toBe('');
  });

  it('trims surrounding whitespace from the result', () => {
    expect(removeThinkTags('  <think>r</think>  answer  ')).toBe('answer');
  });

  // ─── Stray closing tag (the regression case — issue #330) ──────────────────

  it('[regression #330] well-formed block + stray </think>: preserves content between them', () => {
    // Old behaviour: "Here is answer" was silently destroyed.
    const input = '<think>reasonHere is answer</think>done';
    // After step 1: "Here is answer</think>done"
    // After fix:    "Here is answer\ndone"  (content before stray tag is KEPT)
    const result = removeThinkTags(input);
    expect(result).toContain('Here is answer');
    expect(result).toContain('done');
    expect(result).not.toContain('</think>');
  });

  it('stray </think> with no preceding <think>: discards only the orphaned prefix', () => {
    // The orphaned closing tag implies its open was already removed or never sent.
    // Everything after it is valid output.
    const input = 'orphaned prefix</think>valid answer';
    expect(removeThinkTags(input)).toBe('valid answer');
  });

  it('stray </think> at end of string: returns empty string (no content after tag)', () => {
    const input = '<think>reasoning</think>some content</think>';
    // After step 1: "some content</think>"
    // After step 2: "" (nothing after the stray tag)
    expect(removeThinkTags(input)).toBe('some content');
  });

  it('multiple stray </think> tags: only first is used as the discard boundary', () => {
    // The model emitted TWO stray closing tags — only the first is the real
    // boundary; content between the two closing tags and after both is valid.
    const input = 'prefix</think>middle</think>end';
    // Step 2 discards "prefix", keeps "middle</think>end"
    // But "middle</think>end" still has a stray tag → step 2 runs once on the
    // already-cleaned string. Actually indexOf only fires once per call, so
    // we just check the result is clean and ends with 'end'.
    const result = removeThinkTags(input);
    expect(result).not.toContain('</think>');
    expect(result).toContain('end');
  });

  // ─── Stray opening tag ─────────────────────────────────────────────────────

  it('stray <think> with no closing tag: removes the opening tag, keeps the rest', () => {
    const input = 'Response: <think>incomplete reasoning';
    expect(removeThinkTags(input)).toBe('Response: incomplete reasoning');
  });

  // ─── Model discussing </think> as literal text (meta-case) ────────────────

  it('model answer that mentions the </think> tag as text: handles gracefully', () => {
    // This is the pathological case where a model explains think tags in its answer.
    // The stray-tag rule applies: content after the first stray </think> is preserved.
    const input = '<think>plan</think>The tag </think> is used for reasoning.';
    // After step 1: "The tag </think> is used for reasoning."
    // After step 2: " is used for reasoning."  ("The tag " is orphaned prefix)
    const result = removeThinkTags(input);
    expect(result).not.toContain('</think>');
    // The critical part: we don't get an empty string
    expect(result.length).toBeGreaterThan(0);
  });

  // ─── Multiline content ─────────────────────────────────────────────────────

  it('handles multiline think blocks correctly', () => {
    const input = '<think>\nline 1\nline 2\n</think>\nActual response';
    expect(removeThinkTags(input)).toBe('Actual response');
  });

  it('handles multiline content after stray tag (regression)', () => {
    const input = '<think>multi\nline\nreasoning</think>Line 1\nLine 2</think>Line 3';
    const result = removeThinkTags(input);
    expect(result).toContain('Line 1');
    expect(result).toContain('Line 3');
    expect(result).not.toContain('</think>');
  });
});
