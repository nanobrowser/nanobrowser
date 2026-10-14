// The confirmation gate: after resolve and actionability, before the baseline and dispatch, an action classified as
// submit, pay or delete waits for the user's approval in the side panel. Declining has no side effect. The protocol has
// no call that relaxes it; only the host changes the session's policy.
import { LayerError } from '../../protocol/errors';
import type { SensitiveCategory, UserStepDetails } from '../../protocol/results';
import type { FormFacts, ProbeState } from '../../probe';
import type { ToolContext } from '../controller';
import type { ConfirmAnswer, ConfirmRequest, FrameRecord } from '../ports';
import { classify } from './classify';
import type { Classification } from './classify';
import { resolveRecord } from './resolve';
import type { ResolvedTarget } from './resolve';
import { maskSecrets } from '../redact';
import { isSecretField, MASK } from '../perception/masking';
import { siteOf } from '../site';
import { quote } from '../text';

export type ConfirmPolicy = 'sensitive' | 'always' | 'never';

export interface GateInput {
  action: string;
  /** activate: a click or Enter/Space on a button or link; enter: Enter in a field; none: no classification. */
  mode: 'activate' | 'enter' | 'none';
  frame: FrameRecord;
  objectId: string;
  name: string;
  /** The name as printed, when `name` holds a masked value (`RefPrint.shown`). */
  shown?: string;
  role: string;
  description: string;
  intent?: string;
  /** The action puts text or an option into the element: into a secret field that is the user's step. */
  textInput?: boolean;
  /** A category fixed by the tool rather than classified: `upload` is always a write. */
  category?: SensitiveCategory;
}

export interface GateResult {
  /** The category, when the action was classified as sensitive (also under the 'never' policy). */
  category: SensitiveCategory | undefined;
  /** The user approved it (now, or earlier for this site). */
  confirmedByUser: boolean;
  /** A prompt was shown and answered: the target must be revalidated before dispatch. */
  prompted: boolean;
  reason: string;
  /** What was judged (`Judgement.basis`), when the action was classified: a later check must find the same. */
  basis?: string;
  /** Under a host write policy: how the write was allowed. */
  allowedBy?: 'user' | 'site-rule' | 'auto';
}

/** A classification with what it rests on: the category, its reason (names, amount) and, for a submission, where. */
export interface Judgement extends Classification {
  basis: string;
}

let nextPrompt = 1;

/** Chrome's accessible name for the default button of the element's form owner (aria-labelledby included). */
async function defaultButtonName(ctx: ToolContext, frame: FrameRecord, objectId: string): Promise<string> {
  const backendNodeId = await ctx.tab().probe!.callForNode(frame, objectId, 'defaultButtonOf');
  if (!backendNodeId) return '';
  const { cdp } = await ctx.attach();
  const { nodes } = await cdp.send<{ nodes: Array<{ backendDOMNodeId?: number; name?: { value?: unknown } }> }>(
    frame.sessionId,
    'Accessibility.getPartialAXTree',
    { backendNodeId, fetchRelatives: false },
  );
  const name = nodes.find(n => n.backendDOMNodeId === backendNodeId)?.name?.value;
  return typeof name === 'string' ? name.trim() : '';
}

/**
 * Classifies an action on the live element: the probe's form facts, with Chrome's accessible name of the default button
 * for Enter. Also used before a later key of a sequence, when the page may have changed.
 */
export async function classifyOn(
  ctx: ToolContext,
  input: {
    mode: 'activate' | 'enter';
    frame: FrameRecord;
    objectId: string;
    name: string;
    shown?: string;
    role: string;
  },
): Promise<Judgement> {
  const facts = await ctx.tab().probe!.call<FormFacts>(input.frame, input.objectId, 'formFacts');
  if (input.mode === 'enter' && facts.form?.defaultButton) {
    // The probe only approximates names; the default button is judged by Chrome's accessible name too.
    const accessible = await defaultButtonName(ctx, input.frame, input.objectId).catch(() => '');
    if (accessible) facts.form.defaultButton.accessibleName = accessible;
  }
  // The name Chrome gave is what is classified. A reason quotes the name: when that name holds a masked value, the
  // reason (shown to the user and kept in the audit) quotes the name as it was printed instead.
  const judged = classify({ mode: input.mode, name: input.name, role: input.role, facts, url: input.frame.url });
  const name = input.name.trim();
  const result =
    input.shown !== undefined && name ? { ...judged, reason: judged.reason.split(name).join(input.shown) } : judged;
  return { ...result, basis: basisOf(result, input.mode, facts) };
}

/**
 * What a classification rests on, for binding an approval to the action: the category and its reason, which names the
 * control (for Enter, the default button) and any amount next to it, and, when the action submits a form, the form's
 * method and address. "Pay $5" and "Pay $500" are both `pay`, with different bases.
 */
export function basisOf(result: Classification, mode: 'activate' | 'enter', facts: FormFacts): string {
  const submits = facts.form && (mode === 'enter' || facts.submitter);
  const where = submits ? ` → ${facts.form!.method.toUpperCase()} ${facts.form!.action}` : '';
  return `${result.category ?? 'none'}: ${result.reason}${where}`;
}

