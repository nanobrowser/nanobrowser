// Small shared components for the panel and the settings page. Page and model strings are only ever rendered as
// text nodes here, never as HTML.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const variants: Record<Variant, string> = {
  primary:
    'bg-nb-accent font-medium text-white shadow-sm hover:bg-nb-accent-strong disabled:opacity-50 disabled:hover:bg-nb-accent',
  secondary:
    'border border-nb-border bg-nb-bg shadow-sm hover:border-nb-accent/40 hover:bg-nb-surface disabled:opacity-50',
  ghost: 'hover:bg-nb-surface disabled:opacity-50',
  danger:
    'border border-red-300 bg-nb-bg text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950',
};

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`rounded-lg px-3.5 py-1.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nb-accent ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    // eslint-disable-next-line jsx-a11y/label-has-associated-control
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-nb-muted">{label}</span>
      {children}
      {hint ? <span className="text-xs text-nb-muted">{hint}</span> : null}
    </label>
  );
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`min-w-0 max-w-full rounded-lg border border-nb-border bg-nb-bg px-2.5 py-1.5 text-sm transition-colors focus:border-nb-accent focus:outline-none focus:ring-2 focus:ring-nb-accent/25 ${className}`}
      {...props}
    />
  );
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`max-w-full rounded-lg border border-nb-border bg-nb-bg px-2.5 py-1.5 text-sm transition-colors focus:border-nb-accent focus:outline-none focus:ring-2 focus:ring-nb-accent/25 ${className}`}
      {...props}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-nb-border bg-nb-bg p-4 shadow-soft ${className}`}>{children}</div>;
}

/** A boxed note, in the size and shape of the Auto notice in Settings: 14 px text and 12 px corners. */
export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  const tones = {
    info: 'border-nb-accent/20 bg-nb-surface',
    warn: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100',
    error: 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100',
    ok: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100',
  };
  return <div className={`rounded-xl border px-3 py-2 text-sm leading-relaxed ${tones[tone]}`}>{children}</div>;
}

/** An on/off switch. It carries its own `aria-label`, as the settings rows expect. */
export function Switch({
  checked,
  onChange,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nb-accent ${checked ? 'bg-nb-accent' : 'bg-nb-border'}`}
      {...props}>
      <span
        className={`inline-block size-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`}
      />
    </button>
  );
}
