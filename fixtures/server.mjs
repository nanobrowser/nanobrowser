// Fixture server for the browser control layer. node:http only.
//
// It listens on every loopback address, so the same pages answer on three sites:
//   http://localhost:8787   the main site
//   http://127.0.0.1:8787   a second site: frames from it are cross-site, and it plays the denied site
//   http://[::1]:8787       a third site, for frames nested two deep across sites
//
// Endpoints
//   GET  /<file>                  static pages from fixtures/pages
//   GET  /redirect?to=<url>       302 to <url>; every hop is counted
//   POST /submit                  accepts a form post and records its body
//   GET  /api/slow?ms=<n>         answers after n ms (max 30 s)
//   GET  /__requests              request counters per host, method and path, and recorded posts
//   POST /__reset                 clears the counters
//   GET  /__autorun/job           the next queued autorun job, once (204 when none)
//   POST /__autorun/progress      one check report from an autorun build
//   POST /__autorun/report        the final reports of an autorun build
//   POST /__llm/v1/chat/completions  a fake OpenAI-compatible model: streams the next scripted reply, or echoes
//   GET  /__llm/v1/models         lists the fake model, and one whose entry states its facts
//                                 (refused with a 401, as a wrong key is, for the key `wrong-key`)
//   POST /__llm/v1/audio/transcriptions  a fake OpenAI voice model: answers a fixed sentence for any WAV recording
//   GET  /__llm/transcriptions    what the fake voice model received (model, language, file type, size), newest last
//   POST /__llm/script            replaces the queue of scripted replies ({ replies: [...], rejectReasoning? }); with
//                                 rejectReasoning, a request that carries reasoning_effort is refused with a 400 that
//                                 names the field and takes no reply. A reply's reasoningTokens go in its usage
//   GET  /__llm/requests          the requests the fake model received (newest last)
//   POST /__llm/reset             clears the queue and the recorded requests
//   GET  /download?name=<file>    a small text file sent as an attachment (GET or POST), for the download report
//   GET  /__llm/api/ps            Ollama's list of loaded models: the fake model with a 12,288-token context
//   POST /__posthog/i/v0/e/       a fake PostHog capture endpoint for analytics: records each event; answers 503 while
//                                 failures are queued
//   GET  /__posthog/events        the events it received, oldest first
//   POST /__posthog/reset         clears them; { fail: n } makes the next n events fail
//   GET  /__live/keys             provider keys from this process's environment, only when NB_LIVE=1 (for the
//                                 live provider check; keys are never written to a file)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { EventEmitter } from 'node:events';

export const PORT = Number(process.env.FIXTURE_PORT ?? 8787);
const PAGES = resolve(import.meta.dirname, 'pages');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/** Counters keyed by "host method path". Internal /__ endpoints are not counted. */
const counters = new Map();
const posts = [];
const autorunJobs = [];
/** The fake model: replies to give, in order, and the requests it received. */
const llm = { replies: [], requests: [], transcriptions: [], rejectReasoning: false };
/** The fake PostHog: the events it received, and how many more to refuse. */
const posthog = { events: [], fail: 0 };
export const autorunEvents = new EventEmitter();

export function queueAutorunJob(job) {
  autorunJobs.push(job);
}

function count(req, path) {
  const key = `${req.headers.host} ${req.method} ${path}`;
  counters.set(key, (counters.get(key) ?? 0) + 1);
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': typeof body === 'object' && !Buffer.isBuffer(body) ? TYPES['.json'] : TYPES['.html'],
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    ...headers,
  });
  res.end(payload);
}