/**
 * Classifies an action again at a moment input is about to activate something, after the page's handlers ran on
 * earlier input of the same action (the pointer moving over the target, a press, earlier keys). A sensitive category
 * the gate did not judge is `TARGET_CHANGED`: the page changed what the input does, and nobody was asked about that.
 */
export async function assertJudged(
  ctx: ToolContext,
  input: {
    mode: 'activate' | 'enter';
    frame: FrameRecord;
    objectId: string;
    name: string;
    shown?: string;
    role: string;
    description: string;
    action: string;
  },
  gate: GateResult,
  next: string,
): Promise<void> {
  if (ctx.session.confirmPolicy === 'never') return;
  const now = await classifyOn(ctx, input);
  if (now.category && now.category !== gate.category) {
    throw new LayerError(
      'TARGET_CHANGED',
      `${input.description} changed during ${input.action}: ${next} would now be ${now.category} (${now.reason}), which the gate did not judge. Nothing was dispatched.`,
    );
  }
  // The same category is not enough: what was judged (and approved) must be what the input now does.
  if (now.category && gate.basis !== undefined && now.basis !== gate.basis) {
    throw new LayerError(
      'TARGET_CHANGED',
      `${input.description} changed during ${input.action}: ${next} would now be ${now.category} (${now.reason}), not what the gate judged (${gate.reason}). Nothing was dispatched.`,
    );
  }
}

/**
 * A check that failed after input of the action already reached the page: the error keeps its code, says what was
 * and was not sent in place of "Nothing was dispatched", and reports the delivery.
 */
export function afterInput(error: unknown, delivered: boolean, sent: string): unknown {
  if (!(error instanceof LayerError)) return error;
  return new LayerError(error.code, `${error.message.replace(/ Nothing was dispatched\.$/, '')} ${sent}`, {
    delivered,
    details: error.details,
  });
}

