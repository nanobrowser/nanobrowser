// The settings page. Each section reads and writes chrome.storage directly.
import { Fragment, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, settingsStorage } from '@src/store/settings';
import { useStorage } from '@src/ui/hooks';
import { setLanguage, t, useLanguage } from '@src/ui/i18n';
import { applyTheme } from '@src/ui/theme';
import type { MessageKey } from '@src/ui/i18n';
import { GeneralSection } from './GeneralSection';
import { ProvidersSection } from './ProvidersSection';
import { PermissionsSection } from './PermissionsSection';
import { ShortcutsSection } from './ShortcutsSection';
import { MemorySection } from './MemorySection';
import { DataSection } from './DataSection';
import { AboutSection } from './AboutSection';
import { Logo } from '@src/ui/icons';
import { websiteUrl } from '@src/ui/links';

const SECTIONS: Array<{ id: string; label: MessageKey; render: () => JSX.Element }> = [
  { id: 'general', label: 'settings.nav.general', render: () => <GeneralSection /> },
  { id: 'providers', label: 'settings.nav.providers', render: () => <ProvidersSection /> },
  { id: 'permissions', label: 'settings.nav.permissions', render: () => <PermissionsSection /> },
  { id: 'shortcuts', label: 'settings.nav.shortcuts', render: () => <ShortcutsSection /> },
  { id: 'memory', label: 'settings.nav.memory', render: () => <MemorySection /> },
  { id: 'data', label: 'settings.nav.data', render: () => <DataSection /> },
  { id: 'about', label: 'settings.nav.about', render: () => <AboutSection /> },
];

/** The section the address names (`#data`), or the first. */
function sectionFromHash(): string {
  const id = location.hash.slice(1).split('?')[0];
  return SECTIONS.some(s => s.id === id) ? id : SECTIONS[0].id;
}

export function App() {
  useLanguage();
  const settings = useStorage(settingsStorage, DEFAULT_SETTINGS);
  const [section, setSection] = useState(sectionFromHash);
  // A link to another section of this page changes only the hash.
  useEffect(() => {
    const onHash = () => setSection(sectionFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => void setLanguage(settings.uiLanguage), [settings.uiLanguage]);
  useEffect(() => applyTheme(settings.theme), [settings.theme]);
  const active = SECTIONS.find(s => s.id === section) ?? SECTIONS[0];
  const go = (id: string) => {
    setSection(id);
    history.replaceState(null, '', `#${id}`);
  };
  return (
    // After Claude in Chrome's settings: the brand's logo and "Settings" in the system's serif at the top left, the
    // sections as a plain list beside the cards with the open one on a filled pill, and the section's name only in
    // that list.
    <div className="nb-field min-h-full">
      <div className="mx-auto flex min-h-full max-w-6xl flex-col px-3 py-5 sm:px-6 sm:py-8">
        <header className="mb-6 sm:mb-10 sm:px-3">
          <h1 className="flex flex-wrap items-center gap-x-3 gap-y-2 font-serif text-xl font-normal leading-tight sm:text-[28px]">
            <Logo height={28} />
            <span>{t('settings.title')}</span>
          </h1>
        </header>
        <div className="flex flex-col gap-6 sm:flex-row sm:gap-12">
          <nav
            aria-label={t('settings.title')}
            className="flex shrink-0 flex-col gap-1 sm:sticky sm:top-8 sm:w-52 sm:self-start">
            {SECTIONS.map(s => (
              <Fragment key={s.id}>
                {/* Help, a link to the website's help pages in a new tab, sits above About; it is not a section. */}
                {s.id === 'about' ? (
                  <a
                    href={websiteUrl('/docs', 'settings')}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg px-3 py-2.5 text-left text-[15px] text-nb-fg/80 transition-colors hover:bg-nb-surface/60 hover:text-nb-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-nb-accent">
                    {t('settings.nav.help')}
                  </a>
                ) : null}
                <button
                  type="button"
                  aria-current={s.id === section ? 'page' : undefined}
                  className={`rounded-lg px-3 py-2.5 text-left text-[15px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-nb-accent ${s.id === section ? 'bg-nb-surface text-nb-fg' : 'text-nb-fg/80 hover:bg-nb-surface/60 hover:text-nb-fg'}`}
                  onClick={() => go(s.id)}>
                  {t(s.label)}
                </button>
              </Fragment>
            ))}
          </nav>
          <main className="min-w-0 max-w-4xl flex-1">{active.render()}</main>
        </div>
      </div>
    </div>
  );
}
