// Voice input through a transcription model: OpenAI's or Gemini's, called with the user's key. The panel records a
// short clip and sends it here; the text goes into the message box for the user to check and send. Knows nothing
// about browsers: the audio arrives as bytes.
import { createGoogle } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { NoTranscriptGeneratedError, transcribe } from 'ai';
import type { ProviderKind } from './providers';

export interface VoiceModel {
  id: string;
  label: string;
}

/** The voice models offered for each provider kind; a provider of another kind has none. */
export const VOICE_MODELS: Partial<Record<ProviderKind, VoiceModel[]>> = {
  openai: [{ id: 'gpt-transcribe', label: 'GPT Transcribe' }],
  gemini: [{ id: 'gemini-3.5-transcribe', label: 'Gemini 3.5 Transcribe' }],
};

export function voiceModelsFor(kind: ProviderKind): VoiceModel[] {
  return VOICE_MODELS[kind] ?? [];
}

export interface TranscriptionSpec {
  kind: ProviderKind;
  modelName: string;
  apiKey: string;
  baseUrl?: string;
}

export interface TranscribeOptions {
  /** The language spoken, as a BCP 47 tag (`zh-TW`); none to let the model detect it. */
  language?: string;
  abortSignal?: AbortSignal;
  /** Custom fetch, used by tests to inspect requests. */
  fetch?: typeof fetch;
}

/**
 * A hint in the script wanted: OpenAI's language parameter is ISO 639-1, so `zh` alone does not say Simplified or
 * Traditional, and a short prompt in that script steers the output.
 */
const SCRIPT_PROMPTS: Record<string, string> = {
  'zh-CN': '以下是普通话的句子，用简体中文书写。',
  'zh-TW': '以下是普通話的句子，用繁體中文書寫。',
};

/**
 * The codes Gemini Transcribe lists for the languages of the settings menu. A language it does not list (Traditional
 * Mandarin, Spain's Spanish) is sent with no code, so Gemini detects it.
 */
const GEMINI_CODES: Record<string, string> = {
  'en-US': 'en-US',
  'en-GB': 'en-GB',
  'zh-CN': 'cmn-Hans-CN',
  'ja-JP': 'ja-JP',
  'ko-KR': 'ko-KR',
  'fr-FR': 'fr-FR',
  'de-DE': 'de-DE',
  'it-IT': 'it-IT',
  'pt-BR': 'pt-BR',
};

/**
 * The provider options for a recording. OpenAI's are always set: for a model the SDK does not know, it would otherwise
 * ask for `verbose_json` with segment timestamps, which only `whisper-1` supports.
 */
export function languageOptions(kind: ProviderKind, language?: string): Record<string, Record<string, unknown>> {
  if (kind === 'gemini') {
    const code = language ? GEMINI_CODES[language] : undefined;
    return code ? { google: { languageCodes: [code] } } : {};
  }
  const prompt = language ? SCRIPT_PROMPTS[language] : undefined;
  return {
    openai: {
      responseFormat: 'json',
      timestampGranularities: [],
      ...(language ? { language: language.split('-')[0].toLowerCase() } : {}),
      ...(prompt ? { prompt } : {}),
    },
  };
}

/** Turns a recording into text with the chosen voice model: '' when nothing was heard. Throws the provider's error. */
export async function transcribeAudio(
  spec: TranscriptionSpec,
  audio: Uint8Array,
  options: TranscribeOptions = {},
): Promise<string> {
  const { kind, modelName, apiKey } = spec;
  const baseURL = spec.baseUrl?.trim() ? { baseURL: spec.baseUrl.trim() } : {};
  let model;
  if (kind === 'openai') model = createOpenAI({ apiKey, ...baseURL, fetch: options.fetch }).transcription(modelName);
  else if (kind === 'gemini')
    model = createGoogle({ apiKey, ...baseURL, fetch: options.fetch }).transcription(modelName);
  else throw new Error(`${kind} has no voice models`);
  try {
    const result = await transcribe({
      model,
      audio,
      providerOptions: languageOptions(kind, options.language) as never,
      maxRetries: 1,
      abortSignal: options.abortSignal,
    });
    return result.text.trim();
  } catch (error) {
    // The SDK throws when the model heard nothing; that is an empty transcript, not a failure.
    if (NoTranscriptGeneratedError.isInstance(error)) return '';
    throw error;
  }
}
