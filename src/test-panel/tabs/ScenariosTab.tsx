import { useCallback, useEffect, useState } from 'react';
import type { FixtureSet, ScenarioResult } from '@src/background/scenarios/registry';
import { client, useEvent } from '../rpc';
import { Button, Section } from '../components';

interface ScenarioSummary {
  id: string;
  set: FixtureSet;
  title: string;
  covers: string;
}

export function ScenariosTab() {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [results, setResults] = useState<Record<string, ScenarioResult>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void client.call<ScenarioSummary[]>('scenarios.list').then(setScenarios);
  }, []);

  useEvent(
    'scenario.started',
    useCallback((data: unknown) => setRunning((data as { id: string }).id), []),
  );
  useEvent(
    'scenario.finished',
    useCallback((data: unknown) => {
      const result = data as ScenarioResult;
      setResults(r => ({ ...r, [result.id]: result }));
      setRunning(current => (current === result.id ? null : current));
    }, []),
  );

  const runOne = async (id: string) => {
    setBusy(true);
    setRunning(id);
    try {
      const result = await client.call<ScenarioResult>('scenarios.run', { id });
      setResults(r => ({ ...r, [id]: result }));
    } finally {
      setBusy(false);
      setRunning(null);
    }
  };

  const runAll = async (sets?: FixtureSet[]) => {
    setBusy(true);
    setResults(r => Object.fromEntries(Object.entries(r).filter(([, v]) => sets && !sets.includes(v.set))));
    try {
      await client.call('scenarios.runAll', { sets });
    } finally {
      setBusy(false);
      setRunning(null);
    }
  };

  const sets = [...new Set(scenarios.map(s => s.set))];
  const done = Object.values(results);
  const passed = done.filter(r => r.pass).length;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Button disabled={busy} onClick={() => void runAll()}>
          Run all
        </Button>
        <span className="text-slate-600">
          {done.length ? `${passed} of ${done.length} passed` : `${scenarios.length} scenarios`}
          {running ? ` · running ${running}` : ''}
        </span>
      </div>
      {sets.map(set => (
        <Section
          key={set}
          title={`Fixture set ${set}`}
          actions={
            <Button kind="secondary" disabled={busy} onClick={() => void runAll([set])}>
              Run set {set}
            </Button>
          }>
          <ul className="space-y-1.5">
            {scenarios
              .filter(s => s.set === set)
              .map(s => {
                const r = results[s.id];
                const badge = !r
                  ? 'bg-slate-200 text-slate-700'
                  : r.pass
                    ? 'bg-green-100 text-green-800'
                    : 'bg-red-100 text-red-800';
                return (
                  <li key={s.id} className="rounded border border-slate-200 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className={`mr-2 rounded px-1.5 py-0.5 text-xs font-medium ${badge}`}>
                          {running === s.id ? 'running' : !r ? 'not run' : r.pass ? 'pass' : 'fail'}
                        </span>
                        <span className="font-medium">{s.title}</span>
                        <div className="text-xs text-slate-500">
                          {s.id} · {s.covers}
                        </div>
                      </div>
                      <Button kind="secondary" disabled={busy} onClick={() => void runOne(s.id)}>
                        Run
                      </Button>
                    </div>
                    {r && (
                      <dl className="mt-1 grid grid-cols-[5rem_1fr] gap-x-2 text-xs">
                        <dt className="text-slate-500">expected</dt>
                        <dd>{r.expected}</dd>
                        <dt className="text-slate-500">actual</dt>
                        <dd className={r.pass ? '' : 'text-red-700'}>{r.actual}</dd>
                        <dt className="text-slate-500">time</dt>
                        <dd>{r.ms} ms</dd>
                      </dl>
                    )}
                  </li>
                );
              })}
          </ul>
        </Section>
      ))}
    </div>
  );
}
