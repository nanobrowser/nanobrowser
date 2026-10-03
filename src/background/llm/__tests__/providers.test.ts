import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { type ModelConfig, type ProviderConfig } from '@extension/storage';
import {
  createChatModel,
  getOllamaBaseUrl,
  getReasoningEffort,
  getStructuredMode,
  isOpenAIReasoningModel,
} from '../providers';
import { generateStructured } from '../generate';
import { toolCallMessage, toolResultMessage, userMessage } from '../messages';
import type { ChatModel } from '../types';

vi.mock('@extension/i18n', () => ({
  t: (key: string, substitutions?: string | string[]) => `${key}:${[substitutions].flat().join(',')}`,
}));

interface CapturedRequest {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** A fetch that records the request and answers 400, so no retries happen */
function captureFetch() {
  const requests: CapturedRequest[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : {},
    });
    return new Response(JSON.stringify({ error: { message: 'captured', type: 'invalid_request_error' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, requests };
}

/** A fetch that records the request and answers with an Anthropic message holding `content` */
function anthropicFetch(content: Record<string, unknown>[], stopReason?: string) {
  const requests: CapturedRequest[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    const message = {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude',
      content,
      stop_reason: stopReason ?? (content.some(part => part.type === 'tool_use') ? 'tool_use' : 'end_turn'),
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    return new Response(JSON.stringify(message), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, requests };
}

const provider = (overrides: Partial<ProviderConfig> = {}): ProviderConfig => ({ apiKey: 'test-key', ...overrides });
const model = (providerId: string, modelName: string, overrides: Partial<ModelConfig> = {}): ModelConfig => ({
  provider: providerId,
  modelName,
  ...overrides,
});

const schema = z.object({ answer: z.string(), optional: z.string().optional() });

/** Run one structured call against the captured fetch and return the request */
async function captureRequest(chatModel: ChatModel, requests: CapturedRequest[]): Promise<CapturedRequest> {
  await generateStructured({ chatModel, messages: [userMessage('hi')], schema, name: 'planner_output' }).catch(
    () => undefined,
  );
  expect(requests.length).toBeGreaterThan(0);
  return requests[0];
}

describe('isOpenAIReasoningModel', () => {
  it.each([
    ['o3', true],
    ['gpt-5', true],
    ['gpt-5-chat-latest', false],
    ['openai/gpt-5', true],
    ['gpt-6-astra', true],
    ['openai/gpt-6.1-sol', true],
    ['gpt-4.1', false],
  ])('%s -> %s', (name, expected) => {
    expect(isOpenAIReasoningModel(name)).toBe(expected);
  });
});

describe('getStructuredMode', () => {
  it.each([
    ['custom_openai', 'Llama-4-Maverick-17B-128E-Instruct-FP8', 'text'],
    ['openrouter', 'meta-llama/Llama-3.3-70B-Instruct', 'text'],
    ['grok', 'grok-4', 'tool'],
    ['deepseek', 'deepseek-v4-flash', 'tool'],
    ['deepseek', 'deepseek-v4-pro', 'tool'],
    ['qwen', 'qwen3-max', 'text'],
    ['qwen', 'qwen-turbo', 'text'],
    ['openai', 'gpt-4.1', 'native'],
    ['anthropic', 'claude-sonnet-4-5', 'tool'],
    ['anthropic', 'claude-opus-5-5', 'tool'],
    ['gemini', 'gemini-2.5-flash', 'native'],
    ['azure_openai_2', 'my-deployment', 'native'],
    ['custom_openai', 'qwen', 'native'],
  ])('%s %s -> %s', (providerId, modelName, expected) => {
    expect(getStructuredMode(providerId, modelName)).toBe(expected);
  });
});

describe('createChatModel', () => {
  it('builds the expected provider and model id', () => {
    const cases: [string, string, string][] = [
      ['openai', 'gpt-4.1', 'openai.chat'],
      ['custom_openai', 'qwen', 'openai.chat'],
      ['my_custom_id', 'qwen', 'openai.chat'],
      ['anthropic', 'claude-sonnet-4-5', 'anthropic.messages'],
      ['deepseek', 'deepseek-v4-flash', 'deepseek.chat'],
      ['gemini', 'gemini-2.5-flash', 'google.generative-ai'],
      ['grok', 'grok-4', 'xai.responses'],
      ['openrouter', 'openai/gpt-4o', 'openrouter'],
      ['qwen', 'qwen3-max', 'openai.chat'],
    ];
    for (const [providerId, modelName, expectedProvider] of cases) {
      const chatModel = createChatModel(provider(), model(providerId, modelName));
      const languageModel = chatModel.model as { provider: string; modelId: string };
      expect(languageModel.provider, providerId).toBe(expectedProvider);
      expect(languageModel.modelId).toBe(modelName);
      expect(chatModel.provider).toBe(providerId);
      expect(chatModel.modelName).toBe(modelName);
    }
  });

  it.each<[string, string, ModelConfig['reasoningEffort']]>([
    ['openai', 'gpt-5.5', 'low'],
    ['openai', 'gpt-4.1', 'low'],
    ['azure_openai_2', 'gpt-5', 'low'],
    ['anthropic', 'claude-haiku-4-5', 'low'],
    ['deepseek', 'deepseek-v4-pro', 'low'],
    ['gemini', 'gemini-3.8-flash', 'low'],
    ['grok', 'grok-4.7', 'low'],
    ['openrouter', 'openai/gpt-5-mini', undefined],
    ['qwen', 'qwen3-max', undefined],
    ['ollama', 'qwen3.8', undefined],
    ['custom_openai', 'qwen', undefined],
    ['my_custom_id', 'qwen', undefined],
  ])('%s %s defaults to reasoning effort %s', (providerId, name, expected) => {
    expect(getReasoningEffort(provider(), model(providerId, name))).toBe(expected);
  });

  it('uses the saved provider type for the default effort', () => {
    expect(
      getReasoningEffort(provider({ type: 'custom_openai' as ProviderConfig['type'] }), model('openai', 'o3')),
    ).toBe(undefined);
  });

  it.each<[ModelConfig['reasoningEffort'], ModelConfig['reasoningEffort']]>([
    ['none', undefined],
    ['low', 'low'],
    ['xhigh', 'xhigh'],
  ])('a saved effort %s is sent as %s', (effort, expected) => {
    expect(getReasoningEffort(provider(), model('anthropic', 'claude-opus-5-5', { reasoningEffort: effort }))).toBe(
      expected,
    );
  });

  it('never sends sampling and sets the AI SDK reasoning effort', () => {
    const settings = (providerId: string, name: string, overrides: Partial<ModelConfig> = {}) =>
      createChatModel(provider(), model(providerId, name, overrides)).settings;
    expect(settings('openai', 'gpt-4.1')).toEqual({ maxOutputTokens: 4096 });
    expect(settings('anthropic', 'claude-haiku-4-5')).toEqual({ maxOutputTokens: 4096, reasoning: 'low' });
    expect(settings('anthropic', 'claude-opus-5-5', { reasoningEffort: 'none' })).toEqual({ maxOutputTokens: 4096 });
    expect(settings('grok', 'grok-4.7')).toEqual({ maxOutputTokens: 4096 });
    expect(settings('openrouter', 'google/gemini-2.5-flash')).toEqual({ maxOutputTokens: 4096 });
    // DeepSeek and Gemini: no maxOutputTokens
    expect(settings('deepseek', 'deepseek-v4-flash', { reasoningEffort: 'high' })).toEqual({ reasoning: 'high' });
    expect(settings('gemini', 'gemini-2.5-flash')).toEqual({ reasoning: 'low' });
    expect(settings('gemini', 'gemini-3.8-flash', { reasoningEffort: 'none' })).toEqual({});
  });

  it('drops sampling for reasoning models and sets the reasoning effort', () => {
    const chatModel = createChatModel(provider(), model('openai', 'o3', { reasoningEffort: 'high' }));
    expect(chatModel.settings).toEqual({ maxOutputTokens: 4096 });
    expect(chatModel.providerOptions).toEqual({
      openai: { forceReasoning: true, strictJsonSchema: false, reasoningEffort: 'high' },
    });
  });

  it.each(['minimal', 'minimal/none'])('treats a saved %s effort as low', effort => {
    const reasoningEffort = effort as ModelConfig['reasoningEffort'];
    const openai = createChatModel(provider(), model('openai', 'gpt-5.4-mini', { reasoningEffort }));
    expect(openai.providerOptions?.openai?.reasoningEffort).toBe('low');

    const azure = createChatModel(
      provider({
        baseUrl: 'https://my-instance.openai.azure.com/',
        azureDeploymentNames: ['gpt-5'],
        azureApiVersion: '2025-04-01-preview',
      }),
      model('azure_openai', 'gpt-5', { reasoningEffort }),
    );
    expect(azure.providerOptions?.openai?.reasoningEffort).toBe('low');
  });

  it.each<[string, string]>([
    ['openai', 'gpt-5'],
    ['openai', 'gpt-5.1'],
    ['openai', 'o3'],
    ['azure_openai', 'gpt-5'],
  ])('maps xhigh on %s %s to high, which it supports', (providerId, name) => {
    const providerConfig = provider({
      baseUrl: 'https://my-instance.openai.azure.com/',
      azureDeploymentNames: [name],
      azureApiVersion: '2025-04-01-preview',
    });
    const chatModel = createChatModel(providerConfig, model(providerId, name, { reasoningEffort: 'xhigh' }));
    expect(chatModel.providerOptions?.openai?.reasoningEffort).toBe('high');
  });

  it.each(['gpt-5.2', 'gpt-5.4-mini', 'gpt-5.5', 'gpt-6-astra', 'gpt-6.1-sol', 'openai/gpt-6-luna'])(
    'keeps xhigh on %s',
    name => {
      const chatModel = createChatModel(provider(), model('openai', name, { reasoningEffort: 'xhigh' }));
      expect(chatModel.providerOptions?.openai?.reasoningEffort).toBe('xhigh');
    },
  );

  it('sends xhigh as is to other models on custom endpoints', () => {
    const chatModel = createChatModel(provider(), model('my_custom_id', 'qwen', { reasoningEffort: 'xhigh' }));
    expect(chatModel.providerOptions?.openai?.reasoningEffort).toBe('xhigh');
  });

  describe('ollama', () => {
    it.each([
      [undefined, 'http://localhost:11434/v1'],
      ['', 'http://localhost:11434/v1'],
      ['http://localhost:11434', 'http://localhost:11434/v1'],
      ['http://localhost:11434/', 'http://localhost:11434/v1'],
      ['http://192.168.1.5:11434/v1', 'http://192.168.1.5:11434/v1'],
      [' http://192.168.1.5:11434/v1/ ', 'http://192.168.1.5:11434/v1'],
    ])('maps base URL %j to %s', (baseUrl, expected) => {
      expect(getOllamaBaseUrl(baseUrl)).toBe(expected);
    });

    it('sends a chat completions request with the json schema response format and no effort', async () => {
      const { fetch, requests } = captureFetch();
      const chatModel = createChatModel(
        provider({ apiKey: '', baseUrl: 'http://localhost:11434' }),
        model('ollama', 'qwen3.8:27b-mlx'),
        { fetch },
      );
      expect(chatModel.structuredMode).toBe('native');

      const request = await captureRequest(chatModel, requests);
      expect(request.url).toBe('http://localhost:11434/v1/chat/completions');
      expect(request.headers.get('authorization')).toBe('Bearer ollama');
      expect(request.body).toMatchObject({
        model: 'qwen3.8:27b-mlx',
        max_tokens: 4096,
        response_format: { type: 'json_schema', json_schema: { name: 'planner_output', strict: false } },
      });
      expect(request.body.temperature).toBeUndefined();
      expect(request.body.top_p).toBeUndefined();
      expect(request.body.reasoning_effort).toBeUndefined();
    });

    it('sends a chosen reasoning effort', async () => {
      const { fetch, requests } = captureFetch();
      const chatModel = createChatModel(provider(), model('ollama', 'qwen3.8', { reasoningEffort: 'medium' }), {
        fetch,
      });
      const request = await captureRequest(chatModel, requests);
      expect(request.body.reasoning_effort).toBe('medium');
    });

    it("doesn't treat model names that look like OpenAI reasoning models as reasoning models", () => {
      const chatModel = createChatModel(provider(), model('ollama', 'olmo2:13b', { reasoningEffort: 'low' }));
      expect(chatModel.providerOptions).toEqual({ openai: { strictJsonSchema: false, reasoningEffort: 'low' } });
    });
  });

  describe('qwen', () => {
    // DashScope implements response_format json_object but not json_schema, so structured output has to go
    // through JSON Output in text mode. Sending json_schema makes every navigator step fail.
    it('sends json_object to the DashScope endpoint instead of json_schema', async () => {
      const { fetch, requests } = captureFetch();
      const chatModel = createChatModel(provider(), model('qwen', 'qwen3-max'), { fetch });
      expect(chatModel.structuredMode).toBe('text');
      expect(chatModel.jsonOutput).toBe(true);
      const request = await captureRequest(chatModel, requests);

      expect(request.url).toBe('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions');
      expect(request.body.response_format).toEqual({ type: 'json_object' });
      expect(request.body.reasoning_effort).toBeUndefined();
      expect(request.body.temperature).toBeUndefined();
      expect(request.body.top_p).toBeUndefined();
    });

    it.each<ModelConfig['reasoningEffort']>([undefined, 'none', 'low', 'xhigh'])(
      'sends no reasoning effort when %s is saved, which DashScope does not accept',
      async effort => {
        const { fetch, requests } = captureFetch();
        const chatModel = createChatModel(provider(), model('qwen', 'qwen3-max', { reasoningEffort: effort }), {
          fetch,
        });
        const request = await captureRequest(chatModel, requests);

        expect(request.body.reasoning_effort).toBeUndefined();
        expect(request.body.reasoning).toBeUndefined();
      },
    );

    it('uses a configured base URL so mainland China endpoints can be reached', async () => {
      const { fetch, requests } = captureFetch();
      const chatModel = createChatModel(
        provider({ baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }),
        model('qwen', 'qwen3-max'),
        {
          fetch,
        },
      );
      const request = await captureRequest(chatModel, requests);

      expect(request.url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    });

    it('sends the history as text, since JSON Output has no tool calls', async () => {
      const { fetch, requests } = captureFetch();
      const chatModel = createChatModel(provider(), model('qwen', 'qwen3-max'), { fetch });
      await generateStructured({
        chatModel,
        messages: [
          userMessage('task'),
          toolCallMessage({ toolCallId: '1', input: { action: [] } }),
          toolResultMessage({ toolCallId: '1', content: 'done' }),
          userMessage('next step'),
        ],
        schema,
        name: 'planner_output',
      }).catch(() => undefined);
      const request = requests[0];

      expect(request.body.tools).toBeUndefined();
      expect(request.body.tool_choice).toBeUndefined();
      const messages = request.body.messages as Record<string, unknown>[];
      expect(messages.some(m => m.tool_calls !== undefined || m.role === 'tool')).toBe(false);
    });
  });

  describe('azure', () => {
    const azureProvider = (overrides: Partial<ProviderConfig> = {}) =>
      provider({
        baseUrl: 'https://my-instance.openai.azure.com/',
        azureDeploymentNames: ['gpt-4o'],
        azureApiVersion: '2025-04-01-preview',
        ...overrides,
      });

    it('throws for missing fields', () => {
      expect(() => createChatModel(azureProvider({ azureApiVersion: '' }), model('azure_openai', 'gpt-4o'))).toThrow(
        'Azure configuration is incomplete',
      );
    });

    it('throws for an endpoint without an instance name', () => {
      expect(() =>
        createChatModel(azureProvider({ baseUrl: 'https://example.com/' }), model('azure_openai', 'gpt-4o')),
      ).toThrow('Could not extract Instance Name');
    });

    it('warns but proceeds for an unknown deployment', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const chatModel = createChatModel(azureProvider(), model('azure_openai_2', 'other-deployment'));
      expect(warn).toHaveBeenCalled();
      expect(chatModel.modelName).toBe('other-deployment');
      warn.mockRestore();
    });

    it('sends a non-strict json_schema to the deployment URL', async () => {
      const { fetch, requests } = captureFetch();
      const chatModel = createChatModel(azureProvider(), model('azure_openai', 'gpt-4o'), { fetch });
      const request = await captureRequest(chatModel, requests);

      expect(request.url).toBe(
        'https://my-instance.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2025-04-01-preview',
      );
      expect(request.headers.get('api-key')).toBe('test-key');
      expect(request.body.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: false } });
    });
  });

  describe('request bodies', () => {
    it.each(['gpt-4o', 'gpt-4.1'])('OpenAI %s sends a non-strict json_schema', async modelName => {
      const { fetch, requests } = captureFetch();
      const chatModel = createChatModel(provider(), model('openai', modelName), { fetch });
      const request = await captureRequest(chatModel, requests);

      expect(request.url).toBe('https://api.openai.com/v1/chat/completions');
      expect(request.body.response_format).toMatchObject({
        type: 'json_schema',
        json_schema: { name: 'planner_output', strict: false },
      });
      // Models that don't reason get no sampling and no effort, which OpenAI rejects for them
      expect(request.body.temperature).toBeUndefined();
      expect(request.body.top_p).toBeUndefined();
      expect(request.body.reasoning_effort).toBeUndefined();
    });

    it('OpenAI reasoning models send the default low reasoning_effort and no sampling', async () => {
      const { fetch, requests } = captureFetch();
      const chatModel = createChatModel(provider(), model('openai', 'gpt-5-mini'), { fetch });
      const request = await captureRequest(chatModel, requests);

      expect(request.body.reasoning_effort).toBe('low');
      expect(request.body.max_completion_tokens).toBe(4096);
      expect(request.body.temperature).toBeUndefined();
      expect(request.body.top_p).toBeUndefined();
    });

    it('custom OpenAI-compatible endpoints use their base URL', async () => {
      const { fetch, requests } = captureFetch();
      const chatModel = createChatModel(
        provider({ baseUrl: 'http://localhost:1234/v1' }),
        model('custom_openai', 'qwen'),
        { fetch },
      );
      const request = await captureRequest(chatModel, requests);
      expect(request.url).toBe('http://localhost:1234/v1/chat/completions');
      expect(request.body.reasoning_effort).toBeUndefined();
    });

    it('custom OpenAI-compatible endpoints send a chosen effort to any model', async () => {
      const { fetch, requests } = captureFetch();
      const chatModel = createChatModel(
        provider({ baseUrl: 'http://localhost:1234/v1' }),
        model('my_custom_id', 'qwen', { reasoningEffort: 'high' }),
        { fetch },
      );
      const request = await captureRequest(chatModel, requests);
      expect(request.body.reasoning_effort).toBe('high');
    });

    it('OpenRouter sends its headers and a non-strict json_schema', async () => {
      const { fetch, requests } = captureFetch();
      const chatModel = createChatModel(provider(), model('openrouter', 'openai/gpt-4o-2024-11-20'), { fetch });
      const request = await captureRequest(chatModel, requests);

      expect(request.url).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect(request.headers.get('HTTP-Referer')).toBe('https://nanobrowser.ai');
      expect(request.headers.get('X-Title')).toBe('Nanobrowser');
      expect(request.body.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: false } });
    });

    it.each<[string, ModelConfig['reasoningEffort']]>([
      ['openai/gpt-5-mini', 'low'],
      ['google/gemini-2.5-flash', 'high'],
    ])('OpenRouter %s sends reasoning effort %s and no sampling', async (name, effort) => {
      const { fetch, requests } = captureFetch();
      const chatModel = createChatModel(provider(), model('openrouter', name, { reasoningEffort: effort }), { fetch });
      const request = await captureRequest(chatModel, requests);

      expect(request.body.reasoning).toMatchObject({ effort });
      expect(request.body.temperature).toBeUndefined();
      expect(request.body.top_p).toBeUndefined();
    });

    it.each<ModelConfig['reasoningEffort']>([undefined, 'none'])(
      'OpenRouter with reasoning effort %s sends none, even for OpenAI reasoning models',
      async effort => {
        const { fetch, requests } = captureFetch();
        const params = { reasoningEffort: effort };
        const chatModel = createChatModel(provider(), model('openrouter', 'openai/gpt-5-mini', params), { fetch });
        const request = await captureRequest(chatModel, requests);

        expect(request.body.reasoning).toBeUndefined();
        expect(request.body.temperature).toBeUndefined();
        expect(request.body.top_p).toBeUndefined();
      },
    );

    describe('Anthropic', () => {
      const toolUse = { type: 'tool_use', id: 'toolu_1', name: 'planner_output', input: { answer: 'from tool' } };

      /** The request must use a plain (non-strict) tool and no strict structured output */
      function expectNonStrictTool(request: CapturedRequest) {
        expect(request.body.output_format).toBeUndefined();
        expect((request.body.output_config as { format?: unknown } | undefined)?.format).toBeUndefined();
        const tools = request.body.tools as Record<string, unknown>[];
        expect(tools).toHaveLength(1);
        expect(tools[0].name).toBe('planner_output');
        expect(tools[0].strict).toBeUndefined();
        expect(JSON.stringify(request.body.system)).toContain('calling the planner_output tool');
      }

      it('sends the direct browser access header and forces the tool on Haiku 4.5 without thinking', async () => {
        const { fetch, requests } = captureFetch();
        const chatModel = createChatModel(
          provider(),
          model('anthropic', 'claude-haiku-4-5', { reasoningEffort: 'none' }),
          {
            fetch,
          },
        );
        const request = await captureRequest(chatModel, requests);

        expect(request.headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
        expect(request.headers.get('x-api-key')).toBe('test-key');
        expect(request.body.thinking).toBeUndefined();
        expect(request.body.temperature).toBeUndefined();
        expect(request.body.top_p).toBeUndefined();
        expectNonStrictTool(request);
        expect(request.body.tool_choice).toMatchObject({ type: 'tool', name: 'planner_output' });
      });

      it('thinks on Haiku 4.5 with the default effort and offers the tool with automatic choice', async () => {
        const { fetch, requests } = captureFetch();
        const chatModel = createChatModel(provider(), model('anthropic', 'claude-haiku-4-5'), { fetch });
        const request = await captureRequest(chatModel, requests);

        expect(request.body.thinking).toMatchObject({ type: 'enabled' });
        expect(request.body.temperature).toBeUndefined();
        expectNonStrictTool(request);
        expect(request.body.tool_choice).toMatchObject({ type: 'auto' });
      });

      it('uses adaptive thinking with an effort and automatic tool choice on Opus 5.5', async () => {
        const { fetch, requests } = captureFetch();
        const chatModel = createChatModel(
          provider(),
          model('anthropic', 'claude-opus-5-5', { reasoningEffort: 'high' }),
          {
            fetch,
          },
        );
        const request = await captureRequest(chatModel, requests);

        expect(request.body.thinking).toMatchObject({ type: 'adaptive' });
        expect(request.body.output_config).toMatchObject({ effort: 'high' });
        expect(request.body.temperature).toBeUndefined();
        expect(request.body.top_p).toBeUndefined();
        expectNonStrictTool(request);
        expect(request.body.tool_choice).toMatchObject({ type: 'auto' });
      });

      it.each(['claude-haiku-4-5', 'claude-opus-5-5'])('%s parses the tool call', async name => {
        const { fetch } = anthropicFetch([toolUse]);
        const chatModel = createChatModel(provider(), model('anthropic', name), { fetch });
        const { output } = await generateStructured({
          chatModel,
          messages: [userMessage('hi')],
          schema,
          name: 'planner_output',
        });
        expect(output).toEqual({ answer: 'from tool' });
      });

      it.each<[string, ModelConfig['reasoningEffort']]>([
        ['claude-opus-5-5', 'none'],
        ['claude-opus-5-5', 'low'],
        ['claude-haiku-4-5', 'none'],
        ['claude-haiku-4-5', 'low'],
      ])('rejects JSON text cut off at max_tokens on %s with effort %s', async (name, effort) => {
        const { fetch } = anthropicFetch([{ type: 'text', text: '{"answer": "from text"}' }], 'max_tokens');
        const chatModel = createChatModel(provider(), model('anthropic', name, { reasoningEffort: effort }), { fetch });
        await expect(
          generateStructured({ chatModel, messages: [userMessage('hi')], schema, name: 'planner_output' }),
        ).rejects.toThrow('finish reason');
      });

      it.each<[string, ModelConfig['reasoningEffort']]>([
        ['claude-opus-5-5', 'none'],
        ['claude-opus-5-5', 'low'],
        ['claude-haiku-4-5', 'low'],
      ])('falls back to JSON text when %s with effort %s answers without the tool', async (name, effort) => {
        const { fetch } = anthropicFetch([{ type: 'text', text: '```json\n{"answer": "from text"}\n```' }]);
        const chatModel = createChatModel(provider(), model('anthropic', name, { reasoningEffort: effort }), { fetch });
        const { output } = await generateStructured({
          chatModel,
          messages: [userMessage('hi')],
          schema,
          name: 'planner_output',
        });
        expect(output).toEqual({ answer: 'from text' });
      });
    });

    it('xAI tool mode forces a non-strict tool call on the Responses API', async () => {
      const { fetch, requests } = captureFetch();
      const chatModel = createChatModel(provider(), model('grok', 'grok-4'), { fetch });
      const request = await captureRequest(chatModel, requests);

      expect(request.url).toBe('https://api.x.ai/v1/responses');
      expect((request.body.text as { format?: unknown } | undefined)?.format).toBeUndefined();
      const tools = request.body.tools as Record<string, unknown>[];
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('planner_output');
      expect(tools[0].strict).toBeUndefined();
      expect(request.body.tool_choice).toMatchObject({ type: 'function', name: 'planner_output' });
      // Responses API storage is opt-out; history is kept locally
      expect(request.body.store).toBe(false);
    });

    it.each<[ModelConfig['reasoningEffort'], string | undefined]>([
      [undefined, 'low'],
      ['medium', 'medium'],
      ['xhigh', 'xhigh'],
      ['none', undefined],
    ])('Grok with reasoning effort %s sends %s and no sampling', async (effort, expected) => {
      const { fetch, requests } = captureFetch();
      const chatModel = createChatModel(provider(), model('grok', 'grok-4.7', { reasoningEffort: effort }), { fetch });
      const request = await captureRequest(chatModel, requests);

      expect(request.body.reasoning).toEqual(expected ? { effort: expected } : undefined);
      expect(request.body.temperature).toBeUndefined();
      expect(request.body.top_p).toBeUndefined();
    });

    it.each(['grok-4.20-0309-reasoning', 'grok-4.20-non-reasoning'])(
      'Grok %s gets no reasoning effort, which it rejects',
      async name => {
        const { fetch, requests } = captureFetch();
        const chatModel = createChatModel(provider(), model('grok', name, { reasoningEffort: 'high' }), { fetch });
        const request = await captureRequest(chatModel, requests);

        expect(request.body.reasoning).toBeUndefined();
      },
    );

    it.each<[string, ModelConfig['reasoningEffort'], string | undefined]>([
      ['deepseek-flash', undefined, 'low'],
      ['deepseek-flash', 'medium', 'high'],
      ['deepseek-v4-pro', 'xhigh', 'max'],
      ['deepseek-v4-pro', 'none', undefined],
    ])(
      'DeepSeek %s with reasoning effort %s sends %s and JSON Output in text mode with history as text',
      async (name, effort, expected) => {
        const { fetch, requests } = captureFetch();
        const chatModel = createChatModel(provider(), model('deepseek', name, { reasoningEffort: effort }), { fetch });
        expect(chatModel.structuredMode).toBe('text');
        await generateStructured({
          chatModel,
          messages: [
            userMessage('task'),
            toolCallMessage({ toolCallId: '1', input: { action: [] } }),
            toolResultMessage({ toolCallId: '1', content: 'done' }),
            userMessage('next step'),
          ],
          schema,
          name: 'planner_output',
        }).catch(() => undefined);
        const request = requests[0];

        // Without an effort nothing is sent, and V4 models think by default
        expect(request.body.thinking).toEqual(expected ? { type: 'enabled' } : undefined);
        expect(request.body.reasoning_effort).toBe(expected);
        expect(request.body.tools).toBeUndefined();
        expect(request.body.tool_choice).toBeUndefined();
        expect(request.body.response_format).toEqual({ type: 'json_object' });
        expect(request.body.temperature).toBeUndefined();
        expect(request.body.top_p).toBeUndefined();
        const messages = request.body.messages as Record<string, unknown>[];
        expect(messages.some(m => m.tool_calls !== undefined || m.role === 'tool')).toBe(false);
        // JSON Output needs the word "json" in the prompt; the AI SDK adds it without the schema
        expect(messages).toContainEqual({ role: 'system', content: 'Return JSON.' });
      },
    );
  });
});

describe('history sent to providers', () => {
  const history = [
    userMessage('task'),
    toolCallMessage({ toolCallId: '1', input: { action: [] }, text: 'tool call' }),
    toolResultMessage({ toolCallId: '1', content: 'done' }),
    userMessage('next step'),
  ];

  it('replays no function calls to Gemini 3, so no thought signature is needed', async () => {
    const requests: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      const response = {
        candidates: [{ content: { role: 'model', parts: [{ text: '{"answer":"ok"}' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      };
      return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof globalThis.fetch;
    const warnings: string[] = [];
    const sdkGlobal = globalThis as { AI_SDK_LOG_WARNINGS?: unknown };
    const previousLogger = sdkGlobal.AI_SDK_LOG_WARNINGS;
    sdkGlobal.AI_SDK_LOG_WARNINGS = (options: { warnings: { message?: string }[] }) =>
      warnings.push(...options.warnings.map(warning => warning.message ?? ''));
    try {
      const chatModel = createChatModel(provider(), model('gemini', 'gemini-3.8-flash'), { fetch });
      await generateStructured({ chatModel, messages: history, schema, name: 'navigator_output' });
    } finally {
      sdkGlobal.AI_SDK_LOG_WARNINGS = previousLogger;
    }

    const contents = requests[0].contents as { parts: Record<string, unknown>[] }[];
    const parts = contents.flatMap(content => content.parts);
    expect(parts.some(part => part.functionCall || part.functionResponse)).toBe(false);
    expect(warnings.join(' ')).not.toContain('thoughtSignature');
  });

  it('replays no tool use to Claude with thinking, so no thinking blocks are needed', async () => {
    const toolUse = { type: 'tool_use', id: 'toolu_1', name: 'AgentOutput', input: { answer: 'ok' } };
    const { fetch, requests } = anthropicFetch([toolUse]);
    const chatModel = createChatModel(provider(), model('anthropic', 'claude-haiku-4-5'), { fetch });
    await generateStructured({
      chatModel,
      messages: history,
      schema,
      name: 'navigator_output',
      toolName: 'AgentOutput',
    });

    expect(requests[0].body.thinking).toMatchObject({ type: 'enabled' });
    const messages = requests[0].body.messages as { role: string; content: string | { type: string }[] }[];
    const blockTypes = messages.flatMap(m => (typeof m.content === 'string' ? [] : m.content.map(part => part.type)));
    expect(blockTypes).not.toContain('tool_use');
    expect(blockTypes).not.toContain('tool_result');
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
  });
});
