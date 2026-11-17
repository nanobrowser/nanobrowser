import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { CUT_SHORT, listModels, testConnection } from '../connection';
import { NOT_CHAT } from '../catalogue';

const recorded = JSON.parse(readFileSync(`${__dirname}/payloads/model-lists-2026-10-11.json`, 'utf8'));
const bedrock = JSON.parse(readFileSync(`${__dirname}/payloads/bedrock-ap-southeast-1-2026-11-10.json`, 'utf8'));

function sse(chunks: unknown[]): Response {
  const body = chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const chunk = (delta: unknown, finish: string | null = null, usage?: unknown) => ({
  id: '1',
  object: 'chat.completion.chunk',
  created: 0,
  model: 'm',
  choices: [{ index: 0, delta, finish_reason: finish }],
  ...(usage ? { usage } : {}),
});

const toolCallReply = () =>
  sse([
    chunk({
      role: 'assistant',
      tool_calls: [
        { index: 0, id: 'c1', type: 'function', function: { name: 'report_status', arguments: '{"status":"ok"}' } },
      ],
    }),
    chunk({}, 'tool_calls', { prompt_tokens: 10, completion_tokens: 3 }),
  ]);

describe('testConnection', () => {
  it('passes when the model calls the test tool', async () => {
    const fetch = vi.fn(async () => toolCallReply()) as unknown as typeof globalThis.fetch;
    const r = await testConnection({ kind: 'ollama', modelName: 'qwen3:8b' }, { fetch });
    expect(r).toMatchObject({ ok: true, toolCalling: true });
  });

  it('marks a model that answers with text as having no tool calling', async () => {
    const fetch = vi.fn(async () =>
      sse([chunk({ role: 'assistant', content: 'ok' }), chunk({}, 'stop')]),
    ) as unknown as typeof globalThis.fetch;
    const r = await testConnection({ kind: 'ollama', modelName: 'tiny' }, { fetch });
    expect(r).toMatchObject({ ok: true, toolCalling: false });
  });

  it('treats a reply cut short before any tool call as inconclusive, not as "no tool calling"', async () => {
    const fetch = vi.fn(async () =>
      sse([chunk({ role: 'assistant', content: '' }), chunk({}, 'length')]),
    ) as unknown as typeof globalThis.fetch;
    const r = await testConnection({ kind: 'openai-compatible', modelName: 'm', baseUrl: 'http://x/v1' }, { fetch });
    expect(r).toMatchObject({ ok: false, toolCalling: false, error: CUT_SHORT });
  });

  it('reports a refused origin from a local server', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 403 })) as unknown as typeof globalThis.fetch;
    const r = await testConnection({ kind: 'ollama', modelName: 'qwen3:8b' }, { fetch });
    expect(r).toMatchObject({ ok: false, originRefused: true });
  });
});

/** CRC-32 (IEEE), as AWS's event stream frames carry it. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** One frame of AWS's event stream: an event of a type, with a JSON payload. */
function frame(eventType: string, payload: unknown): Uint8Array {
  const text = new TextEncoder();
  const headers: number[] = [];
  for (const [name, value] of [
    [':event-type', eventType],
    [':content-type', 'application/json'],
    [':message-type', 'event'],
  ]) {
    const n = text.encode(name);
    const v = text.encode(value);
    headers.push(n.length, ...n, 7, v.length >> 8, v.length & 0xff, ...v);
  }
  const body = text.encode(JSON.stringify(payload));
  const total = 12 + headers.length + body.length + 4;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, total);
  view.setUint32(4, headers.length);
  view.setUint32(8, crc32(out.subarray(0, 8)));
  out.set(headers, 12);
  out.set(body, 12 + headers.length);
  view.setUint32(total - 4, crc32(out.subarray(0, total - 4)));
  return out;
}

