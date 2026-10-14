// Pointer dispatch: trusted mouse input on the tab's root session at top-level coordinates, with the dispatch-time
// guard armed in the target's frame and its ancestors, and each command raced against a JavaScript dialog. The page's
// handlers run on the layer's own input, so the target is checked again before each press and each release. Input is
// sent at most once; nothing here retries.
import { LayerError } from '../../protocol/errors';
import type { GuardReport } from '../../probe';
import type { ToolContext } from '../controller';
import type { CdpPort, FrameRecord } from '../ports';
import type { Point } from '../geometry';
import { assertAsShown } from './resolve';
import type { ResolvedTarget } from './resolve';
import { afterInput, assertJudged } from './gate';
import type { GateResult } from './gate';
import { preflightNavigation } from './preflight';
import { sendWithheld } from './withheld';
import { dialogDetail, quote } from '../text';

export interface DialogInfo {
  type: string;
  message: string;
  url: string;
  defaultPrompt?: string;
}

export interface PointerOutcome {
  dispatched: boolean | 'unknown';
  /** False when the guard saw no event in the target's frame; undefined when it could not be read. */
  reachedTarget?: boolean;
  dialog?: DialogInfo;
  guard?: GuardReport;
}

const MODIFIER_BITS: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

export function modifierMask(modifiers: string[] | undefined): number {
  return (modifiers ?? []).reduce((mask, m) => mask | (MODIFIER_BITS[m] ?? 0), 0);
}

/** Resolves with the next JavaScript dialog on any session of the tab, until disposed. */
export function watchDialog(cdp: CdpPort) {
  let resolveDialog!: (d: DialogInfo) => void;
  const opened = new Promise<DialogInfo>(resolve => (resolveDialog = resolve));
  const off = cdp.on('Page.javascriptDialogOpening', params => resolveDialog(params as DialogInfo));
  return { opened, dispose: off };
}

/** Sends one input command, raced against a dialog. A dialog that opens first wins; the command stays outstanding. */
async function sendRaced(
  cdp: CdpPort,
  params: object,
  dialog: Promise<DialogInfo>,
): Promise<{ done: true } | { dialog: DialogInfo; pending: Promise<unknown> }> {
  const command = cdp.send(undefined, 'Input.dispatchMouseEvent', params, 5_000);
  command.catch(() => undefined);
  const winner = await Promise.race([command.then(() => ({ done: true as const })), dialog.then(d => ({ dialog: d }))]);
  return 'done' in winner ? winner : { dialog: winner.dialog, pending: command };
}

function ancestorFrames(target: ResolvedTarget): FrameRecord[] {
  const byId = new Map(target.frames.map(f => [f.frameId, f]));
  const out: FrameRecord[] = [];
  for (let f = target.frame.parentFrameId ? byId.get(target.frame.parentFrameId) : undefined; f;) {
    out.push(f);
    f = f.parentFrameId ? byId.get(f.parentFrameId) : undefined;
  }
  return out;
}

/**
 * Arms the pointer guard in the target's frame and the ancestor guard in every ancestor frame. Keys have their own
 * guard (key-guard.ts).
 */
async function armGuards(ctx: ToolContext, target: ResolvedTarget): Promise<FrameRecord[]> {
  const probe = ctx.tab().probe!;
  await probe.call(target.frame, target.objectId, 'armGuard', 'pointer');
  const ancestors = ancestorFrames(target);
  for (const frame of ancestors) await probe.callGlobal(frame, 'armAncestorGuard').catch(() => undefined);
  return ancestors;
}

async function readGuards(
  ctx: ToolContext,
  target: ResolvedTarget,
  ancestors: FrameRecord[],
): Promise<{ own: GuardReport; ancestor?: { frame: FrameRecord; report: GuardReport } }> {
  const probe = ctx.tab().probe!;
  const own = await probe.callGlobal<GuardReport>(target.frame, 'readGuard');
  await probe.callGlobal(target.frame, 'disarm').catch(() => undefined);
  let ancestor: { frame: FrameRecord; report: GuardReport } | undefined;
  for (const frame of ancestors) {
    const report = await probe.callGlobal<GuardReport>(frame, 'readGuard').catch(() => null);
    await probe.callGlobal(frame, 'disarm').catch(() => undefined);
    if (report && report.verdict === 'cancelled' && !ancestor) ancestor = { frame, report };
  }
  return { own, ancestor };
}

