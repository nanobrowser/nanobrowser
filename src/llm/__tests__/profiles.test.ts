import { describe, expect, it } from 'vitest';
import { requestOutputLimit, resolveProfile } from '../profiles';

describe('model profiles', () => {
  it('reads the catalogue, also behind a vendor prefix', () => {
    expect(resolveProfile({ kind: 'anthropic', modelName: 'claude-sonnet-5-5' }).contextWindow).toBe(1_000_000);
    expect(resolveProfile({ kind: 'openrouter', modelName: 'anthropic/claude-sonnet-5-5' }).vision).toBe(true);
    expect(resolveProfile({ kind: 'ollama', modelName: 'qwen3:8b' }).contextWindow).toBe(32_768);
  });

  it('falls back to a cautious default', () => {
    expect(resolveProfile({ kind: 'ollama', modelName: 'mystery' }).contextWindow).toBe(16_384);
    expect(resolveProfile({ kind: 'openai', modelName: 'mystery' }).contextWindow).toBe(128_000);
  });

  it('applies the user overrides, and detection only lowers the window', () => {
    const base = { kind: 'ollama' as const, modelName: 'qwen3:8b' };
    expect(resolveProfile({ ...base, overrides: { contextWindow: 65_536, vision: true } })).toMatchObject({
      contextWindow: 65_536,
      vision: true,
    });
    expect(resolveProfile({ ...base, overrides: { contextWindow: 65_536 }, detectedContext: 8192 }).contextWindow).toBe(
      8192,
    );
    expect(resolveProfile({ ...base, overrides: { contextWindow: 4096 }, detectedContext: 8192 }).contextWindow).toBe(
      4096,
    );
  });

  it('caps the output limit of a request to a quarter of the window', () => {
    expect(
      requestOutputLimit(resolveProfile({ kind: 'ollama', modelName: 'x', overrides: { contextWindow: 8192 } })),
    ).toBe(2048);
    expect(requestOutputLimit(resolveProfile({ kind: 'anthropic', modelName: 'claude-sonnet-5-5' }))).toBe(16_384);
  });

  it("lets a local server's reported maximum raise the default for a model outside the catalogue", () => {
    const at = new Date().toISOString();
    const base = {
      kind: 'lmstudio' as const,
      modelName: 'recursivesi/flint',
      fromApi: { contextWindow: 262_144, at },
    };
    expect(resolveProfile({ ...base, detectedContext: 262_144 }).contextWindow).toBe(262_144);
    // The loaded window still lowers it when the server loaded less than the model supports.
    expect(resolveProfile({ ...base, detectedContext: 8192 }).contextWindow).toBe(8192);
  });
});
