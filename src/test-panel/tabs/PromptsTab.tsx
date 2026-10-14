// Prompts tab: the UserPrompt implementation. Confirmation cards for submit, pay and delete, and ask_user cards for
// takeover and input. A prompt disappears when the layer stops waiting for it.
import { useCallback, useEffect, useState } from 'react';
import type { OpenPrompt } from '@src/background/prompts';
import { client, useEvent } from '../rpc';
import { Button, Section } from '../components';

type Closed = OpenPrompt & { outcome: string; closedAt: string };

const CATEGORY_STYLE: Record<string, string> = {
  pay: 'border-red-400 bg-red-50',
  delete: 'border-red-400 bg-red-50',
  submit: 'border-amber-400 bg-amber-50',
  script: 'border-red-400 bg-red-50',
  action: 'border-slate-300 bg-slate-50',
};

export function PromptsTab() {
  const [prompts, setPrompts] = useState<OpenPrompt[]>([]);
  const [history, setHistory] = useState<Closed[]>([]);
  const [inputs, setInputs] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setPrompts(await client.call<OpenPrompt[]>('prompt.list'));
    setHistory((await client.call<Closed[]>('prompt.history')).slice().reverse());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEvent(
    'prompt.opened',
    useCallback(() => void refresh(), [refresh]),
  );
  useEvent(
    'prompt.closed',
    useCallback(() => void refresh(), [refresh]),
  );

  const answer = async (id: string, a: unknown) => {
    await client.call('prompt.answer', { id, answer: a });
    void refresh();
  };

  return (
    <div>
      <Section title={`Waiting for you (${prompts.length})`}>
        {!prompts.length && <p className="text-slate-600">Nothing is waiting.</p>}
        <ul className="space-y-2">
          {prompts.map(p =>
            p.kind === 'confirm' ? (
              <li key={p.id} className={`rounded border-2 p-2 ${CATEGORY_STYLE[p.request.category] ?? ''}`}>
                <p className="font-semibold">
                  Allow the agent to {p.request.category === 'action' ? 'act' : p.request.category}?
                </p>
                <p>
                  {p.request.action} {p.request.target}
                </p>
                <p className="text-xs text-slate-600">
                  on {p.request.origin} · tab {p.request.tabId} · {p.request.reason}
                </p>
                {p.request.intent && <p className="mt-1 text-xs">Agent’s intent: {p.request.intent}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button onClick={() => void answer(p.id, 'approve')}>Approve</Button>
                  {p.request.canRemember && (
                    <Button kind="secondary" onClick={() => void answer(p.id, 'approve-remember')}>
                      Approve; don’t ask again for submit on this site
                    </Button>
                  )}
                  <Button kind="secondary" onClick={() => void answer(p.id, 'decline')}>
                    Decline
                  </Button>
                </div>
              </li>
            ) : (
              <li key={p.id} className="rounded border-2 border-blue-400 bg-blue-50 p-2">
                <p className="font-semibold">
                  {p.request.kind === 'takeover' ? 'The agent hands you a step' : 'The agent asks'}
                </p>
                <p>{p.request.message}</p>
                <p className="text-xs text-slate-600">
                  on {p.request.origin} · tab {p.request.tabId}
                </p>
                {p.request.kind === 'input' && (
                  <input
                    className="mt-1 w-full rounded border border-slate-300 p-1"
                    aria-label="Answer"
                    value={inputs[p.id] ?? ''}
                    onChange={e => setInputs(v => ({ ...v, [p.id]: e.target.value }))}
                  />
                )}
                <div className="mt-2 flex gap-2">
                  <Button
                    onClick={() =>
                      void answer(p.id, {
                        outcome: 'continue',
                        data: p.request.kind === 'input' ? (inputs[p.id] ?? '') : undefined,
                      })
                    }>
                    {p.request.kind === 'input' ? 'Send' : 'Continue'}
                  </Button>
                  <Button kind="secondary" onClick={() => void answer(p.id, { outcome: 'cancel' })}>
                    Cancel
                  </Button>
                </div>
              </li>
            ),
          )}
        </ul>
      </Section>
      <Section title="Recent">
        <ul className="space-y-1 text-xs">
          {history.map(h => (
            <li key={`${h.id}-${h.closedAt}`} className="rounded bg-slate-50 p-1">
              <span className="font-mono">{h.closedAt.slice(11, 19)}</span> ·{' '}
              {h.kind === 'confirm' ? h.request.category : h.request.kind} ·{' '}
              {h.kind === 'confirm' ? `${h.request.action} ${h.request.target}` : h.request.message} →{' '}
              <b>{h.outcome}</b>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
