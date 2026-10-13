// Act tab: choose a tool from the catalogue, fill a form generated from its JSON schema, send it, and see the whole
// result. Every tool added later appears here without UI work.
import { useEffect, useMemo, useState } from 'react';
import type { Result } from '@src/browser-control';
import { client } from '../rpc';
import { Button, ErrorText, Json, Section } from '../components';

interface JsonSchema {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  anyOf?: JsonSchema[];
  items?: JsonSchema;
  default?: unknown;
  minimum?: number;
  maximum?: number;
}

interface ToolInfo {
  name: string;
  description: string;
  capability: string;
  readOnly: boolean | 'depends';
  schema: JsonSchema;
}

type FieldKind = 'string' | 'number' | 'boolean' | 'enum' | 'json';

function kindOf(schema: JsonSchema): FieldKind {
  if (schema.enum) return 'enum';
  if (schema.type === 'string') return 'string';
  if (schema.type === 'number' || schema.type === 'integer') return 'number';
  if (schema.type === 'boolean') return 'boolean';
  return 'json';
}

/** Turns the form's text values into arguments; empty fields are left out. */
function buildArgs(schema: JsonSchema, values: Record<string, string>): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const raw = values[key];
    if (raw === undefined || raw === '') continue;
    switch (kindOf(prop)) {
      case 'number':
        args[key] = Number(raw);
        break;
      case 'boolean':
        args[key] = raw === 'true';
        break;
      case 'json':
        args[key] = JSON.parse(raw);
        break;
      default:
        args[key] = raw;
    }
  }
  return args;
}

const input = 'w-full rounded border border-slate-300 p-1 font-mono text-xs';

export function ActTab() {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [name, setName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [raw, setRaw] = useState<string | null>(null);
  const [result, setResult] = useState<{ result: Result; ms: number } | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void client.call<ToolInfo[]>('layer.tools').then(list => {
      setTools(list);
      setName(n => n || list[0]?.name || '');
    });
  }, []);

  const tool = useMemo(() => tools.find(t => t.name === name), [tools, name]);

  const send = async () => {
    if (!tool) return;
    setBusy(true);
    setError(undefined);
    const start = performance.now();
    try {
      const args = raw !== null ? JSON.parse(raw || '{}') : buildArgs(tool.schema, values);
      const r = await client.call<Result>('layer.call', { tool: tool.name, args });
      setResult({ result: r, ms: Math.round(performance.now() - start) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const r = result?.result;
  return (
    <div>
      <Section title="Tool">
        <select
          className={input}
          value={name}
          onChange={e => {
            setName(e.target.value);
            setValues({});
            setRaw(null);
          }}>
          {tools.map(t => (
            <option key={t.name} value={t.name}>
              {t.name} {t.readOnly === true ? '(read-only)' : ''} {t.capability !== 'core' ? `[${t.capability}]` : ''}
            </option>
          ))}
        </select>
        {tool && <p className="mt-1 text-slate-600">{tool.description}</p>}
      </Section>
      {tool && (
        <Section
          title="Arguments"
          actions={
            <Button
              kind="secondary"
              onClick={() => setRaw(raw === null ? JSON.stringify(buildArgs(tool.schema, values), null, 2) : null)}>
              {raw === null ? 'Edit as JSON' : 'Use form'}
            </Button>
          }>
          {raw !== null ? (
            <textarea
              className={`${input} h-40`}
              value={raw}
              onChange={e => setRaw(e.target.value)}
              aria-label="Arguments as JSON"
            />
          ) : (
            <div className="space-y-1.5">
              {Object.entries(tool.schema.properties ?? {}).map(([key, prop]) => {
                const kind = kindOf(prop);
                const required = tool.schema.required?.includes(key);
                const set = (v: string) => setValues(vs => ({ ...vs, [key]: v }));
                return (
                  <label key={key} className="block text-xs">
                    <span className="font-mono font-semibold">
                      {key}
                      {required ? ' *' : ''}
                    </span>
                    {prop.description && <span className="ml-1 text-slate-500">{prop.description}</span>}
                    {kind === 'enum' ? (
                      <select className={input} value={values[key] ?? ''} onChange={e => set(e.target.value)}>
                        <option value="">(not set)</option>
                        {prop.enum!.map(v => (
                          <option key={String(v)} value={String(v)}>
                            {String(v)}
                          </option>
                        ))}
                      </select>
                    ) : kind === 'boolean' ? (
                      <select className={input} value={values[key] ?? ''} onChange={e => set(e.target.value)}>
                        <option value="">(not set)</option>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : kind === 'json' ? (
                      <input
                        className={input}
                        placeholder={key === 'target' ? '{"ref": "e12"} or {"role": "button", "name": "Save"}' : 'JSON'}
                        value={values[key] ?? ''}
                        onChange={e => set(e.target.value)}
                      />
                    ) : (
                      <input
                        className={input}
                        type={kind === 'number' ? 'number' : 'text'}
                        value={values[key] ?? ''}
                        onChange={e => set(e.target.value)}
                      />
                    )}
                  </label>
                );
              })}
            </div>
          )}
          <div className="mt-2">
            <Button disabled={busy} onClick={() => void send()}>
              {busy ? 'Running…' : `Send ${tool.name}`}
            </Button>
          </div>
          <ErrorText error={error} />
        </Section>
      )}
      {r && (
        <Section title={r.ok ? `Result · ${result!.ms} ms` : `Error ${r.error?.code} · ${result!.ms} ms`}>
          <pre className="mb-2 max-h-[50vh] overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">
            {r.text}
          </pre>
          {r.receipt && (
            <details open>
              <summary className="cursor-pointer text-slate-600">Receipt</summary>
              <Json value={r.receipt} />
            </details>
          )}
          {r.error && (
            <details open>
              <summary className="cursor-pointer text-slate-600">Error</summary>
              <Json value={r.error} />
            </details>
          )}
          {r.pending && (
            <details open>
              <summary className="cursor-pointer text-slate-600">Pending modals</summary>
              <Json value={r.pending} />
            </details>
          )}
          {r.page && (
            <details>
              <summary className="cursor-pointer text-slate-600">Page state</summary>
              <Json
                value={{ ...r.page, snapshot: r.page.snapshot ? `${r.page.snapshot.length} characters` : undefined }}
              />
            </details>
          )}
          {r.data !== undefined && (
            <details>
              <summary className="cursor-pointer text-slate-600">Data</summary>
              <Json value={r.data} />
            </details>
          )}
        </Section>
      )}
    </div>
  );
}
