import { useEffect, useState } from 'react';
import type { CheckReport, CheckSummary } from '@src/background/messages';
import { client } from '../rpc';
import { Button, ErrorText, Json, Section } from '../components';

export function ChecksTab() {
  const [checks, setChecks] = useState<CheckSummary[]>([]);
  const [reports, setReports] = useState<Record<string, CheckReport>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [args, setArgs] = useState<Record<string, string>>({});

  useEffect(() => {
    void client.call<CheckSummary[]>('checks.list').then(setChecks);
  }, []);

  const run = async (name: string) => {
    setRunning(name);
    try {
      let parsed: Record<string, unknown> = {};
      if (args[name]?.trim()) parsed = JSON.parse(args[name]);
      const report = await client.call<CheckReport>('checks.run', { name, args: parsed });
      setReports(r => ({ ...r, [name]: report }));
    } catch (e) {
      setReports(r => ({
        ...r,
        [name]: { name, ok: false, startedAt: new Date().toISOString(), durationMs: 0, error: String(e) },
      }));
    } finally {
      setRunning(null);
    }
  };

  return (
    <div>
      {checks.map(check => {
        const report = reports[check.name];
        return (
          <Section
            key={check.name}
            title={check.title}
            actions={
              <Button disabled={running !== null} onClick={() => void run(check.name)}>
                {running === check.name ? 'Running…' : 'Run'}
              </Button>
            }>
            <p className="mb-1 text-slate-600">{check.description}</p>
            <input
              className="w-full rounded border border-slate-300 p-1 font-mono text-xs"
              placeholder="Arguments as JSON (optional)"
              value={args[check.name] ?? ''}
              onChange={e => setArgs(a => ({ ...a, [check.name]: e.target.value }))}
              aria-label={`Arguments for ${check.title}`}
            />
            {report && (
              <div className="mt-2">
                <p className={report.ok ? 'text-green-700' : 'text-red-700'}>
                  {report.ok ? 'Finished' : 'Failed'} in {report.durationMs} ms
                </p>
                <ErrorText error={report.error} />
                {report.result !== undefined && <Json value={report.result} />}
              </div>
            )}
          </Section>
        );
      })}
    </div>
  );
}
