import type { ReactNode } from 'react';

export function Button({
  children,
  onClick,
  disabled,
  kind = 'primary',
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  kind?: 'primary' | 'secondary';
}) {
  const style =
    kind === 'primary' ? 'bg-slate-800 text-white hover:bg-slate-700' : 'border border-slate-300 hover:bg-slate-100';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-2.5 py-1 disabled:opacity-40 ${style}`}>
      {children}
    </button>
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="mb-4">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function ErrorText({ error }: { error?: string }) {
  if (!error) return null;
  return <pre className="mt-2 whitespace-pre-wrap rounded bg-red-50 p-2 text-xs text-red-700">{error}</pre>;
}

export function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2 text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
