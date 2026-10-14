// Settings → Shortcuts: add, edit, pin and delete saved shortcuts.
import * as Dialog from '@radix-ui/react-dialog';
import { useMemo, useState } from 'react';
import { deleteShortcut, setPinned } from '@src/store/shortcuts';
import { providersStorage } from '@src/store/settings';
import type { ProviderConfig } from '@src/store/settings';
import { Button } from '@src/ui/components';
import { useStorage } from '@src/ui/hooks';
import { t } from '@src/ui/i18n';
import { CloseIcon, PencilIcon, StarIcon, TrashIcon } from '@src/ui/icons';
import { ShortcutEditor, useShortcuts } from '@src/ui/shortcuts';
import type { ModelOption, ShortcutDraft } from '@src/ui/shortcuts';
import { SettingsCard } from './SettingsCard';

const NO_PROVIDERS: ProviderConfig[] = [];
const EMPTY: ShortcutDraft = { name: '', description: '', text: '' };
const ICON_BUTTON =
  'rounded-md p-1.5 text-nb-muted hover:bg-nb-surface hover:text-nb-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-nb-accent';

export function ShortcutsSection() {
  const shortcuts = useShortcuts();
  const providers = useStorage(providersStorage, NO_PROVIDERS);
  const models: ModelOption[] = useMemo(
    () =>
      providers.flatMap(p =>
        p.models
          .filter(m => !m.noToolCalling)
          .map(m => ({ ref: { providerId: p.id, model: m.name }, label: `${m.name} · ${p.name}` })),
      ),
    [providers],
  );
  const [editing, setEditing] = useState<ShortcutDraft | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <h2 className="sr-only">{t('settings.nav.shortcuts')}</h2>
      <SettingsCard
        title={t('settings.nav.shortcuts')}
        description={t('shortcuts.hint')}
        className="flex flex-col gap-6 pt-2">
        <Button className="self-start" variant="primary" onClick={() => setEditing(EMPTY)}>
          {t('shortcut.new')}
        </Button>
        {shortcuts.length ? (
          <ul className="divide-y divide-nb-border border-t border-nb-border" aria-label={t('settings.nav.shortcuts')}>
            {shortcuts.map(s => (
              <li key={s.id} className="flex flex-col gap-1 py-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-pressed={!!s.pinned}
                    aria-label={`${s.pinned ? t('shortcut.unpin') : t('shortcut.pin')} /${s.name}`}
                    title={s.pinned ? t('shortcut.unpin') : t('shortcut.pin')}
                    className={`-ml-1 flex size-7 items-center justify-center rounded-lg hover:bg-nb-surface ${s.pinned ? 'text-amber-500' : 'text-nb-muted hover:text-nb-fg'}`}
                    onClick={() => void setPinned(s.id, !s.pinned)}>
                    <StarIcon filled={!!s.pinned} size={16} />
                  </button>
                  <span className="font-mono text-sm font-medium">/{s.name}</span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    className={ICON_BUTTON}
                    aria-label={`${t('shortcut.edit')} /${s.name}`}
                    title={t('shortcut.edit')}
                    onClick={() => setEditing(s)}>
                    <PencilIcon size={16} />
                  </button>
                  {deleting === s.id ? (
                    <>
                      <span className="text-xs">{t('shortcut.confirmDelete')}</span>
                      <Button variant="danger" onClick={() => void deleteShortcut(s.id).then(() => setDeleting(null))}>
                        {t('shortcut.delete')}
                      </Button>
                      <Button variant="ghost" onClick={() => setDeleting(null)}>
                        {t('common.cancel')}
                      </Button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={ICON_BUTTON}
                      aria-label={`${t('shortcut.delete')} /${s.name}`}
                      title={t('shortcut.delete')}
                      onClick={() => setDeleting(s.id)}>
                      <TrashIcon size={16} />
                    </button>
                  )}
                </div>
                {s.description ? <p className="text-xs text-nb-muted">{s.description}</p> : null}
                <p className="line-clamp-2 whitespace-pre-wrap text-sm">{s.text}</p>
                {s.startUrl ? <p className="truncate text-xs text-nb-muted">{s.startUrl}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </SettingsCard>
      <Dialog.Root open={editing !== null} onOpenChange={open => !open && setEditing(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed left-1/2 top-1/2 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-xl border border-nb-border bg-nb-bg p-5 shadow-pop focus:outline-none sm:p-6">
            <div className="flex items-center gap-2">
              <Dialog.Title className="flex-1 text-xl font-semibold">
                {editing?.id ? t('shortcut.editTitle', { name: editing.name }) : t('shortcut.new')}
              </Dialog.Title>
              <Dialog.Close
                className="flex size-8 items-center justify-center rounded-lg text-nb-muted hover:bg-nb-surface hover:text-nb-fg"
                aria-label={t('common.close')}>
                <CloseIcon size={18} />
              </Dialog.Close>
            </div>
            {editing ? <ShortcutEditor initial={editing} models={models} onDone={() => setEditing(null)} /> : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
