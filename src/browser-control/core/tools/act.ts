// Pointer actions: click, hover, scroll.
// Pipeline: resolve and revalidate → actionability (all retries here) → dispatch once → receipt and page state.
import { LayerError } from '../../protocol/errors';
import type { ClickArgs, HoverArgs, ScrollArgs, Target } from '../../protocol/schemas';
import type { ActionReceipt } from '../../protocol/results';
import type { ScrollInfo } from '../../probe';
import type { ToolContext, ToolOutcome } from '../controller';
import { resolveTarget } from '../interaction/resolve';
import type { ResolvedTarget } from '../interaction/resolve';
import { waitForActionable } from '../interaction/actionability';
import { dispatchClick, dispatchHover, dispatchWheel } from '../interaction/pointer';
import { withEvidence } from '../interaction/evidence';
import { preflightNavigation } from '../interaction/preflight';
import { classifyOn, gateTarget } from '../interaction/gate';
import type { GateResult } from '../interaction/gate';
import { checkCancelled } from '../controller';
import type { DialogInfo } from '../interaction/pointer';
import { withPageState } from './navigate';
import { dialogDetail } from '../text';

/** Runs fn with a resolved target and always releases the probe's handle on it. */
export async function withTarget<T>(
  ctx: ToolContext,
  target: Target,
  fn: (t: ResolvedTarget) => Promise<T>,
): Promise<T> {
  const resolved = await resolveTarget(ctx, target);
  if (ctx.signal?.aborted) {
    await ctx.tab().probe?.release(resolved.frame, resolved.objectId);
    checkCancelled(ctx);
  }
  try {
    return await fn(resolved);
  } finally {
    await releaseTarget(ctx, resolved);
  }
}

/**
 * Releases the probe's handle on a target. A dialog the action opened blocks the renderer, and the command would
 * only be answered when the dialog closes: it is sent and not waited for, so the result is not held back.
 */
export async function releaseTarget(ctx: ToolContext, target: ResolvedTarget): Promise<void> {
  const released = ctx.tab().probe?.release(target.frame, target.objectId);
  if (!ctx.tab().dialog) await released;
}

/** Blocks every action while a modal is open on the tab. */
export function assertNoModal(ctx: ToolContext): void {
  const pending = ctx.tab().pending;
  if (pending.length) {
    throw new LayerError('MODAL_PENDING', `A ${pending[0].kind} is open on this tab: ${pending[0].detail}`);
  }
}

export function recordDialog(ctx: ToolContext, dialog: DialogInfo): string {
  const detail = dialogDetail(dialog);
  ctx.tab().pending.push({ kind: 'dialog', detail });
  return detail;
}

const FRAME_TAGS = ['iframe', 'frame', 'object', 'embed'];

