// The model-API parser over recorded answers: Anthropic, Gemini and OpenRouter as they answered on 2026-10-10, and
// DeepSeek, Kimi, Mistral, Ollama and LM Studio in their documented shapes; and the reader's requests with a mocked
// fetch.
import { describe, expect, it, vi } from 'vitest';
import { factsFrom, readModelInfo } from '../model-info';

const ANTHROPIC_OPUS_5_5 = {
  type: 'model',
  id: 'claude-opus-5-5',
  max_input_tokens: 1_000_000,
  max_tokens: 128_000,
  capabilities: {
    effort: { supported: true, low: { supported: true }, max: { supported: true } },
    image_input: { supported: true },
    thinking: {
      supported: true,
      types: { enabled: { supported: false }, adaptive: { supported: true }, disabled: { supported: false } },
    },
  },
};

const GEMINI_3_8_FLASH = {
  name: 'models/gemini-3.8-flash',
  inputTokenLimit: 1_048_576,
  outputTokenLimit: 65_536,
  supportedGenerationMethods: ['generateContent', 'countTokens'],
  thinking: true,
};

const openrouter = (reasoning: object, params = ['reasoning', 'reasoning_effort', 'tools']) => ({
  id: 'x/model',
  context_length: 1_000_000,
  architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
  top_provider: { context_length: 1_000_000, max_completion_tokens: 128_000 },
  supported_parameters: params,
  reasoning,
});

describe('factsFrom', () => {
  it('reads the facts from Anthropic, None only when it can be disabled', () => {
    // "Thinking cannot be disabled" is left unknown: the SDK has another None for some models (Sonnet 5.5).
    expect(factsFrom(ANTHROPIC_OPUS_5_5)).toEqual({
      contextWindow: 1_000_000,
      maxOutput: 128_000,
      vision: true,
      reasons: true,
    });
    const sonnet = structuredClone(ANTHROPIC_OPUS_5_5);
    sonnet.capabilities.thinking.types.disabled.supported = true;
    expect(factsFrom(sonnet).acceptsNone).toBe(true);
  });

  it('reads the limits and a bare "reasons" from Gemini, and nothing about vision or None', () => {
    expect(factsFrom(GEMINI_3_8_FLASH)).toEqual({ contextWindow: 1_048_576, maxOutput: 65_536, reasons: true });
  });

  it("reads OpenRouter's explicit efforts and mandatory flag, and not a bare parameter", () => {
    // GPT-5.5: none among the supported efforts.
    expect(
      factsFrom(openrouter({ mandatory: false, supported_efforts: ['xhigh', 'high', 'medium', 'low', 'none'] })),
    ).toEqual({ contextWindow: 1_000_000, maxOutput: 128_000, vision: true, reasons: true, acceptsNone: true });
    // Sonnet 5.5: reasoning is mandatory.
    expect(factsFrom(openrouter({ mandatory: true, supported_efforts: ['high', 'low'] }))).toMatchObject({
      reasons: true,
      acceptsNone: false,
    });
    // Kimi K3: not mandatory, but none is not listed, so None stays unknown.
    const kimi = factsFrom(openrouter({ mandatory: false, supported_efforts: ['max', 'high', 'low'] }));
    expect(kimi.reasons).toBe(true);
    expect(kimi.acceptsNone).toBeUndefined();
    // Qwen Omni: a budget, no effort parameter: nothing about reasoning.
    const omni = factsFrom(openrouter({ mandatory: false, supports_max_tokens: true }, ['reasoning', 'tools']));
    expect(omni.reasons).toBeUndefined();
  });

  it('reads DeepSeek, Kimi and Mistral lists', () => {
    expect(
      factsFrom({
        id: 'deepseek-flash',
        context_window: 1_048_576,
        max_output_tokens: 393_216,
        input_modalities: ['text', 'image'],
        effort: { supported_levels: ['low', 'high', 'max'], default_level: 'high' },
      }),
    ).toEqual({ contextWindow: 1_048_576, maxOutput: 393_216, vision: true, reasons: true });
    expect(
      factsFrom({ id: 'kimi-k3', context_length: 1_048_576, supports_image_in: true, supports_reasoning: true }),
    ).toEqual({ contextWindow: 1_048_576, vision: true, reasons: true });
    expect(
      factsFrom({
        id: 'mistral-small',
        capabilities: { vision: false, function_calling: true },
        max_context_length: 32_768,
      }),
    ).toEqual({ contextWindow: 32_768, vision: false });
  });

  it("reads Ollama's capabilities and LM Studio's type", () => {
    expect(factsFrom({ capabilities: ['completion', 'vision', 'tools', 'thinking'] })).toEqual({
      vision: true,
      reasons: true,
    });
    expect(factsFrom({ capabilities: ['completion', 'tools'] })).toEqual({ vision: false, reasons: false });
    expect(factsFrom({ type: 'vlm' })).toEqual({ vision: true });
    expect(factsFrom({ type: 'llm' })).toEqual({ vision: false });
  });

  it('says nothing for a plain OpenAI-style entry', () => {
    expect(factsFrom({ id: 'gpt-5.5', object: 'model', created: 1, owned_by: 'system' })).toEqual({});
  });
});

describe('readModelInfo', () => {
  const answer = (body: unknown, ok = true) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 404 })) as unknown as typeof fetch;

  it("asks Anthropic for the one model, with the browser's header", async () => {
    const fetch = answer(ANTHROPIC_OPUS_5_5);
    const facts = await readModelInfo({ kind: 'anthropic', modelName: 'claude-opus-5-5', apiKey: 'k' }, fetch);
    expect(facts?.reasons).toBe(true);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/models/claude-opus-5-5');
    expect(init.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });

  it('finds the model in an OpenAI-compatible list by its id', async () => {
    const fetch = answer({
      data: [{ id: 'other' }, { id: 'kimi-k3', context_length: 1_048_576, supports_reasoning: true }],
    });
    const facts = await readModelInfo(
      { kind: 'openai-compatible', modelName: 'kimi-k3', apiKey: 'k', baseUrl: 'https://api.moonshot.ai/v1' },
      fetch,
    );
    expect(facts).toEqual({ contextWindow: 1_048_576, reasons: true });
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('https://api.moonshot.ai/v1/models');
  });

  it('reads nothing for OpenAI, a failed request or a missing model', async () => {
    const fetch = answer({});
    expect(await readModelInfo({ kind: 'openai', modelName: 'gpt-5.5', apiKey: 'k' }, fetch)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(await readModelInfo({ kind: 'gemini', modelName: 'x', apiKey: 'k' }, answer({}, false))).toBeNull();
    expect(await readModelInfo({ kind: 'openrouter', modelName: 'a/b', apiKey: 'k' }, answer({ data: [] }))).toBeNull();
  });

  it("keeps only Ollama's capabilities: the window is detection's", async () => {
    const fetch = answer({ capabilities: ['completion', 'thinking'], model_info: { 'qwen3.context_length': 262_144 } });
    expect(await readModelInfo({ kind: 'ollama', modelName: 'qwen3:8b' }, fetch)).toEqual({
      vision: false,
      reasons: true,
    });
  });
});
