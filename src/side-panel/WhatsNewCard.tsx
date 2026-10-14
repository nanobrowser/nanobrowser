// The What's new card above the composer, once after an update to a release that has an entry: its highlights, then,
// after an update from v0.2, a row for each thing the update could not do for the user, with its own button. Got it
// closes it for good. While it shows, the quick start is hidden.
import type { ReactNode } from 'react';
import { oldChatsStorage, upgradeStorage } from '@src/store/legacy';
import type { OldChat } from '@src/store/legacy';
import { whatsNewStorage } from '@src/store/whats-new';
import { useStorage } from '@src/ui/hooks';
import { t } from '@src/ui/i18n';
import { allGranted, requestOptionalPermissions, useGrantedPermissions } from '@src/ui/optional-permissions';
import { WHATS_NEW, releaseOf } from '@src/ui/whats-new';

const NO_CHATS: OldChat[] = [];

/** The release whose card shows now, or null. */
export function useWhatsNew(): string | null {
  const state = useStorage(whatsNewStorage, null);
  const release = releaseOf(chrome.runtime.getManifest().version);
  return state && !state.dismissed && state.version === release && WHATS_NEW[release] ? release : null;
}

function openSettings(section: string): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL(`/options.html#${section}`) });
}

const smallButton =
  'shrink-0 rounded-lg border border-nb-border bg-nb-bg px-2.5 py-1 text-xs font-medium text-nb-fg shadow-sm transition-colors hover:bg-nb-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nb-accent';

function Row({ children, action, run }: { children: ReactNode; action: string; run: () => void }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="min-w-0">{children}</span>
      <button type="button" className={smallButton} onClick={run}>
        {action}
      </button>
    </li>
  );
}

export function WhatsNewCard({ release }: { release: string }) {
  const record = useStorage(upgradeStorage, null);
  const chats = useStorage(oldChatsStorage, NO_CHATS);
  const granted = useGrantedPermissions();
  const rows: ReactNode[] = [];
  if (record) {
    if (chats.length > 0) {
      rows.push(
        <Row key="chats" action={t('whatsNew.export')} run={() => openSettings('data')}>
          {t('whatsNew.legacy')}
        </Row>,
      );
    }
    if (granted && !allGranted(granted)) {
      rows.push(
        // The request comes first in the click: Chrome takes it only while the click lasts.
        <Row key="permissions" action={t('perm.features.allow')} run={() => void requestOptionalPermissions()}>
          {t('perm.features.title')}
        </Row>,
      );
    }
  }
  const close = () => {
    void whatsNewStorage.set(s => (s ? { ...s, dismissed: true } : s));
    void upgradeStorage.set(r => (r ? { ...r, dismissed: true } : r));
  };
  return (
    <section
      aria-label={t('whatsNew.title', { version: release })}
      className="flex flex-col gap-2.5 rounded-2xl border border-nb-border bg-nb-bg p-3.5 text-sm shadow-soft">
      <h2 className="font-semibold text-nb-fg">{t('whatsNew.title', { version: release })}</h2>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 leading-relaxed text-nb-fg marker:text-nb-muted">
        {WHATS_NEW[release].map(key => (
          <li key={key}>
            {t(key)}
            {key === 'whatsNew.v03.shortcuts' && record && record.favorites > 0 ? ` ${t('whatsNew.v03.moved')}` : ''}
          </li>
        ))}
      </ul>
      {rows.length ? (
        <div className="flex flex-col gap-2 border-t border-nb-border pt-2.5">
          <h3 className="text-xs font-medium text-nb-muted">{t('whatsNew.fromOld')}</h3>
          <ul className="flex flex-col gap-2 text-nb-fg">{rows}</ul>
        </div>
      ) : null}
      <div className="flex justify-end pt-0.5">
        <button
          type="button"
          className="rounded-lg bg-nb-accent px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-nb-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nb-accent"
          onClick={close}>
          {t('whatsNew.gotIt')}
        </button>
      </div>
    </section>
  );
}
