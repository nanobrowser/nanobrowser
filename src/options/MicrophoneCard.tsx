// Settings → Permissions → Microphone, after Claude in Chrome's: whether Nanobrowser may use the microphone for voice
// input, with the way to allow it or to turn it off in Chrome.
import { useEffect, useState } from 'react';
import { Button } from '@src/ui/components';
import { t } from '@src/ui/i18n';
import { CheckIcon } from '@src/ui/icons';
import { SettingsCard, SettingsRow } from './SettingsCard';

/** Chrome's page for this extension's site permissions, where the microphone is allowed or blocked. */
const openChromeSettings = () =>
  void chrome.tabs.create({
    url: `chrome://settings/content/siteDetails?site=${encodeURIComponent(location.origin)}`,
  });

function ChromeSettingsLink({ children }: { children: string }) {
  return (
    <button
      type="button"
      className="text-nb-link underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-nb-accent"
      onClick={openChromeSettings}>
      {children}
    </button>
  );
}

export function MicrophoneCard() {
  const [mic, setMic] = useState<PermissionState | 'unknown'>('unknown');
  useEffect(() => {
    void navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then(p => {
        setMic(p.state);
        p.onchange = () => setMic(p.state);
      })
      .catch(() => setMic('unknown'));
  }, []);
  return (
    <SettingsCard title={t('perm.mic.title')} description={t('perm.mic.hint')}>
      {mic === 'granted' ? (
        <SettingsRow
          label={t('voice.mic.granted')}
          icon={
            <span className="flex size-6 items-center justify-center rounded-full bg-emerald-700 text-white">
              <CheckIcon size={14} />
            </span>
          }
          description={
            <>
              {t('perm.mic.grantedHint')} <ChromeSettingsLink>{t('perm.mic.turnOff')}</ChromeSettingsLink>
            </>
          }
        />
      ) : mic === 'denied' ? (
        <SettingsRow
          label={t('voice.mic.denied')}
          description={
            <>
              {t('perm.mic.neededHint')} <ChromeSettingsLink>{t('perm.mic.allowInChrome')}</ChromeSettingsLink>
            </>
          }
        />
      ) : (
        <SettingsRow label={t('voice.mic.notYet')} description={t('perm.mic.neededHint')}>
          <Button onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('/permission.html') })}>
            {t('mic.allow')}
          </Button>
        </SettingsRow>
      )}
    </SettingsCard>
  );
}
