import { describe, it, expect } from 'vitest';
import { removeThinkTags } from '../utils';

describe('removeThinkTags', () => {
  // ── Case A: well-formed pair ────────────────────────────────────────────────

  it('removes a well-formed <think>…</think> block and returns the answer', () => {
    expect(removeThinkTags('<think>reason</think>Here is answer')).toBe('Here is answer');
  });

  it('removes multiple well-formed pairs', () => {
    expect(removeThinkTags('<think>r1</think>answer<think>r2</think> done')).toBe('answerdone');
  });

  it('handles multiline reasoning blocks', () => {
    const input = '<think>\nstep 1\nstep 2\n</think>\nFinal answer';
    expect(removeThinkTags(input)).toBe('Final answer');
  });

  // ── THE BUG (issue #330): stray </think> after a well-formed pair ───────────

  it('does NOT wipe content when a stray </think> appears after a well-formed pair', () => {
    // Before fix: returned 'done' — wiped 'Here is answer'
    const input = '<think>reason</think>Here is answer</think>done';
    const result = removeThinkTags(input);
    // The answer text must survive; the stray tag may remain as harmless noise
    expect(result).toContain('Here is answer');
    expect(result).not.toBe('done');
  });

  it('handles the exact repro from issue #330', () => {
    // Reported input: 'reason' + 'Here is answer' + 'done'
    const input = '<think>reason</think>Here is answer</think>done';
    expect(removeThinkTags(input)).toContain('Here is answer');
  });

  it('preserves answer when model discusses </think> in inline code', () => {
    const input = '<think>I will explain the tag</think>The tag `</think>` ends reasoning blocks.';
    const result = removeThinkTags(input);
    expect(result).toContain('The tag');
    expect(result).toContain('ends reasoning blocks.');
  });

  it('preserves answer when model uses </think> inside a fenced code block', () => {
    const answer = 'Use `</think>` to close the block\n```\n</think>\n```';
    const input = `<think>internal</think>${answer}`;
    const result = removeThinkTags(input);
    expect(result).toContain('Use');
    expect(result).toContain('close the block');
  });

  // ── Case B: orphan open tag (stream truncation) ─────────────────────────────

  it('removes leading orphan <think>…</think> when there is no opening tag match', () => {
    // Model opened <think> but never closed it before the answer
    const input = 'some reasoning here</think>actual answer';
    expect(removeThinkTags(input)).toBe('actual answer');
  });

  it('handles stream-truncated reasoning block (no opening <think>)', () => {
    const input = 'partial reasoning\nmore reasoning</think>\nThe answer is 42';
    expect(removeThinkTags(input)).toBe('The answer is 42');
  });

  // ── Edge cases ───────────────────────────────────────────────────────────────

  it('returns empty string for empty input', () => {
    expect(removeThinkTags('')).toBe('');
  });

  it('returns text unchanged when no think tags present', () => {
    expect(removeThinkTags('plain answer text')).toBe('plain answer text');
  });

  it('trims leading/trailing whitespace from the result', () => {
    expect(removeThinkTags('<think>r</think>  answer  ')).toBe('answer');
  });

  it('handles nested-looking tags gracefully (lazy match takes first </think>)', () => {
    // Lazy regex takes the first </think>, leaving '>more</think> end'
    const input = '<think>outer <think>inner</think>more</think> end';
    const result = removeThinkTags(input);
    // At minimum the string must not be the full original
    expect(result.length).toBeLessThan(input.length);
  });

  it('handles DeepSeek-R1 style output with reasoning then answer', () => {
    const input = '<think>\nLet me think step by step.\n1. First...\n2. Second...\n</think>\n\nThe final answer is: Paris';
    expect(removeThinkTags(input)).toBe('The final answer is: Paris');
  });

  it('handles GPT-5 output that mentions the think tag in explanation', () => {
    const thinking = '<think>This is internal reasoning</think>';
    const answer = 'To use reasoning models, they emit a <think> block which is </think> terminated.';
    const result = removeThinkTags(thinking + answer);
    expect(result).toContain('To use reasoning models');
    expect(result).toContain('terminated.');
  });
});