export async function click(ctx: ToolContext, args: ClickArgs): Promise<ToolOutcome> {
  assertNoModal(ctx);
  return withTarget(ctx, args.target, async first => {
    const prepare = async (target: ResolvedTarget) => {
      const actionable = await waitForActionable(ctx, target, { pointer: true, budgetMs: args.timeoutMs });
      // A click on a frame element lands on whatever the frame shows at that point, which nobody classified.
      if (FRAME_TAGS.includes(actionable.state.tag)) {
        throw new LayerError(
          'NOT_INTERACTABLE',
          `${target.description} is a frame: a click on it would land on its content. Click an element inside it by its own ref.`,
        );
      }
      // Policy layer 2: a link or submit button whose destination is not allowed is refused before dispatch.
      await preflightNavigation(ctx, target.frame, target.objectId, 'activate', target.description);
      return { target, actionable };
    };
    const prepared = await prepare(first);
    // One approval is for one activation: a double or triple click on a sensitive target is refused before
    // the user is asked, since the prompt would describe one click.
    if ((args.count ?? 1) > 1 && ctx.session.confirmPolicy !== 'never') {
      const judged = await classifyOn(ctx, {
        mode: 'activate',
        frame: first.frame,
        objectId: first.objectId,
        name: first.record.print.name,
        shown: first.record.print.shown,
        role: first.record.print.role,
      });
      if (judged.category) {
        throw new LayerError(
          'INVALID_ARGUMENT',
          `${first.description} is a ${judged.category} action (${judged.reason}); it can be clicked once per call, not ${args.count} times. Nothing was dispatched.`,
        );
      }
    }
    // The confirmation gate runs after actionability; an approval revalidates and re-checks the target.
    const { state, gate } = await gateTarget(
      ctx,
      prepared,
      { action: 'click', mode: 'activate', intent: args.intent },
      prepare,
    );
    const { target, actionable } = state;
    try {
      checkCancelled(ctx);
      // The page may have changed what the target does between the check above and the gate's own classification.
      if ((args.count ?? 1) > 1 && gate.category) {
        throw new LayerError(
          'INVALID_ARGUMENT',
          `${target.description} is a ${gate.category} action (${gate.reason}); it can be clicked once per call, not ${args.count} times. Nothing was dispatched.`,
        );
      }
      const { outcome, evidence } = await withEvidence(ctx, target, args.expect, {}, () =>
        dispatchClick(ctx, target, actionable.point, {
          button: args.button,
          count: args.count,
          modifiers: args.modifiers,
          gate,
        }),
      );
      const receipt: ActionReceipt = {
        action: 'click',
        target: `[${target.record.ref}] ${target.description}`,
        mechanism: 'pointer',
        dispatched: outcome.dispatched,
        reachedTarget: outcome.reachedTarget,
        effect: evidence.effect,
        postcondition: evidence.postcondition,
        navigation: evidence.navigation,
        newTab: evidence.newTab,
        ...(evidence.downloads ? { downloads: evidence.downloads } : {}),
        ...sensitivity(gate),
      };
      return withPageState(ctx, args.observe, { receipt, data: { point: actionable.point } });
    } finally {
      if (target !== first) await releaseTarget(ctx, target);
    }
  });
}

/** The receipt's record of the gate. */
export function sensitivity(gate: GateResult): Pick<ActionReceipt, 'sensitive' | 'confirmedByUser' | 'allowedBy'> {
  const allowedBy = gate.allowedBy ? { allowedBy: gate.allowedBy } : {};
  return gate.category
    ? { sensitive: gate.category, confirmedByUser: gate.confirmedByUser, ...allowedBy }
    : gate.confirmedByUser
      ? { confirmedByUser: true, ...allowedBy }
      : {};
}

export async function hover(ctx: ToolContext, args: HoverArgs): Promise<ToolOutcome> {
  assertNoModal(ctx);
  return withTarget(ctx, args.target, async target => {
    const actionable = await waitForActionable(ctx, target, {
      pointer: true,
      overControls: true,
      budgetMs: args.timeoutMs,
    });
    const { outcome, evidence } = await withEvidence(ctx, target, args.expect, {}, () =>
      dispatchHover(ctx, actionable.point),
    );
    const receipt: ActionReceipt = {
      action: 'hover',
      target: `[${target.record.ref}] ${target.description}`,
      mechanism: 'pointer',
      dispatched: outcome.dispatched,
      effect: evidence.effect,
      postcondition: evidence.postcondition,
    };
    return withPageState(ctx, args.observe, { receipt, data: { point: actionable.point } });
  });
}

const SCROLL_SETTLE_MS = 1_000;

async function scrollState(ctx: ToolContext, target: ResolvedTarget | null): Promise<ScrollInfo> {
  const probe = ctx.tab().probe!;
  if (target) return probe.call<ScrollInfo>(target.frame, target.objectId, 'scrollInfo');
  const frames = await (await ctx.attach()).topology.frames();
  return probe.callGlobal<ScrollInfo>(frames[0], 'scrollInfo', null);
}

