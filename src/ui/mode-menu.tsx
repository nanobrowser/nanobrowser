// The Ask/Auto mode menu, shared by the composer and Settings → General.
import { useEffect, useRef, useState } from 'react';
import type { PermissionMode } from '@src/store/types';
import { t } from './i18n';
import { CheckIcon, ChevronIcon } from './icons';

const MODES: Array<{
  mode: PermissionMode;
  name: 'composer.modeAskShort' | 'composer.modeAutoShort';
  description: 'composer.modeAsk' | 'composer.modeAuto';
}> = [
  { mode: 'ask', name: 'composer.modeAskShort', description: 'composer.modeAsk' },
  { mode: 'auto', name: 'composer.modeAutoShort', description: 'composer.modeAuto' },
];

/**
 * The mode selector: the button shows the mode's short name, never cut (the model picker shrinks instead), and its menu
 * describes each mode. Auto is in the auto colour. The composer opens the menu upwards; Settings → General uses it for
 * the default mode, larger and opening downwards.
 */
export function ModeMenu({
  mode,
  onMode,
  label = t('composer.mode'),
  title,
  size = 'small',
  'aria-describedby': describedBy,
}: {
  mode: PermissionMode;
  onMode: (mode: PermissionMode) => void;
  /** The control's name, also its `data-label` for the checks. */
  label?: string;
  title?: string;
  /** 'small' in the composer, opening upwards; 'large' on the settings page, opening downwards. */
  size?: 'small' | 'large';
  'aria-describedby'?: string;
}) {
  const large = size === 'large';
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const current = MODES.find(m => m.mode === mode) ?? MODES[0];
  const shown = `${t(current.name)} (${t(current.description)})`;

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')?.focus();
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div ref={root} className="relative shrink-0">
      <button
        ref={button}
        type="button"
        aria-label={
          // The visible name first, so a user who says "Auto" finds the button (WCAG 2.5.3), then what it means.
          large ? `${label}: ${shown}` : t('composer.modeCurrent', { mode: shown })
        }
        aria-describedby={describedBy}
        aria-haspopup="menu"
        aria-expanded={open}
        data-label={label}
        data-value={mode}
        title={title}
        className={`flex items-center gap-1 whitespace-nowrap rounded-full border font-medium ${large ? 'py-1.5 pl-3.5 pr-2.5 text-sm' : 'py-1 pl-2.5 pr-1.5 text-xs'} focus:outline-none focus-visible:ring-2 focus-visible:ring-nb-accent/40 ${mode === 'auto' ? 'border-nb-auto/60 bg-nb-auto/10 text-nb-auto' : 'border-nb-border bg-nb-bg text-nb-fg'}`}
        onClick={() => setOpen(o => !o)}>
        {t(current.name)}
        <ChevronIcon size={large ? 14 : 12} className={`transition-transform ${open ? '-rotate-90' : 'rotate-90'}`} />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close();
            } else if (e.key === 'Tab') {
              setOpen(false);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
              const at = items.indexOf(document.activeElement as HTMLElement);
              items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
            }
          }}
          className={`absolute z-10 flex flex-col rounded-xl border border-nb-border bg-nb-bg p-1 shadow-pop ${large ? 'left-0 top-full mt-1 w-64 text-sm sm:left-auto sm:right-0' : 'bottom-9 left-0 w-56 text-xs'}`}>
          {MODES.map(m => (
            <button
              key={m.mode}
              type="button"
              role="menuitemradio"
              aria-checked={m.mode === mode}
              data-value={m.mode}
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-left hover:bg-nb-surface focus-visible:bg-nb-surface focus-visible:outline-none"
              onClick={() => {
                close();
                if (m.mode !== mode) onMode(m.mode);
              }}>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={`font-medium ${m.mode === 'auto' ? 'text-nb-auto' : 'text-nb-fg'}`}>{t(m.name)}</span>
                <span className="text-nb-muted">{t(m.description)}</span>
              </span>
              <CheckIcon size={large ? 16 : 14} className={m.mode === mode ? 'text-nb-accent' : 'invisible'} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
