// The catalogue check: every catalogue has every English key, with the same placeholders, and no key English lacks. A
// key left in English is reported unless it is on the list of strings that read the same in every language (commands,
// product names, placeholders alone).
import { describe, expect, it } from 'vitest';
import en from '../locales/en.json';
import zhCN from '../locales/zh_CN.json';
import zhTW from '../locales/zh_TW.json';

const SAME_IN_EVERY_LANGUAGE = new Set(['act.other', 'models.fix.ollama.linux']);
const catalogues: Record<string, Record<string, string>> = { zh_CN: zhCN, zh_TW: zhTW };
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

/** What a translator needs to know about a catalogue. */
export function untranslated(catalogue: Record<string, string>): {
  missing: string[];
  extra: string[];
  same: string[];
} {
  const english = en as Record<string, string>;
  return {
    missing: Object.keys(english).filter(key => !(key in catalogue)),
    extra: Object.keys(catalogue).filter(key => !(key in english)),
    same: Object.keys(english).filter(key => catalogue[key] === english[key] && !SAME_IN_EVERY_LANGUAGE.has(key)),
  };
}

describe('UI catalogues', () => {
  for (const [language, catalogue] of Object.entries(catalogues)) {
    it(`${language} has every key, translated, and nothing else`, () => {
      expect(untranslated(catalogue)).toEqual({ missing: [], extra: [], same: [] });
    });

    it(`${language} keeps every placeholder`, () => {
      const english = en as Record<string, string>;
      const wrong = Object.keys(catalogue).filter(
        key => key in english && placeholders(catalogue[key]).join() !== placeholders(english[key]).join(),
      );
      expect(wrong).toEqual([]);
    });
  }
});

describe('the runtime', () => {
  it('switches language without a reload, and follows the browser for "auto"', async () => {
    const { setLanguage, t, browserLanguage } = await import('../i18n');
    await setLanguage('zh_TW');
    expect(t('panel.newChat')).toBe('新對話');
    expect(t('models.listed', { count: 3 })).toBe('已列出 3 個模型');
    await setLanguage('zh_CN');
    expect(t('panel.newChat')).toBe('新对话');
    await setLanguage('en');
    expect(t('panel.newChat')).toBe('New chat');
    expect([browserLanguage('zh-HK'), browserLanguage('zh-Hans-CN'), browserLanguage('fr-FR')]).toEqual([
      'zh_TW',
      'zh_CN',
      'en',
    ]);
  });
});