/** A streamed Converse reply: a call to the test tool, or a short text. */
function converse(reply: 'tool' | 'text'): Response {
  const block =
    reply === 'tool'
      ? [
          frame('contentBlockStart', {
            contentBlockIndex: 0,
            start: { toolUse: { toolUseId: 'c1', name: 'report_status' } },
          }),
          frame('contentBlockDelta', { contentBlockIndex: 0, delta: { toolUse: { input: '{"status":"ok"}' } } }),
        ]
      : [frame('contentBlockDelta', { contentBlockIndex: 0, delta: { text: 'ok' } })];
  const frames = [
    frame('messageStart', { role: 'assistant' }),
    ...block,
    frame('contentBlockStop', { contentBlockIndex: 0 }),
    frame('messageStop', { stopReason: reply === 'tool' ? 'tool_use' : 'end_turn' }),
    frame('metadata', { usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 }, metrics: { latencyMs: 1 } }),
  ];
  const bytes = new Uint8Array(frames.reduce((n, f) => n + f.length, 0));
  let at = 0;
  for (const f of frames) {
    bytes.set(f, at);
    at += f.length;
  }
  return new Response(bytes, { status: 200, headers: { 'content-type': 'application/vnd.amazon.eventstream' } });
}

describe('the effort probe on Bedrock', () => {
  function bedrockProbe() {
    const bodies: Array<Record<string, unknown>> = [];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return converse(bodies.length === 1 ? 'tool' : 'text');
    }) as unknown as typeof globalThis.fetch;
    return { fetch, bodies };
  }
  const bedrockSpec = (modelName: string) => ({
    kind: 'bedrock' as const,
    modelName,
    apiKey: 'k',
    baseUrl: 'us-east-1',
  });

  it('records "reasons: no" after one request when the SDK drops the option for the model', async () => {
    const { fetch, bodies } = bedrockProbe();
    const r = await testConnection(bedrockSpec('global.moonshotai.kimi-k3'), { fetch }, { none: true, reasons: true });
    expect(r).toMatchObject({ ok: true, toolCalling: true, tested: { reasons: false } });
    // The tool probe and one effort probe; no None probe for a model that does not take the option.
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[1])).not.toContain('reasoningConfig');
  });

  it('leaves "reasons" unknown when the option reaches the model, since Bedrock reports no reasoning tokens', async () => {
    // Nova 2 Lite takes Bedrock's reasoning config; Claude takes Anthropic's thinking, a different branch of the SDK.
    for (const [id, sent] of [
      ['global.amazon.nova-2-lite-v1:0', 'reasoningConfig'],
      ['global.anthropic.claude-sonnet-4-6', 'thinking'],
    ]) {
      const { fetch, bodies } = bedrockProbe();
      const r = await testConnection(bedrockSpec(id), { fetch });
      expect(r).toMatchObject({ ok: true, toolCalling: true });
      expect(r.tested).toBeUndefined();
      expect(bodies).toHaveLength(2);
      expect(JSON.stringify(bodies[1])).toContain(sent);
    }
  });
});

