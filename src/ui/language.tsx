// The interface and answer languages. Language names are written in their own language, so they are not translated. The
// picker is Settings → General's UiLanguageRow.
import type { UiLanguage } from '@src/store/settings';

export const LANGUAGE_NAMES: Record<Exclude<UiLanguage, 'auto'>, string> = {
  en: 'English',
  zh_CN: '简体中文',
  zh_TW: '繁體中文',
};

/**
 * The answer language: the agent answers in the language of the user's message unless one is set. The value is the
 * language's English name, which the system prompt uses as it is.
 */
export const RESPONSE_LANGUAGES: Array<{ value: string; name: string }> = [
  { value: 'English', name: 'English' },
  { value: 'Simplified Chinese', name: '简体中文' },
  { value: 'Traditional Chinese', name: '繁體中文' },
  { value: 'Japanese', name: '日本語' },
  { value: 'Korean', name: '한국어' },
  { value: 'Spanish', name: 'Español' },
  { value: 'French', name: 'Français' },
  { value: 'German', name: 'Deutsch' },
];
