// The composer's model picker: a menu built like the mode menu, with the models and, under them, the reasoning effort
// as one row of pills.
import { useEffect, useRef, useState } from 'react';
import type { ReasoningEffort, ReasoningSupport } from '@src/llm/catalogue';
import type { ModelRef } from '@src/store/types';
import { t } from '@src/ui/i18n';
import { CheckIcon, ChevronIcon } from '@src/ui/icons';

export interface ModelChoice {
  ref: ModelRef;
  /** The model's name and its provider's, as the menu lists it. */
  label: string;
  /** The model's name alone, for the button. */
  name: string;
  /** Whether the model reasons; absent when unknown. */
  capability?: ReasoningSupport;
}

const ALL: ReasoningEffort[] = ['none', 'low', 'medium', 'high'];

/**
 * The effort row for a model: no row for a model with no effort choice, Low to High for one that cannot stop reasoning,
 * all four otherwise. A value the row does not offer shows as Low, which is what is sent.
 */
export function effortRow(
  capability: ReasoningSupport | undefined,
  value: ReasoningEffort,
): { pills: ReasoningEffort[]; shown: ReasoningEffort } | null {
  if (capability === 'none') return null;
  const pills = capability === 'always' ? ALL.slice(1) : ALL;
  return { pills, shown: pills.includes(value) ? value : 'low' };
}

const sameRef = (a: ModelRef | null, b: ModelRef) => !!a && a.providerId === b.providerId && a.model === b.model;
/** A model's value for the checks: the provider id (a UUID, with no colon) and the model name. */
const valueOf = (ref: ModelRef) => `${ref.providerId}:${ref.model}`;