describe('the probes', () => {
  const refuse = (what: string) => new Response(JSON.stringify({ error: { message: what } }), { status: 400 });
  const plain = () => sse([chunk({ role: 'assistant', content: 'ok' }), chunk({}, 'stop')]);
  const spec = { kind: 'openai-compatible' as const, modelName: 'm', baseUrl: 'http://x/v1' };

  /** Answers the tool probe with a tool call and every later probe with `answer`. */
  function probe(answer: (body: Record<string, unknown>) => Response) {
    const bodies: Array<Record<string, unknown>> = [];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      bodies.push(body);
      return bodies.length === 1 ? toolCallReply() : answer(body);
    }) as unknown as typeof globalThis.fetch;
    return { fetch, bodies, efforts: () => bodies.slice(1).map(b => b.reasoning_effort) };
  }

  it('records "reasons: no" only when Low, Medium and High are all refused', async () => {
    const { fetch, efforts } = probe(() => refuse('unknown field reasoning_effort'));
    const r = await testConnection(spec, { fetch });
    expect(r).toMatchObject({ ok: true, toolCalling: true, tested: { reasons: false } });
    expect(efforts()).toEqual(['low', 'medium', 'high']);
  });

  it('stops at the first level accepted, and a refused Low says nothing lasting', async () => {
    const { fetch, efforts } = probe(b => (b.reasoning_effort === 'low' ? refuse('reasoning_effort low') : plain()));
    const r = await testConnection(spec, { fetch });
    expect(efforts()).toEqual(['low', 'medium']);
    expect(r.tested).toBeUndefined();
  });

  it('records "reasons" for reasoning tokens in the usage, and nothing about None', async () => {
    const { fetch } = probe(() =>
      sse([
        chunk({ role: 'assistant', content: 'ok' }),
        chunk({}, 'stop', {
          prompt_tokens: 5,
          completion_tokens: 9,
          completion_tokens_details: { reasoning_tokens: 7 },
        }),
      ]),
    );
    const r = await testConnection({ kind: 'openrouter', modelName: 'm', apiKey: 'k' }, { fetch });
    expect(r.tested).toEqual({ reasons: true });
  });

  it('learns nothing otherwise', async () => {
    const { fetch } = probe(() => toolCallReply());
    const r = await testConnection({ kind: 'ollama', modelName: 'qwen3:8b' }, { fetch });
    expect(r.tested).toBeUndefined();
  });

  it('sends None itself when asked, for a model that reasons', async () => {
    const refusing = probe(b => (b.reasoning_effort === 'none' ? refuse('reasoning_effort none') : plain()));
    const r = await testConnection(spec, { fetch: refusing.fetch }, { none: true, reasons: true });
    expect(refusing.efforts()).toEqual(['low', 'none']);
    expect(r.tested).toEqual({ acceptsNone: false });
    const taking = probe(() => plain());
    expect((await testConnection(spec, { fetch: taking.fetch }, { none: true, reasons: true })).tested).toEqual({
      acceptsNone: true,
    });
    // Through the row's map: GPT-5 is asked with `minimal`.
    const mapped = probe(() => plain());
    await testConnection(spec, { fetch: mapped.fetch }, { none: true, reasons: true, noneWire: 'minimal' });
    expect(mapped.efforts()).toEqual(['low', 'minimal']);
    // Not for a model that does not reason.
    const not = probe(() => refuse('unknown field reasoning_effort'));
    await testConnection(spec, { fetch: not.fetch }, { none: true });
    expect(not.efforts()).toEqual(['low', 'medium', 'high']);
  });

  it('sends a small image when vision is a guess', async () => {
    const hasImage = (b: Record<string, unknown>) => JSON.stringify(b.messages).includes('image_url');
    const refusing = probe(b => (hasImage(b) ? refuse('This model does not support image input') : plain()));
    expect((await testConnection(spec, { fetch: refusing.fetch }, { image: true })).tested).toEqual({ vision: false });
    expect(refusing.bodies.some(hasImage)).toBe(true);
    const taking = probe(() => plain());
    expect((await testConnection(spec, { fetch: taking.fetch }, { image: true })).tested).toEqual({ vision: true });
  });

  it('runs no effort probe on a first-party kind', async () => {
    // Anthropic's stream with a call to the test tool, so the probes after it would run if they were asked.
    const events = [
      [
        'message_start',
        {
          type: 'message_start',
          message: {
            id: 'm',
            type: 'message',
            role: 'assistant',
            model: 'x',
            content: [],
            stop_reason: null,
            usage: { input_tokens: 10, output_tokens: 1 },
          },
        },
      ],
      [
        'content_block_start',
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 't1', name: 'report_status', input: {} },
        },
      ],
      [
        'content_block_delta',
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"status":"ok"}' } },
      ],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } }],
      ['message_stop', { type: 'message_stop' }],
    ];
    const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
    const fetch = vi.fn(
      async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    ) as unknown as typeof globalThis.fetch;
    const r = await testConnection({ kind: 'anthropic', modelName: 'claude-sonnet-5-5', apiKey: 'k' }, { fetch });
    expect(r).toMatchObject({ ok: true, toolCalling: true });
    expect(r.tested).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('listModels', () => {
  it('lists Bedrock text models with a bearer key', async () => {
    const urls: string[] = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      urls.push(url);
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer bedrock-key');
      if (url.includes('/inference-profiles')) return Response.json({ inferenceProfileSummaries: [] });
      return Response.json({
        modelSummaries: [
          { modelId: 'amazon.nova-lite-v1:0', inputModalities: ['TEXT'], outputModalities: ['TEXT'] },
          { modelId: 'amazon.titan-embed-text-v2:0', inputModalities: ['TEXT'], outputModalities: ['EMBEDDING'] },
        ],
      });
    }) as unknown as typeof globalThis.fetch;
    expect(await listModels({ kind: 'bedrock', apiKey: 'bedrock-key', baseUrl: 'eu-west-1' }, fetch)).toEqual({
      models: ['amazon.nova-lite-v1:0'],
      hidden: [],
    });
    expect(urls).toEqual([
      'https://bedrock.eu-west-1.amazonaws.com/foundation-models',
      'https://bedrock.eu-west-1.amazonaws.com/inference-profiles?typeEquals=SYSTEM_DEFINED&maxResults=1000',
    ]);
  });

  it('hides Bedrock models that do not run on demand by their own id, and legacy ones', async () => {
    const text = { inputModalities: ['TEXT'], outputModalities: ['TEXT'] };
    const fetch = vi.fn(async () =>
      Response.json({
        modelSummaries: [
          {
            modelId: 'amazon.nova-pro-v1:0',
            ...text,
            inferenceTypesSupported: ['ON_DEMAND'],
            modelLifecycle: { status: 'ACTIVE' },
          },
          {
            modelId: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
            ...text,
            inferenceTypesSupported: ['INFERENCE_PROFILE'],
          },
          { modelId: 'anthropic.claude-3-sonnet-20240229-v1:0:28k', ...text, inferenceTypesSupported: ['PROVISIONED'] },
          {
            modelId: 'anthropic.claude-v2:1',
            ...text,
            inferenceTypesSupported: ['ON_DEMAND'],
            modelLifecycle: { status: 'LEGACY' },
          },
        ],
      }),
    ) as unknown as typeof globalThis.fetch;
    expect(await listModels({ kind: 'bedrock', apiKey: 'bedrock-key', baseUrl: 'eu-west-1' }, fetch)).toEqual({
      models: ['amazon.nova-pro-v1:0'],
      hidden: [
        'anthropic.claude-sonnet-4-5-20250929-v1:0',
        'anthropic.claude-3-sonnet-20240229-v1:0:28k',
        'anthropic.claude-v2:1',
      ],
    });
  });

  it('refuses a Bedrock region that is not one without a request', async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    await expect(
      listModels({ kind: 'bedrock', apiKey: 'bedrock-key', baseUrl: 'evil.example#' }, fetch),
    ).rejects.toThrow('The Bedrock region must be an AWS region');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lists the inference profiles that run Bedrock models, from a recorded region', async () => {
    const urls: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      urls.push(url);
      return Response.json(url.includes('/inference-profiles') ? bedrock.inferenceProfiles : bedrock.foundationModels);
    }) as unknown as typeof globalThis.fetch;
    const list = await listModels({ kind: 'bedrock', apiKey: 'bedrock-key', baseUrl: 'ap-southeast-1' }, fetch);
    // Counted from the recording separately: 33 profiles of active models, and the one model Bedrock runs on demand
    // by its own id.
    expect(list.models).toHaveLength(34);
    expect(list.hidden).toHaveLength(44);
    expect(list.models).toEqual(
      expect.arrayContaining([
        'apac.amazon.nova-micro-v1:0',
        'global.amazon.nova-2-lite-v1:0',
        'global.anthropic.claude-sonnet-4-6',
        'global.openai.gpt-5.4',
        'global.moonshotai.kimi-k3',
        'anthropic.claude-sonnet-5',
        'global.anthropic.claude-sonnet-5',
      ]),
    );
    // Models that run only through a profile, by their own id, and a profile of a legacy model.
    expect(list.hidden).toEqual(
      expect.arrayContaining([
        'amazon.nova-micro-v1:0',
        'openai.gpt-5.4',
        'apac.anthropic.claude-3-haiku-20240307-v1:0',
      ]),
    );
    // Embedding models are in neither list, nor are their profiles.
    const all = [...list.models, ...list.hidden];
    for (const id of ['cohere.embed-v4:0', 'global.cohere.embed-v4:0']) {
      expect(all).not.toContain(id);
    }
    // A profile comes right before the model it runs.
    expect(list.models.indexOf('global.anthropic.claude-sonnet-5') + 1).toBe(
      list.models.indexOf('anthropic.claude-sonnet-5'),
    );
    expect(urls).toHaveLength(2);
  });

  it('lists the Bedrock models alone when the key may not list the profiles', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes('/inference-profiles')
        ? Response.json({ Message: 'not authorized to perform: bedrock:ListInferenceProfiles' }, { status: 403 })
        : Response.json(bedrock.foundationModels),
    ) as unknown as typeof globalThis.fetch;
    const list = await listModels({ kind: 'bedrock', apiKey: 'bedrock-key', baseUrl: 'ap-southeast-1' }, fetch);
    expect(list.models).toEqual(['anthropic.claude-sonnet-5']);
    expect(list.hidden).toContain('openai.gpt-5.4');
  });

  it('follows the pages of Bedrock inference profiles', async () => {
    const text = {
      inputModalities: ['TEXT'],
      outputModalities: ['TEXT'],
      inferenceTypesSupported: ['INFERENCE_PROFILE'],
    };
    const profile = (id: string, model: string) => ({
      inferenceProfileId: id,
      status: 'ACTIVE',
      models: [{ modelArn: `arn:aws:bedrock:eu-west-1::foundation-model/${model}` }],
    });
    const urls: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      urls.push(url);
      if (!url.includes('/inference-profiles'))
        return Response.json({
          modelSummaries: [
            { modelId: 'a.one', ...text },
            { modelId: 'a.two', ...text },
          ],
        });
      return Response.json(
        url.includes('nextToken=')
          ? { inferenceProfileSummaries: [profile('eu.a.two', 'a.two')] }
          : { inferenceProfileSummaries: [profile('eu.a.one', 'a.one')], nextToken: 'page 2' },
      );
    }) as unknown as typeof globalThis.fetch;
    const list = await listModels({ kind: 'bedrock', apiKey: 'bedrock-key', baseUrl: 'eu-west-1' }, fetch);
    expect(list).toEqual({ models: ['eu.a.one', 'eu.a.two'], hidden: ['a.one', 'a.two'] });
    expect(urls[2]).toBe(
      'https://bedrock.eu-west-1.amazonaws.com/inference-profiles?typeEquals=SYSTEM_DEFINED&maxResults=1000&nextToken=page%202',
    );
  });

  it('signs both Bedrock list requests with SigV4 for an access key', async () => {
    const auth: string[] = [];
    const tokens: Array<string | null> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      auth.push(request.headers.get('authorization') ?? '');
      tokens.push(request.headers.get('x-amz-security-token'));
      return Response.json(
        request.url.includes('/inference-profiles') ? { inferenceProfileSummaries: [] } : { modelSummaries: [] },
      );
    }) as unknown as typeof globalThis.fetch;
    await listModels({ kind: 'bedrock', apiKey: 'ASIAEXAMPLE:secret:session', baseUrl: 'ap-southeast-1' }, fetch);
    expect(auth).toHaveLength(2);
    for (const header of auth) {
      expect(header).toMatch(/^AWS4-HMAC-SHA256 Credential=ASIAEXAMPLE\/\d{8}\/ap-southeast-1\/bedrock\/aws4_request/);
    }
    expect(tokens).toEqual(['session', 'session']);
  });

  it("reports a Bedrock 403 with AWS's message, as the key or permission, not the origin", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ Message: 'not authorized to perform: bedrock:ListFoundationModels' }, { status: 403 }),
    ) as unknown as typeof globalThis.fetch;
    await expect(
      listModels({ kind: 'bedrock', apiKey: 'bedrock-key', baseUrl: 'eu-west-1' }, fetch),
    ).rejects.toMatchObject({
      message: '403 not authorized to perform: bedrock:ListFoundationModels',
      status: 403,
      originRefused: false,
    });
  });

  it('hides each part of the key in the error AWS sends for the model list', async () => {
    const token = 'IQoJb3JpZ2luX2VjEXAMPLE/session+token==';
    for (const apiKey of [`ASIAEXAMPLE1234:wJalrXUtnFEMIEXAMPLE:${token}`, 'ABSKbearerkey123']) {
      const quoted = apiKey.split(':').pop()!;
      const fetch = vi.fn(async () =>
        Response.json({ message: `Signature mismatch. x-amz-security-token:${quoted}` }, { status: 403 }),
      ) as unknown as typeof globalThis.fetch;
      const error = (await listModels({ kind: 'bedrock', apiKey, baseUrl: 'eu-west-1' }, fetch).catch(e => e)) as Error;
      expect(error.message).toBe('403 Signature mismatch. x-amz-security-token:[redacted]');
    }
  });

  it('reads the error text AWS sends as message too', async () => {
    const fetch = vi.fn(async () =>
      Response.json({ message: 'The security token included in the request is invalid.' }, { status: 403 }),
    ) as unknown as typeof globalThis.fetch;
    await expect(listModels({ kind: 'bedrock', apiKey: 'bedrock-key', baseUrl: 'eu-west-1' }, fetch)).rejects.toThrow(
      '403 The security token included in the request is invalid.',
    );
  });

  it('reads Ollama tags from the server address, with or without /v1', async () => {
    const fetch = vi.fn(async (url: string) => {
      expect(url).toBe('http://localhost:11434/api/tags');
      return Response.json({ models: [{ name: 'qwen3:8b' }, { name: 'gemma3:12b' }] });
    }) as unknown as typeof globalThis.fetch;
    expect(await listModels({ kind: 'ollama', baseUrl: 'http://localhost:11434/v1' }, fetch)).toEqual({
      models: ['qwen3:8b', 'gemma3:12b'],
      hidden: [],
    });
  });

  it('reads an OpenAI-compatible list with the key, sorted', async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('http://localhost:1234/v1/models');
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
      return Response.json({ data: [{ id: 'b' }, { id: 'text-embedding-nomic-embed-text-v1.5' }, { id: 'a' }] });
    }) as unknown as typeof globalThis.fetch;
    expect(await listModels({ kind: 'lmstudio', apiKey: 'k' }, fetch)).toEqual({
      models: ['a', 'b'],
      hidden: ['text-embedding-nomic-embed-text-v1.5'],
    });
  });

  it('throws with originRefused on 403', async () => {
    const fetch = vi.fn(
      async () => new Response('', { status: 403, statusText: 'Forbidden' }),
    ) as unknown as typeof globalThis.fetch;
    await expect(listModels({ kind: 'ollama' }, fetch)).rejects.toMatchObject({ originRefused: true });
  });

  it("throws with the status and the provider's own reason", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), { status: 401 }),
    ) as unknown as typeof globalThis.fetch;
    await expect(listModels({ kind: 'openai', apiKey: 'wrong' }, fetch)).rejects.toMatchObject({
      status: 401,
      message: '401 Incorrect API key provided',
      originRefused: false,
    });
  });
});

