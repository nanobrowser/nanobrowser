// The microphone page: a side panel cannot show the microphone prompt, so the first press of the microphone button
// opens this page, which asks with getUserMedia and closes once access is given. The panel tries again when it closes.
// Ported from the current Nanobrowser's permission page.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@src/ui/index.css';
import { DEFAULT_SETTINGS, settingsStorage } from '@src/store/settings';
import { setLanguage, t, useLanguage } from '@src/ui/i18n';
import { applyTheme, watchSystemTheme } from '@src/ui/theme';
import { LogoMark, MicIcon } from '@src/ui/icons';

function MicPermission() {
  useLanguage();
  const [status, setStatus] = useState<'idle' | 'asking' | 'granted' | 'denied' | 'missing'>('idle');
  useEffect(() => {
    void settingsStorage.get().then(s => {
      void setLanguage((s ?? DEFAULT_SETTINGS).uiLanguage);
      applyTheme((s ?? DEFAULT_SETTINGS).theme);
    });
    void navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then(p => p.state === 'granted' && setStatus('granted'))
      .catch(() => undefined);
  }, []);

  const ask = async () => {
    setStatus('asking');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      setStatus('granted');
      setTimeout(() => window.close(), 1500);
    } catch (error) {
      setStatus((error as Error).name === 'NotFoundError' ? 'missing' : 'denied');
    }
  };

  return (
    <div className="nb-wave min-h-full px-4 pt-16">
      <main className="mx-auto flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-nb-border bg-nb-bg p-8 text-center shadow-pop">
        <div className="flex items-center gap-2">
          <LogoMark size={40} />
          <span className="flex size-10 items-center justify-center rounded-full bg-nb-surface text-nb-link">
            <MicIcon size={22} />
          </span>
        </div>
        <h1 className="text-lg font-semibold">{t('mic.title')}</h1>
        <p className="text-sm text-nb-muted">{t('mic.why')}</p>
        <button
          type="button"
          disabled={status === 'asking' || status === 'granted'}
          className="rounded-lg bg-nb-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-nb-accent-strong disabled:opacity-50"
          onClick={() => void ask()}>
          {status === 'granted' ? t('mic.granted') : t('mic.allow')}
        </button>
        <p role="status" className="text-sm">
          {status === 'granted'
            ? t('mic.closing')
            : status === 'denied'
              ? t('mic.denied')
              : status === 'missing'
                ? t('mic.missing')
                : ''}
        </p>
      </main>
    </div>
  );
}

const container = document.querySelector('#app-container');
if (container) {
  watchSystemTheme();
  createRoot(container).render(<MicPermission />);
}
