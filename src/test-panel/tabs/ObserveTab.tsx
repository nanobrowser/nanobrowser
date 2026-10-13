import { useEffect, useState } from 'react';
import type { Result, ScreenshotData, SnapshotData } from '@src/browser-control';
import type { LayerState } from '@src/background/layer';
import { client } from '../rpc';
import { Button, ErrorText, Section } from '../components';

type Tool = 'snapshot' | 'find' | 'read' | 'screenshot';

const input = 'w-full rounded border border-slate-300 p-1 font-mono text-xs';

export function ObserveTab() {
  const [state, setState] = useState<LayerState | null>(null);
  const [tool, setTool] = useState<Tool>('snapshot');
  const [mode, setMode] = useState<'all' | 'interactive'>('all');
  const [query, setQuery] = useState({ role: '', name: '', text: '' });
  const [ref, setRef] = useState('');
  const [format, setFormat] = useState<'markdown' | 'text'>('markdown');
  const [shot, setShot] = useState({ fullPage: false, labels: false });
  const [result, setResult] = useState<{ result: Result; ms: number } | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void client.call<LayerState>('layer.state').then(setState);
  }, []);

  const args = (): Record<string, unknown> => {
    const opt = (v: string) => (v.trim() ? v.trim() : undefined);
    switch (tool) {
      case 'snapshot':
        return { mode, scope: opt(ref) };
      case 'find':
        return { role: opt(query.role), name: opt(query.name), text: opt(query.text) };
      case 'read':
        return { format, ref: opt(ref) };
      case 'screenshot':
        return { ref: opt(ref), fullPage: shot.fullPage || undefined, labels: shot.labels || undefined };
    }
  };

  const run = async () => {
    setBusy(true);
    setError(undefined);
    const start = performance.now();
    try {
      const r = await client.call<Result>('layer.call', { tool, args: args() });
      setResult({ result: r, ms: Math.round(performance.now() - start) });
      setState(await client.call<LayerState>('layer.state'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const r = result?.result;
  const image = tool === 'screenshot' && r?.ok ? (r.data as ScreenshotData) : null;
  const snap = tool === 'snapshot' && r?.ok ? (r.data as SnapshotData) : null;

  return (
    <div>
      <p className="mb-2 text-slate-600">
        Active tab: {state?.activeTabId ?? 'none (share one in the Session tab)'} · epoch {state?.epoch.prefix}
        {state && !state.epoch.persisted ? ' (not persisted)' : ''}
      </p>
      <div className="mb-2 flex gap-1">
        {(['snapshot', 'find', 'read', 'screenshot'] as const).map(t => (
          <Button key={t} kind={t === tool ? 'primary' : 'secondary'} onClick={() => setTool(t)}>
            {t}
          </Button>
        ))}
      </div>
      <Section title="Arguments">
        <div className="space-y-1.5">
          {tool === 'snapshot' && (
            <select className={input} value={mode} onChange={e => setMode(e.target.value as 'all' | 'interactive')}>
              <option value="all">mode: all</option>
              <option value="interactive">mode: interactive</option>
            </select>
          )}
          {tool === 'find' &&
            (['role', 'name', 'text'] as const).map(k => (
              <input
                key={k}
                className={input}
                placeholder={k}
                aria-label={k}
                value={query[k]}
                onChange={e => setQuery(q => ({ ...q, [k]: e.target.value }))}
              />
            ))}
          {tool === 'read' && (
            <select className={input} value={format} onChange={e => setFormat(e.target.value as 'markdown' | 'text')}>
              <option value="markdown">format: markdown</option>
              <option value="text">format: text</option>
            </select>
          )}
          {tool !== 'find' && (
            <input
              className={input}
              placeholder={tool === 'snapshot' ? 'scope (a ref, optional)' : 'ref (optional)'}
              aria-label="ref"
              value={ref}
              onChange={e => setRef(e.target.value)}
            />
          )}
          {tool === 'screenshot' && (
            <div className="flex gap-3">
              {(['fullPage', 'labels'] as const).map(k => (
                <label key={k} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={shot[k]}
                    onChange={e => setShot(s => ({ ...s, [k]: e.target.checked }))}
                  />
                  {k}
                </label>
              ))}
            </div>
          )}
          <Button disabled={busy} onClick={() => void run()}>
            {busy ? 'Running…' : `Run ${tool}`}
          </Button>
        </div>
        <ErrorText error={error} />
      </Section>
      {r && (
        <Section title={r.ok ? 'Result' : `Error ${r.error?.code}`}>
          <p className="mb-1 text-xs text-slate-600">
            {result!.ms} ms round trip
            {snap
              ? ` · capture ${snap.captureMs} ms · ${snap.refs} refs · ${r.page?.snapshot?.length ?? 0} characters`
              : ''}
            {` · text ${r.text.length} characters`}
          </p>
          {image && (
            <img
              className="mb-2 max-w-full border border-slate-200"
              alt="Screenshot"
              src={`data:${image.mimeType};base64,${image.base64}`}
            />
          )}
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">{r.text}</pre>
        </Section>
      )}
    </div>
  );
}
