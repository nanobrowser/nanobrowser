// `ask_user` (capability "human"): hand a step to the person (a login, a CAPTCHA, a one-time code)
// over the same UserPrompt channel and pending-modal state as the confirmation gate.
import { LayerError } from '../../protocol/errors';
import type { AskUserArgs } from '../../protocol/schemas';
import type { ToolContext, ToolOutcome } from '../controller';
import type { AskAnswer, AskRequest } from '../ports';
import { snapshot } from './observe';

let nextRequest = 1;

export async function askUser(ctx: ToolContext, args: AskUserArgs): Promise<ToolOutcome> {
  const prompt = ctx.controller.host.prompt;
  if (!prompt) throw new LayerError('NEEDS_USER', 'No one can be asked here.');
  const tab = ctx.tab();
  const url = (await ctx.controller.host.tabs.get(tab.tabId))?.url ?? '';
  let origin = url;
  try {
    origin = new URL(url).origin;
  } catch {
    // keep the raw URL
  }
  const request: AskRequest = {
    id: `u${nextRequest++}`,
    tabId: tab.tabId,
    kind: args.kind,
    message: args.message,
    origin,
  };
  // While the person works in the page, the layer sends no input to the tab.
  const modal = { kind: 'user-request' as const, detail: `${args.kind}: ${args.message}` };
  tab.pending.push(modal);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  ctx.signal?.addEventListener('abort', onAbort);
  const timeoutMs = args.timeoutMs ?? ctx.session.config.askTimeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  ctx.controller.audit({
    at: new Date().toISOString(),
    sessionId: ctx.session.id,
    tool: '(user request)',
    args: request,
    ok: true,
    tabId: tab.tabId,
    ms: 0,
  });
  const start = performance.now();
  let answer: AskAnswer | 'timeout' | 'cancelled';
  try {
    answer = await Promise.race([
      prompt.ask(request, controller.signal),
      new Promise<'timeout'>(resolve => (timer = setTimeout(() => resolve('timeout'), timeoutMs))),
      new Promise<'cancelled'>(resolve => controller.signal.addEventListener('abort', () => resolve('cancelled'))),
    ]);
  } finally {
    clearTimeout(timer);
    // Withdrawn whatever ended the wait, so a late answer has no effect.
    controller.abort();
    ctx.signal?.removeEventListener('abort', onAbort);
    tab.pending = tab.pending.filter(m => m !== modal);
  }
  ctx.controller.audit({
    at: new Date().toISOString(),
    sessionId: ctx.session.id,
    tool: '(user request answer)',
    args: { id: request.id, outcome: typeof answer === 'string' ? answer : answer.outcome },
    ok: typeof answer !== 'string' && answer.outcome === 'continue',
    tabId: tab.tabId,
    ms: Math.round(performance.now() - start),
  });
  if (answer === 'timeout')
    throw new LayerError(
      'TIMEOUT',
      `The user did not answer within ${Math.round(timeoutMs / 1000)} s; the request was withdrawn.`,
    );
  if (answer === 'cancelled') throw new LayerError('CANCELLED', 'The call was cancelled; the request was withdrawn.');
  if (answer.outcome === 'cancel') throw new LayerError('USER_DECLINED', 'The user cancelled the step.');
  // The person changed the page outside the layer: return a full observation.
  tab.actionSeq++;
  const observed = await snapshot(ctx, {});
  return {
    ...observed,
    data: { outcome: 'continue', ...(answer.data !== undefined ? { data: answer.data } : {}) },
    lines: [
      `ask_user · ${args.kind} · the user continued`,
      ...(answer.data !== undefined ? [`answer: ${answer.data}`] : []),
      ...(observed.lines ?? []),
    ],
  };
}
