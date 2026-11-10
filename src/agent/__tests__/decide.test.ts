import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDecision } from '../decide';
import { kindOf, toolsForRun } from '../tools';

afterEach(() => vi.unstubAllGlobals());

describe('the decision tool', () => {
  it('is offered as an agent-owned read for every model', () => {
    for (const vision of [false, true]) {
      expect(toolsForRun({ vision }).find(tool => tool.name === 'decide')).toMatchObject({
        name: 'decide',
        source: 'agent',
      });
    }
    expect(kindOf('decide', {})).toBe('read');
  });

  it('explains how to configure a provider without sending content when it is unavailable', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const provider of [null, 'jev', 'openai'] as const) {
      const result = await runDecision({}, { provider });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('Settings');
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects malformed questions without sending or reflecting supplied content', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const result = await runDecision(
      { state: 'private page content', questions: [], apiKey: 'private argument' },
      { provider: 'jev', apiKey: 'key' },
    );
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining('INVALID_ARGUMENT') });
    expect(result.text).not.toContain('private');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('returns advisory data without cancelling the caller’s signal', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'jev-latest',
          answers: { present: { type: 'noul', noul: 0.9 } },
          usage: { input_tokens: 10, output_tokens: 2 },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    const result = await runDecision(
      {
        state: 'The page says Complete.',
        questions: [{ name: 'present', type: 'predicate', instructions: 'Is Complete present?' }],
      },
      { provider: 'jev', apiKey: 'key' },
      { signal },
    );
    expect(result.isError).toBe(false);
    expect(result.text).toMatch(/^decide · advisory/);
    expect(result.text).toContain('"probability":0.9');
    expect(result.text).toContain('never authorize');
    expect(signal.aborted).toBe(false);
  });
  it('turns provider failures into safe tool errors without reflecting credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private key and network details')));
    const result = await runDecision(
      { state: 'text', questions: [{ name: 'present', type: 'predicate', instructions: 'Is text present?' }] },
      { provider: 'jev', apiKey: 'private key' },
    );
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining('DECISION_FAILED') });
    expect(result.text).not.toContain('private');
    expect(result.text).not.toContain('network details');
  });
  it('does not send a decision after Stop or expose the cancellation reason', async () => {
    const fetch = vi.fn().mockRejectedValue(new DOMException('private cancellation reason', 'AbortError'));
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    controller.abort('private cancellation reason');
    const result = await runDecision(
      { state: 'text', questions: [{ name: 'present', type: 'predicate', instructions: 'Is text present?' }] },
      { provider: 'jev', apiKey: 'key' },
      { signal: controller.signal },
    );
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining('DECISION_CANCELLED') });
    expect(result.text).not.toContain('private');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('surfaces authentication and rate-limit HTTP statuses without exposing the provider payload or key', async () => {
    for (const status of [401, 429]) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'private provider payload' }), { status })),
      );
      const result = await runDecision(
        { state: 'text', questions: [{ name: 'present', type: 'predicate', instructions: 'Is text present?' }] },
        { provider: 'openai', apiKey: 'private API key' },
      );
      expect(result.isError).toBe(true);
      expect(result.text).toContain('http');
      expect(result.text).toContain(`HTTP ${status}`);
      expect(result.text).not.toContain('private');
    }
  });
});