// The lists as the vendors returned them on 2026-10-11, trimmed to the fields the filter reads.
describe('listModels over the recorded lists', () => {
  const list = (kind: 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'ollama', body: unknown = recorded[kind]) =>
    listModels({ kind, apiKey: 'k' }, (async () => Response.json(body)) as unknown as typeof globalThis.fetch);

  it('OpenAI: hides what has a shutdown date and the specialist models', async () => {
    const { models, hidden } = await list('openai');
    expect([models.length, hidden.length]).toEqual([43, 94]);
    expect(models).toEqual(
      expect.arrayContaining(['gpt-6.1-sol', 'gpt-5.5', 'gpt-5.4-pro', 'gpt-4.1', 'o3', 'chat-latest']),
    );
    // Retired or deprecated by date.
    expect(hidden).toEqual(
      expect.arrayContaining(['gpt-5-chat-latest', 'gpt-5.3-chat-latest', 'o4-mini', 'gpt-4-turbo', 'babbage-002']),
    );
    // By name.
    expect(hidden).toEqual(
      expect.arrayContaining([
        'gpt-image-2',
        'chatgpt-image-latest',
        'gpt-realtime-2.1',
        'gpt-live-1',
        'gpt-audio-1.5',
        'gpt-4o-mini-tts',
        'gpt-transcribe',
        'whisper-1',
        'text-embedding-3-large',
        'omni-moderation-latest',
        'sora-2-pro',
        'gpt-5-search-api',
      ]),
    );
  });

  it('lists the newest first where the list gives a date, and keeps the order where it does not', async () => {
    expect((await list('openai')).models.slice(0, 4)).toEqual([
      'gpt-6.1-sol',
      'gpt-6-luna',
      'gpt-6-sol',
      'gpt-6-astra',
    ]);
    expect((await list('anthropic')).models[0]).toBe('claude-haiku-5-5');
    const or = await list('openrouter');
    const created = new Map(recorded.openrouter.data.map((m: { id: string; created: number }) => [m.id, m.created]));
    const dates = or.models.map(id => created.get(id) as number);
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    // Gemini gives no date: its own models by version, newest first, an alias above them, then Gemma.
    const gemini = (await list('gemini')).models;
    expect(gemini.slice(3, 6)).toEqual(['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.7-flash']);
    expect(gemini.indexOf('gemini-3.1-pro-preview')).toBeLessThan(gemini.indexOf('gemini-2.5-pro'));
    expect(gemini.indexOf('gemini-2.5-flash')).toBeLessThan(gemini.indexOf('gemma-4-31b-it'));
  });

  it('Anthropic: hides a model whose lifecycle is not active', async () => {
    expect(await list('anthropic')).toMatchObject({ hidden: [] });
    const body = {
      data: [
        { id: 'claude-old', lifecycle: 'deprecated' },
        { id: 'claude-new', lifecycle: 'active' },
      ],
    };
    expect(await list('anthropic', body)).toEqual({ models: ['claude-new'], hidden: ['claude-old'] });
  });

  it('Gemini: hides what cannot generate content and the image, speech, music and video models', async () => {
    const { models, hidden } = await list('gemini');
    expect([models.length, hidden.length]).toEqual([23, 39]);
    expect(models).toEqual(
      expect.arrayContaining(['gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-flash-latest']),
    );
    expect(hidden).toEqual(
      expect.arrayContaining([
        'gemini-3-pro-image',
        'gemini-nano-banana-2.1',
        'gemini-3.8-flash-tts',
        'gemini-3.5-transcribe',
        'lyria-3.5',
        'veo-3.1-generate-preview',
        'gemini-embedding-2',
        'gemini-3.8-live',
        'gemini-2.5-flash-native-audio-latest',
        'gemini-robotics-er-2-preview',
      ]),
    );
  });

  it('OpenRouter: hides what expires or takes no tools, and keeps a model that also outputs images', async () => {
    const { models, hidden } = await list('openrouter');
    expect([models.length, hidden.length]).toEqual([367, 91]);
    expect(models).toEqual(expect.arrayContaining(['openrouter/auto', 'openai/gpt-6.1-sol', 'moonshotai/kimi-k3']));
    expect(hidden).toEqual(
      expect.arrayContaining([
        'google/gemini-2.5-flash',
        'perplexity/sonar',
        'openai/gpt-5.4-image-2',
        'google/lyria-3-pro-preview',
      ]),
    );
  });

  it('Ollama: hides an embedding model by its name', async () => {
    expect(await list('ollama')).toEqual({ models: ['qwen3.8:27b-mlx'], hidden: ['nomic-embed-text:latest'] });
  });
});

describe('NOT_CHAT', () => {
  it('matches a word only as its own part of the name', () => {
    for (const name of [
      'gpt-image-2',
      'nomic-embed-text:latest',
      'qwen3-embedding:8b',
      'google/gemini-3-pro-image',
      'tts-1',
      'gemini-robotics-er-2-preview',
    ])
      expect(NOT_CHAT.test(name), name).toBe(true);
    for (const name of [
      'gpt-5.5',
      'claude-sonnet-5-5',
      'qwen3.8:27b-mlx',
      'olive-7b',
      'x-ai/grok-imagine-chat',
      'meta-llama/llama-3.2-3b-instruct',
      'deepseek/deepseek-v4.1-flash',
      'openrouter/auto',
    ])
      expect(NOT_CHAT.test(name), name).toBe(false);
  });
});
