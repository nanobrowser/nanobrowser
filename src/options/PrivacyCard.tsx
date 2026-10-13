// Settings → Data → Privacy: the anonymous daily ping and the usage counts. The worker sends; this card only sets the
// two switches.
import { DEFAULT_SETTINGS, settingsStorage } from '@src/store/settings';
import { Switch } from '@src/ui/components';
import { useStorage } from '@src/ui/hooks';
import { t } from '@src/ui/i18n';
import { SettingsCard, SettingsRow } from './SettingsCard';

export const PRIVACY_URL = 'https://github.com/nanobrowser/nanobrowser/blob/HEAD/PRIVACY.md';

export function PrivacyCard() {
  const settings = useStorage(settingsStorage, DEFAULT_SETTINGS);
  return (
    <SettingsCard title={t('privacy.title')} className="flex flex-col gap-6">
      <SettingsRow label={t('privacy.ping')} description={t('privacy.pingHint')}>
        <Switch
          aria-label={t('privacy.ping')}
          checked={settings.analyticsPing}
          onChange={on => void settingsStorage.set(s => ({ ...s, analyticsPing: on }))}
        />
      </SettingsRow>
      <SettingsRow label={t('privacy.stats')} description={t('privacy.statsHint')}>
        <Switch
          aria-label={t('privacy.stats')}
          checked={settings.analyticsStats}
          onChange={on => void settingsStorage.set(s => ({ ...s, analyticsStats: on }))}
        />
      </SettingsRow>
      <a className="self-start text-sm text-nb-accent underline" href={PRIVACY_URL} target="_blank" rel="noreferrer">
        {t('privacy.policy')}
      </a>
    </SettingsCard>
  );
}