async function serveStatic(res, path) {
  const relative = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, '');
  let file = join(PAGES, relative || 'index.html');
  if (!file.startsWith(PAGES)) return send(res, 403, 'forbidden');
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    send(res, 200, body, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  } catch {
    send(res, 404, `<h1>Not found</h1><p>${path}</p>`);
  }
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, '');

  if (path.startsWith('/__')) {
    if (path === '/__requests') {
      const requests = [...counters].map(([key, n]) => {
        const [host, method, p] = key.split(' ');
        return { host, method, path: p, count: n };
      });
      return send(res, 200, { requests, posts });
    }
    if (path === '/__reset' && req.method === 'POST') {
      counters.clear();
      posts.length = 0;
      return send(res, 200, { ok: true });
    }
    if (path === '/__autorun/job') {
      const job = autorunJobs.shift();
      return job ? send(res, 200, job) : send(res, 204, '');
    }
    if (path.startsWith('/__autorun/') && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      autorunEvents.emit(path.slice('/__autorun/'.length), body);
      return send(res, 200, { ok: true });
    }
    if (path.startsWith('/__llm/')) return handleLlm(req, res, path);
    if (path === '/__posthog/i/v0/e/' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (posthog.fail > 0) {
        posthog.fail--;
        return send(res, 503, { error: 'failing on purpose' });
      }
      posthog.events.push(body);
      return send(res, 200, { status: 1 });
    }
    if (path === '/__posthog/events') return send(res, 200, posthog.events);
    if (path === '/__posthog/reset' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      posthog.events.length = 0;
      posthog.fail = Number(body.fail ?? 0);
      return send(res, 200, { ok: true });
    }
    if (path === '/__live/keys') {
      if (process.env.NB_LIVE !== '1') return send(res, 403, { error: 'set NB_LIVE=1' });
      const env = process.env;
      return send(res, 200, {
        anthropic: env.ANTHROPIC_API_KEY,
        openai: env.OPENAI_API_KEY,
        gemini: env.GEMINI_API_KEY ?? env.GOOGLE_GENERATIVE_AI_API_KEY,
        openrouter: env.OPENROUTER_API_KEY,
      });
    }
    return send(res, 404, { error: 'unknown endpoint' });
  }

  count(req, path);

  if (path === '/redirect') {
    const to = url.searchParams.get('to');
    if (!to) return send(res, 400, 'missing ?to=');
    return send(res, 302, '', { location: to });
  }
  if (path === '/submit') {
    if (req.method !== 'POST') return send(res, 405, 'POST only');
    const body = await readBody(req);
    posts.push({ host: req.headers.host, body, at: new Date().toISOString() });
    return send(res, 200, `<!doctype html><title>Submitted</title><h1>Submitted</h1><pre>${escapeHtml(body)}</pre>`);
  }
  // A file the page downloads: sent as an attachment, by GET or by a form's POST.
  if (path === '/download') {
    const name = (url.searchParams.get('name') ?? 'nb-dl-report.txt').replace(/[^\w.-]/g, '_');
    if (req.method === 'POST') await readBody(req);
    res.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store',
    });
    return res.end(`A file the fixture server sent: ${name}\n`);
  }
  if (path === '/api/slow') {
    const ms = Math.min(Number(url.searchParams.get('ms') ?? 1000), 30_000);
    await new Promise(r => setTimeout(r, ms));
    return send(res, 200, { ok: true, ms });
  }
  return serveStatic(res, path);
}

