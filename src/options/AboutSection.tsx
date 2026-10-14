// Settings → About: the version, the project's licence, the website, and the open-source packages the extension ships with theirs.
import { SettingsCard } from './SettingsCard';
import { t } from '@src/ui/i18n';
import { LICENCES } from './licences';
import { websiteUrl } from '@src/ui/links';

export function AboutSection() {
  const manifest = chrome.runtime.getManifest();
  return (
    <div className="flex flex-col gap-6">
      <h2 className="sr-only">{t('settings.nav.about')}</h2>
      <SettingsCard title="Nanobrowser" className="flex flex-col gap-1">
        <p className="text-sm">{t('about.version', { version: manifest.version })}</p>
        <p className="text-sm text-nb-muted">{t('about.license', { license: 'Apache-2.0' })}</p>
        <p className="text-sm">
          {t('about.website')}{' '}
          <a className="text-nb-link underline" href={websiteUrl('/', 'about')} target="_blank" rel="noreferrer">
            nanobrowser.ai
          </a>
        </p>
      </SettingsCard>
      <SettingsCard title={t('about.licences')}>
        <ul className="flex flex-col gap-1 text-sm">
          {LICENCES.map(l => (
            <li key={l.name} className="flex flex-wrap gap-x-2">
              <a className="break-all font-mono text-nb-link underline" href={l.url} target="_blank" rel="noreferrer">
                {l.name}
              </a>
              <span className="text-nb-muted">{l.licence}</span>
            </li>
          ))}
        </ul>
      </SettingsCard>
    </div>
  );
}
