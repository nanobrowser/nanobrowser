import { describe, it, expect } from 'vitest';
import { extractJsonFromModelOutput, removeThinkTags } from '../messages/utils';

describe('removeThinkTags', () => {
  it('removes well-formed think tags', () => {
    const input = '<think>internal reasoning</think>{"action": "click"}';
    expect(removeThinkTags(input)).toBe('{"action": "click"}');
  });

  it('removes think tags spanning multiple lines', () => {
    const input = '<think>\nline1\nline2\n</think>\n{"result": true}';
    expect(removeThinkTags(input)).toBe('{"result": true}');
  });

  it('removes stray closing think tag and everything before it', () => {
    const input = 'some reasoning</think>{"action": "done"}';
    expect(removeThinkTags(input)).toBe('{"action": "done"}');
  });

  it('returns input unchanged when no think tags present', () => {
    const input = '{"action": "click", "index": 5}';
    expect(removeThinkTags(input)).toBe(input);
  });

  it('returns empty string when content is only think tags', () => {
    const input = '<think>everything is internal</think>';
    expect(removeThinkTags(input)).toBe('');
  });
});

describe('extractJsonFromModelOutput', () => {
  it('parses plain JSON', () => {
    const input = '{"action": "click", "index": 5}';
    const result = extractJsonFromModelOutput(input);
    expect(result).toEqual({ action: 'click', index: 5 });
  });

  it('parses JSON wrapped in generic code block', () => {
    const input = '```\n{"action": "done"}\n```';
    const result = extractJsonFromModelOutput(input);
    expect(result).toEqual({ action: 'done' });
  });

  it('parses JSON wrapped in json-tagged code block', () => {
    const input = '```json\n{"action": "navigate", "url": "https://example.com"}\n```';
    const result = extractJsonFromModelOutput(input);
    expect(result).toEqual({ action: 'navigate', url: 'https://example.com' });
  });

  it('parses Llama tool_call_start_id format', () => {
    const toolCall = JSON.stringify({ parameters: JSON.stringify({ action: 'click' }) });
    const input = `<|tool_call_start_id|>${toolCall}<|tool_call_end_id|>`;
    const result = extractJsonFromModelOutput(input);
    expect(result).toEqual({ action: 'click' });
  });

  it('parses Llama tool_call_start_id format with missing end tag', () => {
    const toolCall = JSON.stringify({ parameters: JSON.stringify({ action: 'scroll' }) });
    const input = `<|tool_call_start_id|>${toolCall}`;
    const result = extractJsonFromModelOutput(input);
    expect(result).toEqual({ action: 'scroll' });
  });

  it('parses Llama python_tag format', () => {
    const pythonCall = JSON.stringify({ parameters: { output: JSON.stringify({ action: 'done' }) } });
    const input = `<|python_tag|>${pythonCall}<|/python_tag|>`;
    const result = extractJsonFromModelOutput(input);
    expect(result).toEqual({ action: 'done' });
  });

  it('throws ResponseParseError on invalid JSON', () => {
    expect(() => extractJsonFromModelOutput('not valid json at all')).toThrow();
  });

  it('throws ResponseParseError on empty string', () => {
    expect(() => extractJsonFromModelOutput('')).toThrow();
  });

  it('parses nested JSON objects', () => {
    const input = '{"action": "fill", "params": {"field": "email", "value": "test@example.com"}}';
    const result = extractJsonFromModelOutput(input);
    expect(result).toEqual({ action: 'fill', params: { field: 'email', value: 'test@example.com' } });
  });
});