// A fake OpenAI-compatible model, so the extension's provider path can be checked with no network and no key.
// A scripted reply is { text?, toolCalls?: [{ name, input }], finish?, status?, error?, delayMs? }.
async function handleLlm(req, res, path) {
  if (path === '/__llm/script' && req.method === 'POST') {
    const script = JSON.parse((await readBody(req)) || '{}');
    llm.replies = script.replies ?? [];
    llm.rejectReasoning = !!script.rejectReasoning;
    return send(res, 200, { ok: true, queued: llm.replies.length });
  }
  if (path === '/__llm/reset' && req.method === 'POST') {
    llm.replies = [];
    llm.requests = [];
    llm.transcriptions = [];
    llm.rejectReasoning = false;
    return send(res, 200, { ok: true });
  }
  if (path === '/__llm/transcriptions') return send(res, 200, llm.transcriptions);
  if (path === '/__llm/v1/audio/transcriptions' && req.method === 'POST') {
    // Multipart form data, read as bytes and split at its boundary; the file must be 16 kHz mono 16-bit PCM WAV.
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(req.headers['content-type'] ?? '');
    const parts = boundary
      ? body
          .toString('latin1')
          .split(`--${boundary[1] ?? boundary[2]}`)
          .slice(1, -1)
          .map(part => {
            const end = part.indexOf('\r\n\r\n');
            return { headers: part.slice(2, end), value: part.slice(end + 4, -2) };
          })
      : [];
    const part = name => parts.find(p => new RegExp(`name="${name}"`).test(p.headers));
    const file = part('file');
    const wav = Buffer.from(file?.value ?? '', 'latin1');
    const header =
      wav.length >= 44
        ? {
            riff: wav.toString('ascii', 0, 4) === 'RIFF' && wav.readUInt32LE(4) === wav.length - 8,
            wave: wav.toString('ascii', 8, 16) === 'WAVEfmt ' && wav.readUInt32LE(16) === 16,
            pcm: wav.readUInt16LE(20) === 1 && wav.readUInt32LE(28) === 32000 && wav.readUInt16LE(32) === 2,
            channels: wav.readUInt16LE(22),
            sampleRate: wav.readUInt32LE(24),
            bits: wav.readUInt16LE(34),
            data: wav.toString('ascii', 36, 40) === 'data' && wav.readUInt32LE(40) === wav.length - 44,
          }
        : null;
    const valid =
      !!header &&
      header.riff &&
      header.wave &&
      header.pcm &&
      header.data &&
      (wav.length - 44) % 2 === 0 &&
      /audio\/wav/.test(file?.headers ?? '') &&
      header.channels === 1 &&
      header.sampleRate === 16000 &&
      header.bits === 16;
    llm.transcriptions.push({
      model: part('model')?.value ?? null,
      language: part('language')?.value ?? null,
      responseFormat: part('response_format')?.value ?? null,
      timestamps: parts.some(p => /name="timestamp_granularities/.test(p.headers)),
      fileType: /Content-Type: ([^\r]+)/i.exec(file?.headers ?? '')?.[1] ?? null,
      wav: valid,
      seconds: valid ? (wav.length - 44) / 32000 : 0,
    });
    if (!valid) return send(res, 400, { error: { message: 'not a 16 kHz mono 16-bit WAV recording' } });
    return send(res, 200, { text: 'Book a table for two at seven.' });
  }
  if (path === '/__llm/requests') return send(res, 200, llm.requests);
  if (path === '/__llm/api/ps') return send(res, 200, { models: [{ name: 'fixture-model', context_length: 12288 }] });
  if (path === '/__llm/v1/models' && req.headers.authorization === 'Bearer wrong-key')
    return send(res, 401, { error: { message: 'Incorrect API key provided' } });
  if (path === '/__llm/v1/models')
    return send(res, 200, {
      object: 'list',
      data: [
        { id: 'fixture-model', object: 'model' },
        // A model whose entry states facts, as Kimi's list does.
        {
          id: 'fixture-model-info',
          object: 'model',
          context_length: 65536,
          supports_image_in: true,
          supports_reasoning: true,
        },
      ],
    });
  if (path !== '/__llm/v1/chat/completions' || req.method !== 'POST')
    return send(res, 404, { error: 'unknown endpoint' });
  const body = JSON.parse((await readBody(req)) || '{}');
  llm.requests.push(body);
  const lastUser = [...(body.messages ?? [])].reverse().find(m => m.role === 'user');
  const userText = Array.isArray(lastUser?.content)
    ? lastUser.content.map(p => p.text ?? '').join(' ')
    : String(lastUser?.content ?? '');
  if (llm.rejectReasoning && body.reasoning_effort !== undefined) {
    return send(res, 400, {
      error: { message: 'Unrecognized request argument supplied: reasoning_effort', type: 'invalid_request_error' },
    });
  }
  const reply = llm.replies.shift() ?? { text: `You said: ${userText}` };
  if (reply.delayMs) await new Promise(r => setTimeout(r, reply.delayMs));
  if (reply.status) return send(res, reply.status, { error: { message: reply.error ?? `HTTP ${reply.status}` } });
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  const chunk = (delta, finish = null, usage) =>
    `data: ${JSON.stringify({
      id: 'fx',
      object: 'chat.completion.chunk',
      created: 0,
      model: body.model,
      choices: [{ index: 0, delta, finish_reason: finish }],
      ...(usage ? { usage } : {}),
    })}\n\n`;
  res.write(chunk({ role: 'assistant' }));
  const text = reply.text ?? '';
  // A few deltas, so streaming is exercised.
  for (const piece of text.match(/[\s\S]{1,12}/g) ?? []) {
    res.write(chunk({ content: piece }));
    await new Promise(r => setTimeout(r, 15));
  }
  (reply.toolCalls ?? []).forEach((call, index) =>
    res.write(
      chunk({
        tool_calls: [
          {
            index,
            id: call.id ?? `call_${index + 1}`,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
          },
        ],
      }),
    ),
  );
  const finish = reply.finish ?? (reply.toolCalls?.length ? 'tool_calls' : 'stop');
  const promptChars = JSON.stringify(body.messages ?? []).length;
  res.write(
    chunk({}, finish, {
      prompt_tokens: Math.ceil(promptChars / 4),
      completion_tokens: Math.ceil(text.length / 4) + 1 + (reply.reasoningTokens ?? 0),
      ...(reply.reasoningTokens ? { completion_tokens_details: { reasoning_tokens: reply.reasoningTokens } } : {}),
    }),
  );
  res.write('data: [DONE]\n\n');
  res.end();
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

export function startServer(port = PORT) {
  const server = createServer((req, res) => {
    handle(req, res).catch(error => {
      console.error(error);
      if (!res.headersSent) send(res, 500, String(error));
    });
  });
  return new Promise((resolveServer, reject) => {
    server.once('error', reject);
    // '::' with dual-stack answers on localhost, 127.0.0.1 and [::1].
    server.listen({ port, host: '::', ipv6Only: false }, () => resolveServer(server));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startServer();
  console.log(`Fixture server on http://localhost:${PORT} (also http://127.0.0.1:${PORT} and http://[::1]:${PORT})`);
}