export interface ClickOptions {
  button?: 'left' | 'right' | 'middle';
  count?: number;
  modifiers?: string[];
  /**
   * The gate's result, for a click the gate judged: the click is then classified again before every press and release.
   * Without it only the target's identity is checked (a click that focuses a field or toggles a control).
   */
  gate?: GateResult;
}

/**
 * Before a press and before its release, once the page's handlers have run on the layer's own input (the pointer
 * moving over the target, the press): the target must still be what the session was shown, and, for a click the gate
 * judged, still do what the gate judged and go where policy layer 2 allows. A release is what activates, so what a
 * click does is decided when the release arrives, not when the target was resolved.
 */
async function stillJudged(ctx: ToolContext, target: ResolvedTarget, gate: GateResult | undefined): Promise<void> {
  // The record context too: a hover handler that makes the row show another record must not get the click that was
  // approved for the first one.
  await assertAsShown(ctx, target, { context: true });
  if (!gate) return;
  await assertJudged(
    ctx,
    {
      mode: 'activate',
      frame: target.frame,
      objectId: target.objectId,
      name: target.record.print.name,
      shown: target.record.print.shown,
      role: target.record.print.role,
      description: target.description,
      action: 'the click',
    },
    gate,
    'the click',
  );
  await preflightNavigation(ctx, target.frame, target.objectId, 'activate', target.description);
}

/** A check that reads the page, unless a dialog opens first: the page is then blocked and cannot answer. */
async function unlessDialog(check: Promise<void>, dialog: Promise<DialogInfo>): Promise<DialogInfo | undefined> {
  check.catch(() => undefined);
  return Promise.race([check.then(() => undefined), dialog]);
}

/**
 * The guard cancelled a press: `INTERCEPTED`. The guard checks every press event of a sequence, so a later one can
 * be cancelled after earlier ones it accepted were delivered.
 */
function intercepted(
  target: ResolvedTarget,
  guards: Awaited<ReturnType<typeof readGuards>>,
  count: number,
): LayerError | null {
  if (guards.own.verdict !== 'cancelled' && !guards.ancestor) return null;
  const hit =
    guards.own.verdict === 'cancelled'
      ? quote(guards.own.hit, 80)
      : `${quote(guards.ancestor!.report.hit, 80)} in ${quote(guards.ancestor!.frame.url)}`;
  // Press events the guard let through before it cancelled one (an earlier click of a double click, or the
  // pointerdown of the same press) reached the page's handlers.
  if ((guards.own.accepted ?? 0) > 0) {
    return new LayerError(
      'INTERCEPTED',
      `The click on ${target.description} was cancelled part way: ${hit} was at the click point of a later press${count > 1 ? ` (of ${count} clicks)` : ''}. The presses before it reached the target; no page handler ran for the rest.`,
      { delivered: true, details: guards },
    );
  }
  return new LayerError(
    'INTERCEPTED',
    `The click on ${target.description} was cancelled as it arrived: ${hit} was at the click point. No page handler ran.`,
    { delivered: false, details: guards },
  );
}

/**
 * The release of a press that opened a dialog, sent once the dialog closes. The page ran in between, so the release
 * completes the click only if the target is still what was shown and judged; otherwise it is withheld from the page,
 * and the note returned says why (`handle_dialog` reports it).
 */
async function releaseHeld(
  ctx: ToolContext,
  target: ResolvedTarget,
  gate: GateResult | undefined,
  release: () => Promise<unknown>,
): Promise<string | undefined> {
  const tab = ctx.tab();
  const probe = tab.probe;
  if (!probe) return undefined;
  let changed: string | undefined;
  let objectId: string | undefined;
  try {
    // The handle of the call that pressed was released when that call returned.
    objectId = await probe.resolve(target.frame, target.record.backendNodeId);
    await stillJudged(ctx, { ...target, objectId }, gate);
  } catch (error) {
    changed = (error instanceof Error ? error.message : String(error)).replace(/ Nothing was dispatched\.$/, '');
  } finally {
    if (objectId) await probe.release(target.frame, objectId);
  }
  if (changed === undefined) {
    await release();
    return undefined;
  }
  await sendWithheld(tab, 'pointer', release).catch(() => false);
  return `The click on ${target.description} that opened the dialog was not completed: ${changed} Its release was withheld from the page.`;
}

