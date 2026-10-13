// The UI's languages: JSON catalogues loaded at runtime, so the language can change without a reload, with typed keys
// taken from the English catalogue. A missing key falls back to English.
import { useSyncExternalStore } from 'react';
import en from './locales/en.json';

export type MessageKey = keyof typeof en;
export type Language = 'en' | 'zh_CN' | 'zh_TW';
type Catalogue = Partial<Record<MessageKey, string>>;

/** Catalogues other than English, loaded when chosen. Adding a language is a JSON file and a line here. */
export const LOADERS: Partial<Record<Language, () => Promise<{ default: Catalogue }>>> = {
  zh_CN: () => import('./locales/zh_CN.json'),
  zh_TW: () => import('./locales/zh_TW.json'),
};

let language: Language = 'en';
let catalogue: Catalogue = en;
const listeners = new Set<() => void>();

/** The language for the "auto" setting: the browser's. */
export function browserLanguage(tag: string = globalThis.navigator?.language ?? 'en'): Language {
  const lower = tag.toLowerCase();
  if (lower.startsWith('zh')) return /tw|hk|mo|hant/.test(lower) ? 'zh_TW' : 'zh_CN';
  return 'en';
}

export function resolveLanguage(setting: string): Language {
  return setting === 'en' || setting === 'zh_CN' || setting === 'zh_TW' ? setting : browserLanguage();
}

export async function setLanguage(setting: string): Promise<void> {
  const next = resolveLanguage(setting);
  const loader = LOADERS[next];
  const loaded: Catalogue = loader ? (await loader()).default : en;
  language = loader ? next : 'en';
  catalogue = loaded;
  if (typeof document !== 'undefined') document.documentElement.lang = language.replace('_', '-');
  listeners.forEach(l => l());
}

export function currentLanguage(): Language {
  return language;
}

/** A string by key, with `{name}` placeholders filled from `params`. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = catalogue[key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders the component when the language changes. */
export function useLanguage(): Language {
  const current = () => language;
  return useSyncExternalStore(subscribe, current, current);
}
