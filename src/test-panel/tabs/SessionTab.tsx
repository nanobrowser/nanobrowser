import { useCallback, useEffect, useState } from 'react';
import type { TabSummary } from '@src/background/messages';
import type { LayerState } from '@src/background/layer';
import type { FrameReport } from '@src/background/spike-session';
import { client, useEvent } from '../rpc';
import { Button, ErrorText, Json, Section } from '../components';

export function SessionTab() {
  const [tabs, setTabs] = useState<TabSummary[]>([]);
  const [tabId, setTabId] = useState<number | null>(null);
  const [attached, setAttached] = useState<number[]>([]);
  const [report, setReport] = useState<FrameReport | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [list, attachedTabs] = await Promise.all([
      client.call<TabSummary[]>('tabs.list'),
      client.call<number[]>('session.attached'),
    ]);
    setTabs(list.filter(t => !t.url.startsWith('chrome-extension://')));
    setAttached(attachedTabs);
    setTabId(current => current ?? list.find(t => t.active && t.url.startsWith('http'))?.tabId ?? null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEvent(
    'session.detached',
    useCallback(
      (data: unknown) => {
        const { reason } = data as { tabId: number; reason: string };
        setError(`Debugger detached: ${reason}`);
        setReport(null);
        void refresh();
      },
      [refresh],
    ),
  );

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const isAttached = tabId !== null && attached.includes(tabId);

  return (
    <div>
      <Section
        title="Tab"
        actions={
          <Button kind="secondary" onClick={() => void refresh()}>
            Refresh
          </Button>
        }>
        <select
          className="w-full rounded border border-slate-300 p-1"
          value={tabId ?? ''}
          onChange={e => {
            setTabId(Number(e.target.value));
            setReport(null);
          }}>
          <option value="" disabled>
            Choose a tab
          </option>
          {tabs.map(t => (
            <option key={t.tabId} value={t.tabId}>
              {attached.includes(t.tabId) ? '● ' : ''}
              {t.tabId} · {t.title || t.url}
            </option>
          ))}
        </select>
        <div className="mt-2 flex gap-2">
          <Button
            disabled={busy || tabId === null || isAttached}
            onClick={() => run(async () => setReport(await client.call<FrameReport>('session.attach', { tabId })))}>
            Attach
          </Button>
          <Button
            kind="secondary"
            disabled={busy || !isAttached}
            onClick={() =>
              run(async () => {
                await client.call('session.detach', { tabId });
                setReport(null);
              })
            }>
            Detach
          </Button>
          <Button
            kind="secondary"
            disabled={busy || !isAttached}
            onClick={() => run(async () => setReport(await client.call<FrameReport>('session.frames', { tabId })))}>
            Reload frames
          </Button>
        </div>
        <ErrorText error={error} />
      </Section>
      <PolicyEditor />
      <SafetySettings />
      {report && <FrameTree report={report} />}
      {report && <RawCommand tabId={report.tabId} sessions={[...new Set(report.frames.map(f => f.session))]} />}
    </div>
  );
}

function FrameTree({ report }: { report: FrameReport }) {
  return (
    <Section title={`Frames (${report.frames.length})`}>
      <ul className="space-y-1 font-mono text-xs">
        {report.frames.map(f => (
          <li key={f.frameId} style={{ paddingLeft: f.depth * 12 }} className="rounded bg-slate-50 p-1">
            <div className="truncate font-semibold">{f.url || '(no url)'}</div>
            <div>frame {f.frameId}</div>
            <div>session {f.sessionId ? f.sessionId : 'root'}</div>
            <div>loader {f.loaderId || '(none)'}</div>
            {f.adFrame && <div className="text-amber-700">ad frame</div>}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function RawCommand({ tabId, sessions }: { tabId: number; sessions: string[] }) {
  const [sessionId, setSessionId] = useState(sessions[0] ?? '');
  const [method, setMethod] = useState('Runtime.evaluate');
  const [params, setParams] = useState('{"expression": "location.href", "returnByValue": true}');
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState<string>();

  const send = async () => {
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await client.call('session.raw', { tabId, sessionId, method, params: JSON.parse(params || '{}') }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Section title="Raw command">
      <div className="space-y-1.5">
        <select
          className="w-full rounded border border-slate-300 p-1 font-mono text-xs"
          value={sessionId}
          onChange={e => setSessionId(e.target.value)}>
          {sessions.map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          className="w-full rounded border border-slate-300 p-1 font-mono text-xs"
          value={method}
          onChange={e => setMethod(e.target.value)}
          aria-label="Method"
        />
        <textarea
          className="h-16 w-full rounded border border-slate-300 p-1 font-mono text-xs"
          value={params}
          onChange={e => setParams(e.target.value)}
          aria-label="Parameters"
        />
        <Button onClick={() => void send()}>Send</Button>
      </div>
      <ErrorText error={error} />
      {result !== undefined && <Json value={result} />}
    </Section>
  );
}

function PolicyEditor() {
  const [allow, setAllow] = useState('');
  const [deny, setDeny] = useState('');
  const [saved, setSaved] = useState<string>();

  useEffect(() => {
    void client.call<LayerState>('layer.state').then(state => {
      setAllow(state.urlPolicy.allow.join('\n'));
      setDeny(state.urlPolicy.deny.join('\n'));
    });
  }, []);

  const save = async () => {
    const lines = (text: string) =>
      text
        .split(/\n|,/)
        .map(l => l.trim())
        .filter(Boolean);
    const state = await client.call<LayerState>('layer.setPolicy', { allow: lines(allow), deny: lines(deny) });
    setAllow(state.urlPolicy.allow.join('\n'));
    setDeny(state.urlPolicy.deny.join('\n'));
    setSaved(new Date().toLocaleTimeString());
  };

  const area = 'h-16 w-full rounded border border-slate-300 p-1 font-mono text-xs';
  return (
    <Section title="Navigation policy" actions={<Button onClick={() => void save()}>Save</Button>}>
      <p className="mb-1 text-slate-600">
        Domains or exact URLs, one per line. With an allow list, only listed sites load. The agent cannot change this.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs">
          Allow
          <textarea className={area} value={allow} onChange={e => setAllow(e.target.value)} />
        </label>
        <label className="text-xs">
          Deny
          <textarea className={area} value={deny} onChange={e => setDeny(e.target.value)} />
        </label>
      </div>
      {saved && <p className="text-xs text-green-700">Saved at {saved}</p>}
    </Section>
  );
}

const CAPABILITY_LIST = ['human', 'vision', 'selector', 'eval', 'files', 'devtools', 'batch'] as const;

function SafetySettings() {
  const [state, setState] = useState<LayerState | null>(null);
  useEffect(() => {
    void client.call<LayerState>('layer.state').then(setState);
  }, []);
  if (!state) return null;
  const setPolicy = async (policy: string) =>
    setState(await client.call<LayerState>('layer.setConfirmPolicy', { policy }));
  const toggle = async (capability: string, on: boolean) => {
    const next = on ? [...state.capabilities, capability] : state.capabilities.filter(c => c !== capability);
    setState(await client.call<LayerState>('layer.setCapabilities', { capabilities: next }));
  };
  return (
    <Section title="Confirmation and capabilities">
      <p className="mb-1 text-slate-600">Only you can change these; the agent has no call for them.</p>
      <label className="block text-xs">
        Confirm actions
        <select
          className="ml-2 rounded border border-slate-300 p-1"
          value={state.confirmPolicy}
          onChange={e => void setPolicy(e.target.value)}>
          <option value="sensitive">that submit, pay or delete (default)</option>
          <option value="always">always</option>
          <option value="never">never</option>
        </select>
      </label>
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        {CAPABILITY_LIST.map(c => (
          <label key={c} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={state.capabilities.includes(c)}
              onChange={e => void toggle(c, e.target.checked)}
            />
            {c}
          </label>
        ))}
      </div>
      {!state.promptAvailable && (
        <p className="mt-1 text-red-700">No prompt is registered: sensitive actions fail with NEEDS_USER.</p>
      )}
    </Section>
  );
}
