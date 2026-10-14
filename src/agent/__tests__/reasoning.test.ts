// The effort in the loop, with the scripted model: what each turn sends and records, the fallback when a server refuses
// the option, the summary call at None, and a reply that was all reasoning.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { APICallError } from 'ai';
import { IMAGE_NOT_SENT, ScriptedModel, resolveProfile } from '@src/llm';
import type { ProviderKind, ReasoningEffort, ReasoningSupport, ScriptedCall, ScriptedReply } from '@src/llm';
import { activeBranch, appendEntry, createConversation } from '@src/store/conversations';
import { closeDb } from '@src/store/db';
import en from '@src/ui/locales/en.json';
import type { EntryOf } from '@src/store/types';
import { AgentLoop, CUT_BEFORE_ANYTHING, IMAGES_DROPPED, REASONING_DROPPED, STOPPED_BY_USER } from '../loop';
import { summarise } from '../compaction';
import type { ResolvedModel } from '../run';
import { toolsForRun } from '../tools';
import { FakeHost, FakeLayer, receipt, ok } from '../testing/fake-layer';

afterEach(async () => {
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
});

type Script = ScriptedReply[] | ((call: ScriptedCall, index: number) => ScriptedReply);

/** A capability as the two facts a test would have learnt. */
const facts = (support: ReasoningSupport) => ({
  reasons: support !== 'none',
  acceptsNone: support === 'optional',
  at: '',
});

async function setup(
  script: Script,
  options: {
    reasoning?: ReasoningEffort;
    support?: ReasoningSupport;
    kind?: ProviderKind;
    layer?: FakeLayer;
    /** A vision model with an image in the conversation. */
    image?: true;
  } = {},
) {
  const c = await createConversation({ mode: 'auto' });
  await appendEntry(c.id, { type: 'message', message: { role: 'user', parts: [{ type: 'text', text: 'Do it' }] } });
  if (options.image) {
    const image = { type: 'image' as const, data: 'aGk=', mediaType: 'image/png', note: 'A screenshot.' };
    await appendEntry(c.id, { type: 'message', message: { role: 'user', parts: [image] } });
  }
  const scripted = new ScriptedModel(script);
  const kind = options.kind ?? 'openai-compatible';
  const model: ResolvedModel = {
    ref: { providerId: 'p', model: 'm' },
    chat: scripted.chat({ kind }),
    profile: resolveProfile({
      kind,
      modelName: 'm',
      ...(options.support ? { tested: facts(options.support) } : {}),
      ...(options.image ? { overrides: { vision: true } } : {}),
    }),
    reasoning: options.reasoning ?? 'low',
    learn: vi.fn(),
  };
  const loop = new AgentLoop({
    conversationId: c.id,
    runId: 'r',
    model,
    system: 'sys',
    tools: toolsForRun({ vision: false }),
    layer: options.layer ?? new FakeLayer(),
    host: new FakeHost(),
    signal: new AbortController().signal,
    emit: () => undefined,
    turnCap: 20,
  });
  return { c, loop, scripted, model };
}

const call = (name: string, input: unknown, id: string) => ({ name, input, id });
const done = { toolCalls: [call('done', { outcome: 'success', summary: 'Done.' }, 'd')] };
const refused = new APICallError({
  message: 'Unrecognized request argument supplied: reasoning_effort',
  url: 'http://x/v1/chat/completions',
  requestBodyValues: {},
  statusCode: 400,
  isRetryable: false,
});

async function replies(conversationId: string) {
  return (await activeBranch(conversationId)).filter(
    (e): e is EntryOf<'message'> => e.type === 'message' && e.message.role === 'assistant' && !!e.meta,
  );
}

async function notices(conversationId: string) {
  return (await activeBranch(conversationId)).filter(e => e.type === 'ui' && e.kind === 'notice');
}

describe('the effort on each turn', () => {
  it('sends the effort on every turn and records it with each reply', async () => {
    const { c, loop, scripted } = await setup([{ toolCalls: [call('read', {}, 'r')] }, done], { support: 'optional' });
    await loop.run();
    expect(scripted.calls.map(x => x.reasoning)).toEqual(['low', 'low']);
    expect((await replies(c.id)).map(e => e.meta?.reasoning)).toEqual(['low', 'low']);
  });

  it('sends nothing for an unknown model at None, and records nothing', async () => {
    const { c, loop, scripted } = await setup([done], { reasoning: 'none' });
    await loop.run();
    expect(scripted.calls[0].reasoning).toBeUndefined();
    expect((await replies(c.id))[0].meta).not.toHaveProperty('reasoning');
  });

  it('sends Low for None on a model that cannot stop reasoning', async () => {
    const { loop, scripted } = await setup([done], { reasoning: 'none', support: 'always' });
    await loop.run();
    expect(scripted.calls[0].reasoning).toBe('low');
  });
});

