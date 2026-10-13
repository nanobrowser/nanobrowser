import { describe, expect, it } from 'vitest';
import { resolveProfile } from '../profiles';

describe('the count factor', () => {
  it('is 1.3 for Anthropic and unset for the providers whose count is close to 4 characters a token', () => {
    expect(resolveProfile({ kind: 'anthropic', modelName: 'claude-haiku-4-5-20251001' }).countFactor).toBe(1.3);
    for (const kind of ['openai', 'gemini', 'ollama', 'openrouter'] as const) {
      expect(resolveProfile({ kind, modelName: 'm' }).countFactor).toBeUndefined();
    }
  });
});
