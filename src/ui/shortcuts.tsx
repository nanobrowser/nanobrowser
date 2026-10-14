// Shortcuts in the panel and the settings page: the live list both use, and the editor of Settings → Shortcuts. Only
// the user writes a shortcut, through this editor; no tool reaches the store.
import { useEffect, useState } from 'react';
import { checkShortcut, listShortcuts, onShortcutsChanged, saveShortcut } from '@src/store/shortcuts';
import type { SavedShortcut, Shortcut } from '@src/store/shortcuts';
import type { ModelRef, PermissionMode } from '@src/store/types';
import { Button, Field, Input, Select } from './components';
import { t } from './i18n';

/** The user's shortcuts, pinned first, kept current across the extension's pages. */
export function useShortcuts(): SavedShortcut[] {
  const [list, setList] = useState<SavedShortcut[]>([]);
  useEffect(() => {
    let live = true;
    const load = () =>
      void listShortcuts()
        .then(next => live && setList(next))
        .catch(() => undefined);
    load();
    const off = onShortcutsChanged(load);
    return () => {
      live = false;
      off();
    };
  }, []);
  return list;
}

export interface ModelOption {
  ref: ModelRef;
  label: string;
}

export type ShortcutDraft = Shortcut & { id?: string; pinned?: boolean };

const key = (ref: ModelRef) => `${ref.providerId}\u0000${ref.model}`;

export function ShortcutEditor({
  initial,
  models,
  onDone,
}: {
  initial: ShortcutDraft;
  models: ModelOption[];
  onDone: (saved: string | null) => void;
}) {
  const [draft, setDraft] = useState<ShortcutDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<ShortcutDraft>) => setDraft(d => ({ ...d, ...patch }));
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={e => {
        e.preventDefault();
        void (async () => {
          const shortcut: ShortcutDraft = {
            ...draft,
            name: draft.name.trim(),
            description: draft.description.trim(),
            startUrl: draft.startUrl?.trim() || undefined,
          };
          const others = (await listShortcuts()).filter(s => s.id !== draft.id);
          const problem = checkShortcut(shortcut, others);
          if (problem) return setError(t(problem));
          await saveShortcut(shortcut);
          onDone(shortcut.name);
        })();
      }}>
      <Field label={t('shortcut.name')} hint={t('shortcut.nameHint', { name: draft.name || 'name' })}>
        {/* The "/" is drawn before the field and is not part of the name, so a typed or pasted one is dropped. */}
        <div className="flex items-center rounded-lg border border-nb-border bg-nb-bg focus-within:border-nb-accent focus-within:ring-2 focus-within:ring-nb-accent/25">
          <span aria-hidden className="select-none pl-2.5 font-mono text-sm text-nb-muted">
            /
          </span>
          <input
            aria-label={t('shortcut.name')}
            value={draft.name}
            maxLength={64}
            className="min-w-0 flex-1 rounded-lg bg-transparent py-1.5 pl-0.5 pr-2.5 font-mono text-sm focus:outline-none"
            onChange={e => set({ name: e.target.value.toLowerCase().replace(/\//g, '').replace(/\s+/g, '-') })}
          />
        </div>
      </Field>
      <Field label={t('shortcut.description')}>
        <Input
          aria-label={t('shortcut.description')}
          value={draft.description}
          maxLength={1024}
          onChange={e => set({ description: e.target.value })}
        />
      </Field>
      <Field label={t('shortcut.text')} hint={t('shortcut.textHint')}>
        <textarea
          aria-label={t('shortcut.text')}
          value={draft.text}
          rows={5}
          className="rounded-lg border border-nb-border bg-nb-bg px-2.5 py-1.5 text-sm focus:border-nb-accent focus:outline-none focus:ring-2 focus:ring-nb-accent/25"
          onChange={e => set({ text: e.target.value })}
        />
      </Field>
      <Field label={t('shortcut.startUrl')}>
        <Input
          aria-label={t('shortcut.startUrl')}
          type="url"
          placeholder="https://"
          value={draft.startUrl ?? ''}
          onChange={e => set({ startUrl: e.target.value })}
        />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Field label={t('shortcut.mode')}>
          <Select
            aria-label={t('shortcut.mode')}
            value={draft.mode ?? ''}
            onChange={e => set({ mode: (e.target.value || undefined) as PermissionMode | undefined })}>
            <option value="">{t('shortcut.keep')}</option>
            <option value="ask">{t('composer.modeAsk')}</option>
            <option value="auto">{t('composer.modeAuto')}</option>
          </Select>
        </Field>
        <Field label={t('shortcut.model')}>
          <Select
            aria-label={t('shortcut.model')}
            value={draft.model ? key(draft.model) : ''}
            onChange={e => set({ model: models.find(m => key(m.ref) === e.target.value)?.ref })}>
            <option value="">{t('shortcut.keep')}</option>
            {draft.model && !models.some(m => key(m.ref) === key(draft.model!)) ? (
              <option value={key(draft.model)}>{draft.model.model}</option>
            ) : null}
            {models.map(m => (
              <option key={key(m.ref)} value={key(m.ref)}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button onClick={() => onDone(null)}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary">
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}
