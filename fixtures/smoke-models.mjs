// The model smoke script: checks the catalogue against real models, by hand, before a release and after an SDK
// upgrade. Not part of `pnpm test`.
//
//   node fixtures/smoke-models.mjs <matrix.json>
//
// The matrix is a JSON array of { kind, modelName, baseUrl?, keyEnv? }. A key is read from the environment variable
// that `keyEnv` names and from nowhere else; a local kind needs none, and an entry whose variable is unset is reported
// as "not checked". For each entry and each of the four efforts it runs two requests, as the loop does: one tool-call
// turn, then the reply's tool call sent back with its result and no reasoning parts. The report goes to
// fixtures/.results/smoke-models-<date>.json.
//
// It imports the catalogue directly, which Node runs without a build (the file has type-only imports), and drives the
// SDK itself.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogle } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { jsonSchema, streamText, tool } from 'ai';
import { findRow, isCloudEndpoint, REASONING_EFFORTS, sendRule } from '../src/llm/catalogue.ts';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const LOCAL = new Set(['ollama', 'lmstudio']);
const BASE = {
  ollama: 'http://localhost:11434/v1',
  lmstudio: 'http://localhost:1234/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

const TOOLS = {
  report_status: tool({
    description: 'Report the status of the task.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: { status: { type: 'string', enum: ['ok'] } },
      required: ['status'],
      additionalProperties: false,
    }),
  }),
};
const SYSTEM = 'You are testing a tool connection. Call the tool report_status with status "ok", then say "done".';

/** The body of the latest request, as it went out. */
let lastBody;
const fetch = async (input, init) => {
  lastBody = typeof init?.body === 'string' ? init.body : undefined;
  return globalThis.fetch(input, init);
};

/** The model and provider options as the extension makes them (src/llm/providers.ts). */
function model(entry, apiKey) {
  const { kind, modelName, baseUrl } = entry;
  if (kind === 'anthropic') {
    const anthropic = createAnthropic({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}), fetch });
    return { model: anthropic(modelName), providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } };
  }
  if (kind === 'gemini') {
    return { model: createGoogle({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}), fetch })(modelName) };
  }
  if (kind === 'openai') {
    const openai = createOpenAI({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}), fetch });
    return {
      model: openai.responses(modelName),
      providerOptions: { openai: { strictJsonSchema: false, store: false } },
    };
  }
  let url = (baseUrl || BASE[kind] || '').replace(/\/+$/, '');
  if (LOCAL.has(kind) && !url.endsWith('/v1')) url += '/v1';
  const openai = createOpenAI({ apiKey: apiKey || kind, baseURL: url, fetch });
  return { model: openai.chat(modelName), providerOptions: { openai: { strictJsonSchema: false } } };
}

/** One request; the body as sent is captured through fetch. */
async function request(made, messages, reasoning) {
  lastBody = undefined;
  const started = Date.now();
  try {
    const result = streamText({
      ...made,
      system: SYSTEM,
      messages,
      tools: TOOLS,
      maxOutputTokens: 2048,
      maxRetries: 0,
      ...(reasoning ? { reasoning } : {}),
      onError: () => undefined,
    });
    let error;
    for await (const part of result.fullStream) if (part.type === 'error') error = part.error;
    if (error) throw error;
    return {
      ok: true,
      finish: await result.finishReason,
      toolCalls: (await result.toolCalls).map(c => ({
        toolCallId: c.toolCallId,
        toolName: c.toolName,
        input: c.input,
        // Sent back with the call, as the loop does (Gemini 3's thought signature).
        ...(c.providerMetadata ? { providerOptions: c.providerMetadata } : {}),
      })),
      text: (await result.text).slice(0, 200),
      usage: await result.usage,
      warnings: await result.warnings,
      serialised: serialised(lastBody),
      ms: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      status: error?.statusCode,
      error: String(error?.message ?? error).slice(0, 500),
      responseBody: typeof error?.responseBody === 'string' ? error.responseBody.slice(0, 500) : undefined,
      serialised: serialised(lastBody),
      ms: Date.now() - started,
    };
  }
}

/** The value serialised for the effort, read from the body the SDK sent. */
function serialised(body) {
  let b;
  try {
    b = body ? JSON.parse(body) : undefined;
  } catch {
    return undefined;
  }
  if (!b) return undefined;
  return (
    b.reasoning_effort ??
    b.reasoning?.effort ??
    b.output_config?.effort ??
    (b.thinking ? JSON.stringify(b.thinking) : undefined) ??
    (b.generationConfig?.thinkingConfig ? JSON.stringify(b.generationConfig.thinkingConfig) : undefined)
  );
}

async function check(entry) {
  const apiKey = entry.keyEnv ? process.env[entry.keyEnv] : undefined;
  const row = findRow(entry.kind, entry.modelName, undefined, isCloudEndpoint(entry.kind, entry.baseUrl));
  const base = { ...entry, row: row?.id ?? null, capability: row?.reasoning ?? null };
  if (entry.keyEnv && !apiKey) return { ...base, status: 'not checked', why: `${entry.keyEnv} is not set` };
  if (!entry.keyEnv && !LOCAL.has(entry.kind)) return { ...base, status: 'not checked', why: 'no keyEnv' };
  const made = model(entry, apiKey);
  const efforts = [];
  for (const effort of REASONING_EFFORTS) {
    const wire = sendRule(row?.reasoning, effort, row?.wire);
    const messages = [{ role: 'user', content: 'Call report_status now.' }];
    const first = await request(made, messages, wire);
    const out = { effort, wire: wire ?? null, first };
    const callMade = first.ok && first.toolCalls?.[0];
    if (first.ok && !callMade) out.result = 'no tool call';
    if (callMade) {
      const c = first.toolCalls[0];
      messages.push(
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: c.toolCallId,
              toolName: c.toolName,
              input: c.input,
              ...(c.providerOptions ? { providerOptions: c.providerOptions } : {}),
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: c.toolCallId,
              toolName: c.toolName,
              output: { type: 'text', value: 'ok' },
            },
          ],
        },
      );
      const second = await request(made, messages, wire);
      out.second = second;
      out.result = second.ok ? 'passed' : 'second request failed';
    } else if (!first.ok) out.result = 'first request failed';
    efforts.push(out);
  }
  const status = efforts.every(e => e.result === 'passed') ? 'passed' : 'failed';
  return { ...base, status, efforts };
}

const [matrixPath] = process.argv.slice(2);
if (!matrixPath) {
  console.error('usage: node fixtures/smoke-models.mjs <matrix.json>');
  process.exit(2);
}
const matrix = JSON.parse(await readFile(matrixPath, 'utf8'));
const versions = Object.fromEntries(
  ['ai', '@ai-sdk/anthropic', '@ai-sdk/google', '@ai-sdk/openai'].map(p => [p, require(`${p}/package.json`).version]),
);
const results = [];
for (const entry of matrix) {
  const r = await check(entry);
  console.log(`${r.status.padEnd(12)} ${entry.kind} ${entry.modelName} (row ${r.row ?? 'none'})`);
  for (const e of r.efforts ?? []) console.log(`    ${e.effort.padEnd(7)} → ${String(e.wire).padEnd(8)} ${e.result}`);
  results.push(r);
}
const date = new Date().toISOString().slice(0, 10);
const out = join(here, '.results', `smoke-models-${date}.json`);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify({ date, versions, results }, null, 2));
console.log(`report: ${out}`);