/**
 * Moves to the point and presses: the press and release of each click are raced against a dialog, and the target is
 * checked again before each of them (stillJudged).
 */
export async function dispatchClick(
  ctx: ToolContext,
  target: ResolvedTarget,
  point: Point,
  options: ClickOptions,
): Promise<PointerOutcome> {
  const { cdp } = await ctx.attach();
  const tab = ctx.tab();
  const ancestors = await armGuards(ctx, target);
  const dialog = watchDialog(cdp);
  const base = { x: point.x, y: point.y, modifiers: modifierMask(options.modifiers), button: options.button ?? 'left' };
  const count = options.count ?? 1;
  tab.actionSeq++;
  let dispatched: boolean | 'unknown' = false;
  let guardsRead = false;
  try {
    await cdp.send(undefined, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
      modifiers: base.modifiers,
    });
    for (let clickCount = 1; clickCount <= count; clickCount++) {
      // The move ran the page's hover handlers, and an earlier click of the sequence ran its click handlers.
      const sent =
        clickCount === 1
          ? 'The pointer was moved over it; no press was sent.'
          : `${clickCount - 1} of ${count} clicks were sent; the rest was not.`;
      const before = await unlessDialog(stillJudged(ctx, target, options.gate), dialog.opened).catch(error => {
        throw afterInput(error, true, sent);
      });
      if (before) {
        throw new LayerError('MODAL_PENDING', `A dialog opened (${dialogDetail(before)}). ${sent}`, {
          delivered: true,
        });
      }
      const press = await sendRaced(cdp, { ...base, type: 'mousePressed', clickCount }, dialog.opened);
      dispatched = true;
      const release = () =>
        cdp.send(undefined, 'Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', clickCount });
      // The release goes out after the dialog closes (handle_dialog), so the sequence is not left half done.
      const hold = (opened: DialogInfo): PointerOutcome => {
        tab.pendingRelease = () => releaseHeld(ctx, target, options.gate, release);
        return { dispatched, dialog: opened };
      };
      if ('dialog' in press) return hold(press.dialog);
      // The press ran the page's mousedown handlers, and the release is what clicks.
      let during: DialogInfo | undefined;
      try {
        during = await unlessDialog(stillJudged(ctx, target, options.gate), dialog.opened);
      } catch (error) {
        // The button is down: it is released, with the release withheld from the page, so nothing is clicked.
        const guards = await readGuards(ctx, target, ancestors).catch(() => null);
        guardsRead = true;
        await sendWithheld(tab, 'pointer', release).catch(() => false);
        // A press the guard cancelled reached no handler: that, not the change, is what happened.
        throw (
          (guards && intercepted(target, guards, count)) ??
          afterInput(
            error,
            true,
            'The press was sent; its release was withheld from the page, so the click did not complete.',
          )
        );
      }
      if (during) return hold(during);
      const released = await sendRaced(cdp, { ...base, type: 'mouseReleased', clickCount }, dialog.opened);
      if ('dialog' in released) return { dispatched, dialog: released.dialog };
    }
  } catch (error) {
    // A command that timed out cannot be cancelled: its outcome is unknown, and it is not sent again.
    if (error instanceof Error && error.name === 'CdpTimeoutError') {
      return { dispatched: 'unknown' };
    }
    // A sequence stopped by a check leaves no guard behind to cancel a later press.
    if (!guardsRead && !tab.dialog) await readGuards(ctx, target, ancestors).catch(() => null);
    throw error;
  } finally {
    dialog.dispose();
  }
  const guards = await readGuards(ctx, target, ancestors).catch(() => null);
  if (!guards) return { dispatched };
  const cancelled = intercepted(target, guards, count);
  if (cancelled) throw cancelled;
  return { dispatched, reachedTarget: guards.own.verdict === 'passed', guard: guards.own };
}

export async function dispatchHover(ctx: ToolContext, point: Point): Promise<PointerOutcome> {
  const { cdp } = await ctx.attach();
  ctx.tab().actionSeq++;
  await cdp.send(undefined, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  return { dispatched: true };
}

export async function dispatchWheel(
  ctx: ToolContext,
  point: Point,
  deltaX: number,
  deltaY: number,
): Promise<PointerOutcome> {
  const { cdp } = await ctx.attach();
  ctx.tab().actionSeq++;
  await cdp.send(undefined, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: point.x, y: point.y, deltaX, deltaY });
  return { dispatched: true };
}

export { armGuards, readGuards };
