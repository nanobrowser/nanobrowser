// The notice for Auto mode: what the agent does on its own in this mode. The panel shows it once per profile, the first
// time Auto is chosen there, until "Got it"; Settings → General shows it whenever Auto is the default mode, with no
// button.
import { settingsStorage } from '@src/store/settings';
import { t } from './i18n';

export function AutoNotice({ onDone, dismissible = true }: { onDone?: () => void; dismissible?: boolean }) {
  return (
    <p
      className={`rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 leading-relaxed text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100 ${dismissible ? 'text-xs' : 'text-sm'}`}
      role="status">
      {t('composer.autoNotice')}
      {dismissible ? (
        <>
          {' '}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => {
              onDone?.();
              void settingsStorage.set(s => ({ ...s, autoNoticeShown: true }));
            }}>
            {t('composer.autoNoticeOk')}
          </button>
        </>
      ) : null}
    </p>
  );
}