export function ModelMenu({
  models,
  model,
  reasoning,
  running,
  onModel,
  onReasoning,
}: {
  models: ModelChoice[];
  model: ModelRef | null;
  reasoning: ReasoningEffort;
  /** A run is active: a change applies when the next run starts. */
  running: boolean;
  onModel: (model: ModelRef) => void;
  onReasoning: (reasoning: ReasoningEffort) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const chosen = models.find(m => sameRef(model, m.ref));
  const row = chosen ? effortRow(chosen.capability, reasoning) : null;
  // The button names the effort for a model known to reason.
  const showEffort = !!row && (chosen?.capability === 'optional' || chosen?.capability === 'always');
  const label = chosen ? chosen.name : t(models.length ? 'composer.noModel' : 'composer.noModels');

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
    // Not positioned itself: the menu opens over the composer, from its left edge, so it fits a narrow panel. It closes
    // when focus leaves it, so Escape never reaches the panel's Stop while it stays open.
    <div
      ref={root}
      className="flex min-w-0 shrink-[2]"
      onBlur={e => {
        if (open && !root.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}>
      <button
        ref={button}
        type="button"
        disabled={!models.length}
        aria-label={`${t('composer.model')}: ${label}${showEffort && row ? ` · ${t(`reasoning.${row.shown}`)}` : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-label={t('composer.model')}
        data-value={model ? valueOf(model) : ''}
        className="flex min-w-0 items-center gap-1 rounded-full border border-transparent px-2 py-1 text-xs text-nb-muted hover:border-nb-border hover:text-nb-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-nb-accent/40 disabled:hover:border-transparent disabled:hover:text-nb-muted"
        onClick={() => setOpen(o => !o)}>
        <span className="truncate">{label}</span>
        {/* In a narrow panel the effort goes first, then the name is cut. */}
        {showEffort && row ? (
          <span className="shrink-0 whitespace-nowrap max-[340px]:hidden">· {t(`reasoning.${row.shown}`)}</span>
        ) : null}
        <ChevronIcon size={12} className={`shrink-0 transition-transform ${open ? '-rotate-90' : 'rotate-90'}`} />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={t('composer.model')}
          tabIndex={-1}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close();
            } else if (
              e.key === 'Tab' &&
              !e.shiftKey &&
              (e.target as HTMLElement).getAttribute('role') === 'menuitemradio'
            ) {
              // From any model, Tab goes to the effort row's checked pill.
              const pill = e.currentTarget.querySelector<HTMLElement>('[role="radio"][tabindex="0"]');
              if (pill) {
                e.preventDefault();
                pill.focus();
              }
            } else if (
              (e.key === 'ArrowDown' || e.key === 'ArrowUp') &&
              !(e.target as HTMLElement).closest('[role="radiogroup"]')
            ) {
              e.preventDefault();
              const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
              const at = items.indexOf(document.activeElement as HTMLElement);
              items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
            }
          }}
          className="absolute bottom-11 left-2 z-10 flex w-64 max-w-[calc(100%-1rem)] flex-col rounded-xl border border-nb-border bg-nb-bg p-1 text-xs shadow-pop">
          <div className="flex max-h-60 flex-col overflow-y-auto">
            {models.map(m => (
              <button
                key={valueOf(m.ref)}
                type="button"
                role="menuitemradio"
                aria-checked={sameRef(model, m.ref)}
                // One Tab stop for the list, so Tab goes on to the effort row; the arrow keys move within it.
                tabIndex={sameRef(model, m.ref) || (!chosen && m === models[0]) ? 0 : -1}
                data-value={valueOf(m.ref)}
                className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-left hover:bg-nb-surface focus-visible:bg-nb-surface focus-visible:outline-none"
                onClick={() => {
                  close();
                  if (!sameRef(model, m.ref)) onModel(m.ref);
                }}>
                <span className="min-w-0 flex-1 truncate text-nb-fg">{m.label}</span>
                <CheckIcon size={14} className={sameRef(model, m.ref) ? 'text-nb-accent' : 'invisible'} />
              </button>
            ))}
          </div>
          {row ? <EffortRow row={row} value={reasoning} onReasoning={onReasoning} running={running} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** One row of pills, a radio group: the arrow keys move and choose within it. */
function EffortRow({
  row,
  value,
  running,
  onReasoning,
}: {
  row: { pills: ReasoningEffort[]; shown: ReasoningEffort };
  /** The stored effort, which may differ from the pill shown (None on a model that cannot stop shows Low). */
  value: ReasoningEffort;
  running: boolean;
  onReasoning: (reasoning: ReasoningEffort) => void;
}) {
  return (
    <div className="mt-1 flex flex-col gap-1.5 border-t border-nb-border px-3 pb-1.5 pt-2">
      <span id="nb-reasoning-label" className="text-nb-muted">
        {t('composer.reasoning')}
      </span>
      <div role="radiogroup" aria-labelledby="nb-reasoning-label" className="flex flex-wrap gap-1">
        {row.pills.map(p => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={p === row.shown}
            tabIndex={p === row.shown ? 0 : -1}
            data-value={p}
            onKeyDown={e => {
              const step =
                e.key === 'ArrowRight' || e.key === 'ArrowDown'
                  ? 1
                  : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
                    ? -1
                    : 0;
              if (!step) return;
              e.preventDefault();
              e.stopPropagation();
              const group = e.currentTarget.parentElement;
              const next = row.pills[(row.pills.indexOf(row.shown) + step + row.pills.length) % row.pills.length];
              onReasoning(next);
              setTimeout(() => group?.querySelector<HTMLElement>(`[data-value="${next}"]`)?.focus());
            }}
            className={`flex-1 whitespace-nowrap rounded-full border px-2 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-nb-accent/40 ${p === row.shown ? 'border-nb-accent bg-nb-accent/10 font-medium text-nb-fg' : 'border-nb-border text-nb-muted hover:text-nb-fg'}`}
            onClick={() => {
              if (p !== value) onReasoning(p);
            }}>
            {t(`reasoning.${p}`)}
          </button>
        ))}
      </div>
      {running ? <span className="text-nb-muted">{t('composer.reasoningNextRun')}</span> : null}
    </div>
  );
}
