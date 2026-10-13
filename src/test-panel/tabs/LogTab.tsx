// Log tab: the audit log, every request, result and prompt outcome.
import { useCallback, useEffect, useState } from 'react';
import type { AuditEntry } from '@src/browser-control';
import { client, useEvent } from '../rpc';
import { Button, Json } from '../components';

export function LogTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    void client.call<AuditEntry[]>('layer.audit').then(setEntries);
  }, []);

  useEvent(
    'audit',
    useCallback((data: unknown) => setEntries(list => [...list, data as AuditEntry].slice(-500)), []),
  );

  const shown = [...entries].reverse();
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-slate-600">{entries.length} entries, newest first</span>
        <Button kind="secondary" onClick={() => setEntries([])}>
          Clear view
        </Button>
      </div>
      <ul className="space-y-1 font-mono text-xs">
        {shown.map((entry, i) => (
          <li key={`${entry.at}-${i}`} className="rounded border border-slate-200">
            <button
              type="button"
              className="flex w-full gap-2 p-1 text-left"
              onClick={() => setOpen(open === i ? null : i)}>
              <span className="text-slate-500">{entry.at.slice(11, 23)}</span>
              <span className={entry.ok ? 'text-green-700' : 'text-red-700'}>
                {entry.ok ? 'ok' : entry.error?.code}
              </span>
              <span className="font-semibold">{entry.tool}</span>
              {entry.tabId !== undefined && <span className="text-slate-500">tab {entry.tabId}</span>}
              {entry.receipt?.sensitive && (
                <span className="text-amber-700">
                  {entry.receipt.sensitive}
                  {entry.receipt.confirmedByUser ? ' approved' : ''}
                </span>
              )}
              <span className="ml-auto text-slate-500">{entry.ms} ms</span>
            </button>
            {open === i && (
              <div className="border-t border-slate-200 p-1">
                <Json value={entry} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
