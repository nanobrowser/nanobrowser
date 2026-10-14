import { afterEach, describe, expect, it, vi } from 'vitest';
import { downmix, encodeWav, Recorder, voiceLanguage, voiceSetup } from '../voice';
import type { ProviderConfig } from '@src/store/settings';

const providers: ProviderConfig[] = [
  { id: 'o', kind: 'openai', name: 'OpenAI', models: [] },
  { id: 'g', kind: 'gemini', name: 'Gemini', models: [] },
  { id: 'a', kind: 'anthropic', name: 'Anthropic', models: [] },
];
const keys = { o: 'sk-test', g: 'gm-test', a: 'ak-test' };

describe('voice input', () => {
  it('uses the chosen voice model with its provider’s key', () => {
    expect(voiceSetup({ voiceModel: { providerId: 'o', model: 'gpt-transcribe' } }, providers, keys)).toEqual({
      kind: 'openai',
      modelName: 'gpt-transcribe',
      apiKey: 'sk-test',
      baseUrl: undefined,
    });
    expect(voiceSetup({ voiceModel: { providerId: 'g', model: 'gemini-3.5-transcribe' } }, providers, keys)?.kind).toBe(
      'gemini',
    );
  });

  it('has no voice model when none is chosen, the provider or key is gone, or the kind has none', () => {
    expect(voiceSetup({ voiceModel: null }, providers, keys)).toBeNull();
    expect(voiceSetup({ voiceModel: { providerId: 'x', model: 'gpt-transcribe' } }, providers, keys)).toBeNull();
    expect(voiceSetup({ voiceModel: { providerId: 'o', model: 'gpt-transcribe' } }, providers, { o: ' ' })).toBeNull();
    expect(voiceSetup({ voiceModel: { providerId: 'a', model: 'gpt-transcribe' } }, providers, keys)).toBeNull();
  });

  it('lets the model detect the language unless one is chosen', () => {
    expect(voiceLanguage('auto')).toBeUndefined();
    expect(voiceLanguage('zh-TW')).toBe('zh-TW');
  });

  it('encodes 16-bit mono WAV', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 16000);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...wav.slice(8, 16))).toBe('WAVEfmt ');
    expect(view.getUint32(4, true)).toBe(36 + 8);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(40, true)).toBe(8);
    expect([0, 1, 2, 3].map(i => view.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767]);
  });

  it('averages channels into one', () => {
    expect([...downmix([new Float32Array([1, 0]), new Float32Array([0, 1])])]).toEqual([0.5, 0.5]);
  });
});

/** A fake MediaRecorder, so a test can end a recording the way Chrome does when the microphone goes away. */
class FakeRecorder {
  static last: FakeRecorder;
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() {
    FakeRecorder.last = this;
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['a']) });
    this.onstop?.();
  }
}

describe('Recorder', () => {
  const track = { stop: vi.fn() };
  const useFakes = () => {
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) } });
  };
  afterEach(() => {
    vi.unstubAllGlobals();
    track.stop.mockClear();
  });

  it('says when Chrome ends the recording, and keeps what was recorded', async () => {
    useFakes();
    const onEnd = vi.fn();
    const recorder = (await Recorder.start(onEnd)) as Recorder;
    FakeRecorder.last.stop(); // the microphone was unplugged
    expect(onEnd).toHaveBeenCalledOnce();
    expect(track.stop).toHaveBeenCalled();
    expect((await recorder.stop()).size).toBe(1);
  });

  it('does not call back when it is stopped or cancelled', async () => {
    useFakes();
    const onEnd = vi.fn();
    await ((await Recorder.start(onEnd)) as Recorder).stop();
    ((await Recorder.start(onEnd)) as Recorder).cancel();
    expect(onEnd).not.toHaveBeenCalled();
  });
});