/** Polls the offset until it stops changing (smooth scrolling animates), within a budget. */
async function settleScroll(ctx: ToolContext, target: ResolvedTarget | null, before: ScrollInfo): Promise<ScrollInfo> {
  const start = performance.now();
  let last = before;
  let still = 0;
  while (performance.now() - start < SCROLL_SETTLE_MS) {
    await new Promise(resolve => setTimeout(resolve, 50));
    const now = await scrollState(ctx, target);
    still = now.top === last.top && now.left === last.left ? still + 1 : 0;
    last = now;
    if (still >= 2 && (now.top !== before.top || now.left !== before.left || performance.now() - start > 300)) break;
  }
  return last;
}

export async function scroll(ctx: ToolContext, args: ScrollArgs): Promise<ToolOutcome> {
  assertNoModal(ctx);
  // Scrolling to an element: bring it into view.
  if (args.to && typeof args.to === 'object') {
    return withTarget(ctx, args.to, async target => {
      const { cdp } = await ctx.attach();
      ctx.tab().actionSeq++;
      await cdp.send(target.frame.sessionId, 'DOM.scrollIntoViewIfNeeded', {
        backendNodeId: target.record.backendNodeId,
      });
      const receipt: ActionReceipt = {
        action: 'scroll',
        target: `to [${target.record.ref}] ${target.description}`,
        mechanism: 'pointer',
        dispatched: true,
        effect: { verdict: 'changed', signals: ['scrolled into view'] },
      };
      return withPageState(ctx, args.observe, { receipt });
    });
  }
  const run = async (container: ResolvedTarget | null): Promise<ToolOutcome> => {
    let point;
    if (container) {
      const needs = { pointer: true, overControls: true, budgetMs: args.timeoutMs };
      point = (await waitForActionable(ctx, container, needs)).point;
    } else {
      const { cdp } = await ctx.attach();
      const m = await cdp.send<{ cssLayoutViewport: { clientWidth: number; clientHeight: number } }>(
        undefined,
        'Page.getLayoutMetrics',
      );
      point = { x: m.cssLayoutViewport.clientWidth / 2, y: m.cssLayoutViewport.clientHeight / 2 };
    }
    const before = await scrollState(ctx, container);
    let deltaY: number;
    let deltaX = 0;
    if (args.to === 'top') deltaY = -before.top - 1;
    else if (args.to === 'bottom') deltaY = before.height - before.top;
    else if (args.by?.px !== undefined) deltaY = args.by.px;
    else deltaY = Math.round((args.by?.pages ?? 1) * before.clientHeight * 0.9);
    if (args.to === 'top') deltaX = 0;
    let outcome = await dispatchWheel(ctx, point, deltaX, deltaY);
    let after = await settleScroll(ctx, container, before);
    // Chrome limits how far one wheel event travels. "To the top" and "to the bottom" are one action made of up to
    // five wheel events, sent until the edge is reached; this is the mechanism, not a retry after a failure.
    for (let i = 1; i < 5 && (args.to === 'top' || args.to === 'bottom'); i++) {
      const done = args.to === 'top' ? after.top <= 0 : after.top + after.clientHeight >= after.height - 1;
      if (done) break;
      const previous = after;
      outcome = await dispatchWheel(ctx, point, 0, args.to === 'top' ? -after.top - 1 : after.height - after.top);
      after = await settleScroll(ctx, container, previous);
      if (after.top === previous.top) break;
    }
    const moved = after.top - before.top;
    const atEnd = after.top + after.clientHeight >= after.height - 1;
    const atStart = after.top <= 0;
    const signals = [`offset ${Math.round(before.top)} → ${Math.round(after.top)} px`];
    if (deltaY > 0 && atEnd) signals.push('end reached');
    if (deltaY < 0 && atStart) signals.push('top reached');
    const receipt: ActionReceipt = {
      action: 'scroll',
      target: container ? `[${container.record.ref}] ${container.description}` : 'page',
      mechanism: 'pointer',
      dispatched: outcome.dispatched,
      effect: { verdict: moved !== 0 ? 'changed' : 'none', signals },
    };
    return withPageState(ctx, args.observe, {
      receipt,
      data: {
        before: { top: before.top, left: before.left },
        after: { top: after.top, left: after.left },
        atEnd,
        atStart,
      },
    });
  };
  return args.target ? withTarget(ctx, args.target, run) : run(null);
}