describe('a server that refuses the option', () => {
  it("writes the catalogue's notice string, so the panel shows it in the user's language", () => {
    expect(en['notice.reasoningDropped']).toBe(REASONING_DROPPED);
  });

  it('sends the same request once more without it, then nothing for the rest of the run, with one notice', async () => {
    const script = (x: ScriptedCall, i: number): ScriptedReply => {
      if (x.reasoning) return { error: refused };
      return i <= 1 ? { toolCalls: [call('read', {}, 'r')] } : done;
    };
    const { c, loop, scripted, model } = await setup(script, { support: 'optional' });
    const end = await loop.run();
    expect(end).toMatchObject({ status: 'done', turns: 2 });
    // The first request with the option, the same one without it, then the next turn without it.
    expect(scripted.calls.map(x => x.reasoning)).toEqual(['low', undefined, undefined]);
    expect(scripted.calls[1].prompt).toEqual(scripted.calls[0].prompt);
    expect(model.reasoningDropped).toBe(true);
    const n = await notices(c.id);
    expect(n).toHaveLength(1);
    expect((n[0] as EntryOf<'ui'>).data).toMatchObject({ text: REASONING_DROPPED });
    // Nothing was recorded as sent.
    expect((await replies(c.id)).every(e => !e.meta?.reasoning)).toBe(true);
    // The summary call of the same run reads the same handle: nothing is sent there either.
    await summarise(model, [], null);
    expect(scripted.calls.at(-1)!.reasoning).toBeUndefined();
  });

  it('fires on Anthropic too', async () => {
    const thinking = new APICallError({
      message: 'thinking: invalid value',
      url: 'https://api.anthropic.com/v1/messages',
      requestBodyValues: {},
      statusCode: 400,
      isRetryable: false,
    });
    const script = (x: ScriptedCall): ScriptedReply => (x.reasoning ? { error: thinking } : done);
    const { loop, scripted, model } = await setup(script, { kind: 'anthropic', support: 'optional' });
    expect((await loop.run()).status).toBe('done');
    expect(scripted.calls.map(x => x.reasoning)).toEqual(['low', undefined]);
    // A refused level is not stored.
    expect(model.learn).not.toHaveBeenCalled();
  });

  it('tries Low once when None is refused, goes on as `always`, and keeps it', async () => {
    const script = (x: ScriptedCall, i: number): ScriptedReply => {
      if (x.reasoning === 'none') return { error: refused };
      return i <= 1 ? { toolCalls: [call('read', {}, 'r')] } : done;
    };
    const { c, loop, scripted, model } = await setup(script, { reasoning: 'none', support: 'optional' });
    expect((await loop.run()).status).toBe('done');
    expect(scripted.calls.map(x => x.reasoning)).toEqual(['none', 'low', 'low']);
    expect(model.profile.reasoning).toBe('always');
    expect(model.learn).toHaveBeenCalledWith({ acceptsNone: false });
    expect(await notices(c.id)).toHaveLength(0);
    expect((await replies(c.id)).map(e => e.meta?.reasoning)).toEqual(['low', 'low']);
  });
});

describe('a model that refuses images', () => {
  const noImages = new APICallError({
    message: 'This model does not support image input',
    url: 'http://x/v1/chat/completions',
    requestBodyValues: {},
    statusCode: 400,
    isRetryable: false,
  });
  const hasImage = (x: ScriptedCall) => JSON.stringify(x.prompt).includes('"type":"file"');

  it("writes the catalogue's notice string", () => {
    expect(en['notice.imagesDropped']).toBe(IMAGES_DROPPED);
    expect(en['notice.stopped']).toBe(STOPPED_BY_USER);
  });

  it('sends the request again without its images, goes on without vision, keeps it, with one notice', async () => {
    const script = (x: ScriptedCall): ScriptedReply => (hasImage(x) ? { error: noImages } : done);
    const { c, loop, scripted, model } = await setup(script, { image: true });
    expect((await loop.run()).status).toBe('done');
    expect(scripted.calls).toHaveLength(2);
    expect(hasImage(scripted.calls[0])).toBe(true);
    expect(JSON.stringify(scripted.calls[1].prompt)).toContain(IMAGE_NOT_SENT);
    expect(model.profile.vision).toBe(false);
    expect(model.learn).toHaveBeenCalledWith({ vision: false });
    const n = await notices(c.id);
    expect(n).toHaveLength(1);
    expect((n[0] as EntryOf<'ui'>).data).toMatchObject({ text: IMAGES_DROPPED });
  });
});

describe('the summary call', () => {
  it('runs at None (Low for a model that always reasons)', async () => {
    const optional = await setup([{ text: 'summary' }], { reasoning: 'high', support: 'optional' });
    await summarise(optional.model, [], null);
    expect(optional.scripted.calls[0].reasoning).toBe('none');
    const always = await setup([{ text: 'summary' }], { reasoning: 'high', support: 'always' });
    await summarise(always.model, [], null);
    expect(always.scripted.calls[0].reasoning).toBe('low');
  });
});

describe('a reply that is all reasoning', () => {
  const allReasoning: ScriptedReply = { finish: 'length', usage: { input: 100, output: 400, reasoning: 400 } };

  it('ends the turn as an error before a mutation', async () => {
    const { loop } = await setup([allReasoning], { support: 'optional' });
    expect(await loop.run()).toMatchObject({ status: 'failed', outcome: 'failed', reason: CUT_BEFORE_ANYTHING });
  });

  it('and after one', async () => {
    const layer = new FakeLayer({ click: () => ok('clicked', { receipt: receipt() }) });
    const { loop } = await setup([{ toolCalls: [call('click', { target: { ref: 'a1' } }, 'c')] }, allReasoning], {
      support: 'optional',
      layer,
    });
    expect(await loop.run()).toMatchObject({ status: 'failed', reason: CUT_BEFORE_ANYTHING });
  });
});
