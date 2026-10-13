// Voice input: the panel records with MediaRecorder, the clip becomes 16 kHz mono WAV, and the voice model the user
// chose in Settings → Providers turns it into text. Nothing is recorded until the user presses the microphone, and no
// audio is kept.
import { voiceModelsFor } from '@src/llm/transcribe';
import type { TranscriptionSpec } from '@src/llm/transcribe';
import { findProvider } from '@src/store/settings';
import type { ProviderConfig, Settings } from '@src/store/settings';

/** A recording stops by itself after two minutes, and is then transcribed. */
export const MAX_RECORDING_MS = 120_000;
/** Speech models work at 16 kHz; a two-minute clip is then under 4 MB. */
export const SAMPLE_RATE = 16_000;

/** The voice model chosen in Settings, with its provider's key; null when none is chosen or it can no longer be used. */
export function voiceSetup(
  settings: Pick<Settings, 'voiceModel'>,
  providers: ProviderConfig[],
  keys: Record<string, string>,
): TranscriptionSpec | null {
  const ref = settings.voiceModel;
  const provider = ref ? findProvider(providers, ref.providerId) : null;
  const apiKey = provider ? keys[provider.id]?.trim() : '';
  if (!ref || !provider || !apiKey || !voiceModelsFor(provider.kind).some(m => m.id === ref.model)) return null;
  return { kind: provider.kind, modelName: ref.model, apiKey, baseUrl: provider.baseUrl };
}

/** The language hint sent with a recording: none for 'auto', so the model detects it. */
export function voiceLanguage(setting: string): string | undefined {
  return setting && setting !== 'auto' ? setting : undefined;
}

/** 16-bit PCM WAV of mono samples in [-1, 1]. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) =>
    [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => {
    const clamped = Math.max(-1, Math.min(1, s));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  });
  return bytes;
}

/** The channels of a decoded clip, averaged into one. */
export function downmix(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const mono = new Float32Array(channels[0]?.length ?? 0);
  for (const channel of channels) channel.forEach((s, i) => (mono[i] += s / channels.length));
  return mono;
}

/** A recorded clip (WebM with Opus, as Chrome records it) as 16 kHz mono WAV: decoding at that rate resamples it. */
export async function toWav(clip: Blob): Promise<Uint8Array> {
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const decoded = await context.decodeAudioData(await clip.arrayBuffer());
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  return encodeWav(downmix(channels), SAMPLE_RATE);
}

/** Why a recording could not start: the microphone is not allowed, or there is none. */
export type RecordError = 'not-allowed' | 'no-microphone' | 'error';

/**
 * One recording from the microphone, until stop(). `onEnd` is called when it ends by itself: at the time limit, or when
 * Chrome stops it (the microphone was unplugged, for example), so the panel can stop and send what it has.
 */
export class Recorder {
  #stream: MediaStream;
  #recorder: MediaRecorder;
  #chunks: Blob[] = [];
  #stopped: Promise<Blob>;
  #timer: ReturnType<typeof setTimeout>;
  /** stop() or cancel() was called. */
  #ending = false;

  private constructor(stream: MediaStream, onEnd: () => void) {
    this.#stream = stream;
    this.#recorder = new MediaRecorder(stream);
    this.#recorder.ondataavailable = event => {
      if (event.data.size) this.#chunks.push(event.data);
    };
    this.#stopped = new Promise(resolve => {
      this.#recorder.onstop = () => {
        this.#release();
        resolve(new Blob(this.#chunks, { type: this.#recorder.mimeType }));
        if (!this.#ending) onEnd();
      };
    });
    this.#recorder.start();
    this.#timer = setTimeout(onEnd, MAX_RECORDING_MS);
  }

  /** Starts recording, or says why it cannot. */
  static async start(onEnd: () => void): Promise<Recorder | RecordError> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const name = (error as Error).name;
      if (name === 'NotAllowedError' || name === 'SecurityError') return 'not-allowed';
      if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-microphone';
      return 'error';
    }
    try {
      return new Recorder(stream, onEnd);
    } catch {
      // MediaRecorder could not start: the microphone is released.
      stream.getTracks().forEach(track => track.stop());
      return 'error';
    }
  }

  /** Stops and returns the clip. */
  stop(): Promise<Blob> {
    this.#ending = true;
    if (this.#recorder.state !== 'inactive') this.#recorder.stop();
    return this.#stopped;
  }

  /** Stops and drops the clip. */
  cancel(): void {
    this.#ending = true;
    this.#chunks = [];
    if (this.#recorder.state !== 'inactive') this.#recorder.stop();
    else this.#release();
  }

  #release(): void {
    clearTimeout(this.#timer);
    this.#stream.getTracks().forEach(track => track.stop());
  }
}
