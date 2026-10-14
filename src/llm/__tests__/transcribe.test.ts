import { describe, expect, it, vi } from 'vitest';
import { languageOptions, transcribeAudio, voiceModelsFor } from '../transcribe';

const WAV = new Uint8Array([
  ...'RIFF'.split('').map(c => c.charCodeAt(0)),
  36,
  0,
  0,
  0,
  ...'WAVEfmt '.split('').map(c => c.charCodeAt(0)),
  ...new Array(28).fill(0),
]);

function fakeFetch(answer: unknown) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, requests };
}

describe('voice models', () => {
  it('are offered for OpenAI and Gemini only', () => {
    expect(voiceModelsFor('openai').map(m => m.id)).toEqual(['gpt-transcribe']);
    expect(voiceModelsFor('gemini').map(m => m.id)).toEqual(['gemini-3.5-transcribe']);
    expect(voiceModelsFor('anthropic')).toEqual([]);
    expect(voiceModelsFor('openai-compatible')).toEqual([]);
  });

  it('pass the language as each provider expects', () => {
    expect(languageOptions('openai')).toEqual({ openai: { responseFormat: 'json', timestampGranularities: [] } });
    expect(languageOptions('openai', 'fr-FR')).toEqual({
      openai: { responseFormat: 'json', timestampGranularities: [], language: 'fr' },
    });
    expect(languageOptions('openai', 'zh-TW').openai.prompt).toMatch(/繁體/);
    expect(languageOptions('gemini')).toEqual({});
    expect(languageOptions('gemini', 'zh-CN')).toEqual({ google: { languageCodes: ['cmn-Hans-CN'] } });
    expect(languageOptions('gemini', 'en-GB')).toEqual({ google: { languageCodes: ['en-GB'] } });
    // Not in Gemini's list: detected.
    expect(languageOptions('gemini', 'zh-TW')).toEqual({});
    expect(languageOptions('gemini', 'es-ES')).toEqual({});
  });

  it('send the recording to OpenAI’s transcription endpoint', async () => {
    const { fetch, requests } = fakeFetch({ text: ' Book a table for two. ' });
    const text = await transcribeAudio({ kind: 'openai', modelName: 'gpt-transcribe', apiKey: 'sk-test' }, WAV, {
      language: 'en-US',
      fetch,
    });
    expect(text).toBe('Book a table for two.');
    expect(requests[0].url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(new Headers(requests[0].init?.headers).get('authorization')).toBe('Bearer sk-test');
    const form = requests[0].init?.body as FormData;
    expect(form.get('model')).toBe('gpt-transcribe');
    expect(form.get('language')).toBe('en');
    expect(form.get('response_format')).toBe('json');
    expect(form.getAll('timestamp_granularities[]')).toEqual([]);
    expect([...form.keys()].sort()).toEqual(['file', 'language', 'model', 'response_format', 'temperature']);
    expect((form.get('file') as File).type).toBe('audio/wav');
  });

  it('send the recording to Gemini’s transcription model', async () => {
    const { fetch, requests } = fakeFetch({ steps: [{ content: [{ type: 'text', text: '订两个人的位子。' }] }] });
    const text = await transcribeAudio({ kind: 'gemini', modelName: 'gemini-3.5-transcribe', apiKey: 'gm-test' }, WAV, {
      language: 'zh-CN',
      fetch,
    });
    expect(text).toBe('订两个人的位子。');
    expect(requests[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(new Headers(requests[0].init?.headers).get('x-goog-api-key')).toBe('gm-test');
    const body = JSON.parse(String(requests[0].init?.body));
    expect(body.model).toBe('gemini-3.5-transcribe');
    expect(body.input[0]).toMatchObject({ type: 'audio', mime_type: 'audio/wav' });
    expect(body.generation_config.transcription_config.language_codes).toEqual(['cmn-Hans-CN']);
  });

  it('give an empty text when nothing was heard', async () => {
    const openai = fakeFetch({ text: '' });
    expect(
      await transcribeAudio({ kind: 'openai', modelName: 'gpt-transcribe', apiKey: 'k' }, WAV, { fetch: openai.fetch }),
    ).toBe('');
    const gemini = fakeFetch({ steps: [] });
    expect(
      await transcribeAudio({ kind: 'gemini', modelName: 'gemini-3.5-transcribe', apiKey: 'k' }, WAV, {
        fetch: gemini.fetch,
      }),
    ).toBe('');
  });

  it('refuse a provider with no voice models', async () => {
    await expect(transcribeAudio({ kind: 'anthropic', modelName: 'x', apiKey: 'k' }, WAV)).rejects.toThrow(
      /no voice models/,
    );
  });
});
