// UserPrompt for the test extension: prompts are shown in the side panel's Prompts tab and answered there. Scenarios
// install a scripted responder instead. When the layer's wait ends, the prompt is withdrawn and a late answer is
// refused.
import type { AskAnswer, AskRequest, ConfirmAnswer, ConfirmRequest, UserPrompt } from '@src/browser-control';
import { emit, register } from './rpc';

export type OpenPrompt =
  | { id: string; kind: 'confirm'; request: ConfirmRequest; openedAt: string }
  | { id: string; kind: 'ask'; request: AskRequest; openedAt: string };

type Answer = ConfirmAnswer | AskAnswer;

const open = new Map<string, { prompt: OpenPrompt; resolve: (answer: Answer) => void }>();
const history: Array<OpenPrompt & { outcome: string; closedAt: string }> = [];

/** A scripted responder: called for each new prompt; may answer at once, later, or never. */
export type Responder = (prompt: OpenPrompt, answer: (a: Answer) => boolean) => void;
let responder: Responder | null = null;

/** Installs a responder and returns the one it replaced, so callers can restore it. */
export function setResponder(r: Responder | null): Responder | null {
  const previous = responder;
  responder = r;
  return previous;
}

/** A user who approves every confirmation and continues every request: the default for scenarios. */
export const approveAll: Responder = (p, a) => void a(p.kind === 'confirm' ? 'approve' : { outcome: 'continue' });

function close(id: string, outcome: string): void {
  const entry = open.get(id);
  if (!entry) return;
  open.delete(id);
  history.push({ ...entry.prompt, outcome, closedAt: new Date().toISOString() });
  if (history.length > 100) history.shift();
  emit('prompt.closed', { id, outcome });
}

/** Answers an open prompt. False when it is no longer open (answered, or withdrawn because the wait ended). */
export function answer(id: string, a: Answer): boolean {
  const entry = open.get(id);
  if (!entry) return false;
  entry.resolve(a);
  close(id, typeof a === 'string' ? a : a.outcome);
  return true;
}

function show<T extends Answer>(prompt: OpenPrompt, signal: AbortSignal): Promise<T> {
  return new Promise<T>(resolve => {
    open.set(prompt.id, { prompt, resolve: a => resolve(a as T) });
    emit('prompt.opened', prompt);
    signal.addEventListener('abort', () => close(prompt.id, 'withdrawn'));
    responder?.(prompt, a => answer(prompt.id, a));
  });
}

export const panelPrompt: UserPrompt = {
  confirm: (request, signal) =>
    show<ConfirmAnswer>({ id: request.id, kind: 'confirm', request, openedAt: new Date().toISOString() }, signal),
  ask: (request, signal) =>
    show<AskAnswer>({ id: request.id, kind: 'ask', request, openedAt: new Date().toISOString() }, signal),
};

register('prompt.list', async () => [...open.values()].map(e => e.prompt));
register('prompt.history', async () => history);
register('prompt.answer', async params => {
  const { id, answer: a } = params as { id: string; answer: Answer };
  return { accepted: answer(id, a) };
});