export async function confirmGate(ctx: ToolContext, input: GateInput): Promise<GateResult> {
  const session = ctx.session;
  const policy = session.confirmPolicy;
  let category: SensitiveCategory | undefined;
  let reason = 'not classified';
  let basis: string | undefined;
  if (input.category) {
    category = input.category;
    reason = 'an upload sends a file to the site';
  } else if (input.mode !== 'none') {
    const result = await classifyOn(ctx, { ...input, mode: input.mode });
    category = result.category ?? undefined;
    reason = result.reason;
    basis = result.basis;
  }
  // Protected steps are the user's, decided before any policy is asked.
  if (session.handover && input.textInput && input.objectId) {
    const state = await ctx.tab().probe!.call<ProbeState>(input.frame, input.objectId, 'state');
    if (isSecretField(state, input.name)) {
      const url = (await ctx.controller.host.tabs.get(ctx.tab().tabId))?.url ?? '';
      throw new LayerError(
        'USER_STEP',
        `${input.description} is a secret field (a password, a card number, a security code or a one-time code). Typing into it is the user's step: nothing was sent.`,
        { details: { reason: 'secret', target: input.description, site: siteOf(url) } satisfies UserStepDetails },
      );
    }
  }
  if (session.handover && (category === 'pay' || category === 'grant')) {
    const payUrl = (await ctx.controller.host.tabs.get(ctx.tab().tabId))?.url ?? '';
    throw new LayerError(
      'USER_STEP',
      `${input.description} is ${category === 'pay' ? 'a payment' : 'an access grant'} (${reason}). It is the user's step: nothing was dispatched.`,
      { details: { reason: category, target: input.description, site: siteOf(payUrl) } satisfies UserStepDetails },
    );
  }
  const tabUrl = (await ctx.controller.host.tabs.get(ctx.tab().tabId))?.url ?? '';
  const site = siteOf(tabUrl);
  // A host write policy decides classified writes; otherwise the session's fixed confirmation policy does, as in the
  // test panel.
  let canRemember = category === 'submit';
  if (session.decideWrite && (category === 'submit' || category === 'delete' || category === 'upload')) {
    const decision = await session.decideWrite({ category, site, tabId: ctx.tab().tabId });
    if (decision.decision === 'run') {
      return { category, confirmedByUser: false, prompted: false, reason, basis, allowedBy: decision.by ?? 'auto' };
    }
    canRemember = decision.canRemember;
  } else {
    const needed = policy === 'always' || (policy === 'sensitive' && category !== undefined);
    if (!needed) return { category, confirmedByUser: false, prompted: false, reason, basis };
  }

  let origin = tabUrl;
  try {
    origin = new URL(tabUrl).origin;
  } catch {
    // keep the raw URL
  }
  if (!session.decideWrite && category === 'submit' && session.rememberedSubmitOrigins.has(origin)) {
    return {
      category,
      confirmedByUser: true,
      prompted: false,
      reason: `${reason}; approved earlier for ${origin}`,
      basis,
    };
  }
  const prompt = ctx.controller.host.prompt;
  if (!prompt) {
    throw new LayerError(
      'NEEDS_USER',
      `${input.description} is a ${category ?? 'confirmed'} action and needs the user's approval, but no one can be asked here.`,
    );
  }
  // The card names the frame's host and the destination's host when they differ from the site (section 8).
  const frameHost = input.frame.url ? siteOf(input.frame.url) : '';
  const destination =
    input.mode !== 'none'
      ? await ctx
          .tab()
          .probe!.call<{ url: string } | null>(input.frame, input.objectId, 'navigationTarget', input.mode)
          .catch(() => null)
      : null;
  const destinationHost = destination ? siteOf(destination.url) : '';
  const request: ConfirmRequest = maskSecrets<ConfirmRequest>(
    {
      id: `c${nextPrompt++}`,
      tabId: ctx.tab().tabId,
      category: category ?? 'action',
      action: input.action,
      target: input.description,
      origin,
      site,
      ...(frameHost && frameHost !== site ? { frameHost } : {}),
      ...(destinationHost && destinationHost !== site ? { destinationHost } : {}),
      intent: input.intent,
      reason,
      canRemember,
    },
    ctx.tab().secrets,
    MASK,
  );
  const tab = ctx.tab();
  const modal = { kind: 'confirmation' as const, detail: `${request.category}: ${request.action} ${request.target}` };
  tab.pending.push(modal);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  ctx.signal?.addEventListener('abort', onAbort);
  // A session can wait without a clock (Infinity): the card waits until it is answered, the call is cancelled (Stop)
  // or the tab closes.
  const timeoutMs = session.config.confirmTimeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  ctx.controller.audit({
    at: new Date().toISOString(),
    sessionId: session.id,
    tool: '(confirmation)',
    args: request,
    ok: true,
    tabId: request.tabId,
    ms: 0,
  });
  const start = performance.now();
  let answer: ConfirmAnswer | 'timeout' | 'cancelled';
  try {
    answer = await Promise.race([
      prompt.confirm(request, controller.signal),
      new Promise<'timeout'>(resolve => {
        if (Number.isFinite(timeoutMs)) timer = setTimeout(() => resolve('timeout'), timeoutMs);
      }),
      new Promise<'cancelled'>(resolve => controller.signal.addEventListener('abort', () => resolve('cancelled'))),
    ]);
  } finally {
    clearTimeout(timer);
    // The prompt is withdrawn whatever ended the wait, so a late answer has no effect.
    controller.abort();
    ctx.signal?.removeEventListener('abort', onAbort);
    tab.pending = tab.pending.filter(m => m !== modal);
  }
  ctx.controller.audit({
    at: new Date().toISOString(),
    sessionId: session.id,
    tool: '(confirmation answer)',
    args: { id: request.id, category: request.category, answer },
    ok: answer === 'approve' || answer === 'approve-remember',
    tabId: request.tabId,
    ms: Math.round(performance.now() - start),
  });
  if (answer === 'timeout') {
    throw new LayerError(
      'CONFIRMATION_TIMEOUT',
      `The user did not answer within ${Math.round(timeoutMs / 1000)} s. ${input.description} was not activated.`,
    );
  }
  if (answer === 'cancelled')
    throw new LayerError('CANCELLED', 'The call was cancelled while the user was being asked.');
  // Only an approval approves: any other answer, one the host should never give included, is a decline.
  if (answer !== 'approve' && answer !== 'approve-remember')
    throw new LayerError(
      'USER_DECLINED',
      `The user declined: ${input.action} ${input.description}. Nothing was dispatched.`,
    );
  // The approval was for this site: the tab must still be on it.
  const now = siteOf((await ctx.controller.host.tabs.get(ctx.tab().tabId))?.url ?? '');
  if (now !== site) {
    throw new LayerError(
      'TARGET_CHANGED',
      `The tab left ${quote(site)} while the user decided (it is on ${quote(now)} now). Nothing was dispatched.`,
    );
  }
  // Under a host policy the host stores the site rule from the answer it gave; the session remembers nothing.
  if (!session.decideWrite && answer === 'approve-remember' && category === 'submit') {
    session.rememberedSubmitOrigins.add(origin);
  }
  return { category, confirmedByUser: true, prompted: true, reason, basis, allowedBy: 'user' };
}

/**
 * Runs the gate for an action on a resolved target. When the user was asked, the target is resolved and checked
 * again, because the page may have changed while the user decided.
 */
export async function gateTarget<T extends { target: ResolvedTarget }>(
  ctx: ToolContext,
  current: T,
  input: Omit<GateInput, 'frame' | 'objectId' | 'name' | 'role' | 'description'>,
  reacquire: (target: ResolvedTarget) => Promise<T>,
): Promise<{ state: T; gate: GateResult }> {
  const t = current.target;
  const gate = await confirmGate(ctx, {
    ...input,
    frame: t.frame,
    objectId: t.objectId,
    name: t.record.print.name,
    shown: t.record.print.shown,
    role: t.record.print.role,
    description: t.description,
  });
  if (!gate.prompted) return { state: current, gate };
  await ctx.tab().probe?.release(t.frame, t.objectId);
  const fresh = await resolveRecord(ctx, t.record, t.via);
  return { state: await reacquire(fresh), gate };
}
