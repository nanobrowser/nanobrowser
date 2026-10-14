// Settings → Providers → Voice input: the voice model that turns a recording into text, offered for each OpenAI or
// Gemini provider with a key, and the language spoken. The microphone's status is in Settings → Permissions. Voice
// input uses a provider's model, so its card sits with them.
import { voiceModelsFor } from '@src/llm';
import { DEFAULT_SETTINGS, keysStorage, providersStorage, settingsStorage } from '@src/store/settings';
import type { ProviderConfig } from '@src/store/settings';
import { Select } from '@src/ui/components';
import { SettingsCard, SettingsRow } from './SettingsCard';
import { useStorage } from '@src/ui/hooks';
import { t } from '@src/ui/i18n';

const LANGUAGES = ['en-US', 'en-GB', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'fr-FR', 'de-DE', 'es-ES', 'it-IT', 'pt-BR'];

const EMPTY_PROVIDERS: ProviderConfig[] = [];
const EMPTY_KEYS: Record<string, string> = {};

export function VoiceCard() {
  const settings = useStorage(settingsStorage, DEFAULT_SETTINGS);
  const providers = useStorage(providersStorage, EMPTY_PROVIDERS);
  const keys = useStorage(keysStorage, EMPTY_KEYS);

  const choices = providers
    .filter(p => keys[p.id]?.trim())
    .flatMap(p =>
      voiceModelsFor(p.kind).map(m => ({ value: `${p.id}\u0000${m.id}`, label: `${p.name} · ${m.label}` })),
    );
  const chosen = settings.voiceModel ? `${settings.voiceModel.providerId}\u0000${settings.voiceModel.model}` : '';
  const current = choices.some(c => c.value === chosen) ? chosen : '';

  const set = (patch: Partial<typeof settings>) => void settingsStorage.set(s => ({ ...s, ...patch }));

  return (
    <SettingsCard title={t('voice.title')} description={t('voice.description')} className="flex flex-col gap-6">
      <SettingsRow
        label={t('voice.model')}
        description={choices.length ? t('voice.modelHint') : t('voice.modelNeedsKey')}>
        <Select
          aria-label={t('voice.model')}
          className="sm:max-w-xs"
          value={current}
          disabled={!choices.length}
          onChange={e => {
            const [providerId, model] = e.target.value.split('\u0000');
            set({ voiceModel: providerId ? { providerId, model } : null });
          }}>
          <option value="">{t('models.none')}</option>
          {choices.map(c => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </SettingsRow>
      <SettingsRow label={t('voice.language')} description={t('voice.languageHint')}>
        <Select
          aria-label={t('voice.language')}
          value={settings.dictationLanguage}
          onChange={e => set({ dictationLanguage: e.target.value })}>
          <option value="auto">{t('voice.detect')}</option>
          {LANGUAGES.map(l => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </Select>
      </SettingsRow>
    </SettingsCard>
  );
}
