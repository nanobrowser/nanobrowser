// A notice card: something the user has to fix before a feature works, such as no model or a blocked microphone. It is
// set apart from the agent's cards (Cards.tsx): neutral colours, a thin border and no Approve, so it never reads as the
// agent waiting for an answer.
import type { ReactNode } from 'react';
import { t } from '@src/ui/i18n';
import { CloseIcon } from '@src/ui/icons';

export function NoticeCard({
  title,
  children,
  action,
  onClose,
  alert,
}: {
  title: string;
  children: ReactNode;
  /** One button that fixes it, such as opening Settings. */
  action?: { label: string; run: () => void };
  /** A close button at the top right; without it the card stays until the cause is gone. */
  onClose?: () => void;
  /** Read out at once, for a notice that follows something the user just did. */
  alert?: boolean;
}) {
  return (
    <section
      role={alert ? 'alert' : undefined}
      aria-label={title}
      className="flex flex-col gap-1.5 rounded-2xl border border-nb-border bg-nb-bg p-3.5 text-sm shadow-soft">
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 font-semibold text-nb-fg">{title}</h2>
        {onClose ? (
          <button
            type="button"
            aria-label={t('common.close')}
            className="-m-1 rounded p-1 text-nb-muted hover:bg-nb-surface hover:text-nb-fg"
            onClick={onClose}>
            <CloseIcon size={12} />
          </button>
        ) : null}
      </div>
      <p className="leading-relaxed text-nb-muted">{children}</p>
      {action ? (
        <div className="pt-1">
          <button
            type="button"
            className="rounded-lg bg-nb-accent px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-nb-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nb-accent"
            onClick={action.run}>
            {action.label}
          </button>
        </div>
      ) : null}
    </section>
  );
}
