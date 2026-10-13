// Text and form mechanisms: set, type, press. The mechanism is chosen from the target's type before dispatch and named
// in the receipt; every value is read back.
import { LayerError } from '../../protocol/errors';
import type { PressArgs, SetArgs, TypeArgs } from '../../protocol/schemas';
import type { ActionReceipt, Mechanism } from '../../protocol/results';
import type { OptionResult, ProbeState, SelectedOption } from '../../probe';
import type { ToolContext, ToolOutcome } from '../controller';
import { axIdentity } from '../interaction/resolve';
import type { ResolvedTarget } from '../interaction/resolve';
import { waitForActionable } from '../interaction/actionability';
import { dispatchClick } from '../interaction/pointer';
import type { DialogInfo } from '../interaction/pointer';
import { KeyGuard, KeyPresser } from '../interaction/key-guard';
import type { GuardedElement, KeyGuardOptions } from '../interaction/key-guard';
import { isSensitiveState, listedOption, looksLikeCardNumber, MASK, quotedOption } from '../perception/masking';
import { assertNoModal, recordDialog, withTarget, sensitivity } from './act';
import { withEvidence } from '../interaction/evidence';
import { focusedElement, preflightNavigation } from '../interaction/preflight';
import { afterInput, assertJudged, confirmGate, gateTarget } from '../interaction/gate';
import type { GateResult } from '../interaction/gate';
import { dispatchedKey, keyMode, splitChord, typedMode } from '../interaction/keys';
import type { KeyMode } from '../interaction/keys';
import type { FrameRecord } from '../ports';
import { checkCancelled } from '../controller';
import { withPageState } from './navigate';
import { rememberSecret } from '../redact';
import { quote } from '../text';

const NATIVE_VALUE_TYPES = new Set(['date', 'time', 'datetime-local', 'month', 'week', 'color', 'range']);
const TOGGLE_ROLES = new Set(['checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio']);

async function stateOf(ctx: ToolContext, target: ResolvedTarget): Promise<ProbeState> {
  // A dialog the action opened blocks the renderer: a read-back would only time out, so it is not attempted.
  if (ctx.tab().dialog) throw new LayerError('MODAL_PENDING', 'A dialog is open; the element cannot be read.');
  return ctx.tab().probe!.call<ProbeState>(target.frame, target.objectId, 'state');
}

/** A single character pressed alone types it: into a secret field, that is the user's step. */
function printable(keys: string): boolean {
  return [...keys].length === 1;
}

function sensitive(target: ResolvedTarget, state: ProbeState): boolean {
  return isSensitiveState(state, target.record.print.name);
}

/** Whether what the agent asked for is masked whatever the field says: a card number is printed nowhere. */
function sensitiveRequest(text: string): boolean {
  return looksLikeCardNumber(text.trim());
}

function receiptOf(
  action: string,
  target: ResolvedTarget,
  mechanism: Mechanism,
  extra: Partial<ActionReceipt>,
): ActionReceipt {
  return {
    action,
    target: `[${target.record.ref}] ${target.description}`,
    mechanism,
    dispatched: true,
    effect: { verdict: 'none', signals: [] },
    ...extra,
  };
}

/**
 * The read-back of a text value: equal is met; a difference is reported, not a failure. A field that cannot
 * be read (the submission navigated, or the field is gone) is not_checked: nothing was read, so nothing differs.
 */
function readBack(wanted: string, got: string | null, masked: boolean): ActionReceipt['postcondition'] {
  if (got === null) return { status: 'not_checked', detail: 'the value could not be read back' };
  if (masked) return { status: got === wanted ? 'met' : 'unmet', detail: 'value is masked' };
  if (got === wanted) return { status: 'met', detail: `read back ${quote(got)}` };
  return { status: 'unmet', detail: `read back ${quote(got ?? '')}, requested ${quote(wanted)}` };
}

/** Focuses a field with a trusted click; the key guard is armed after it. */
async function focusForText(ctx: ToolContext, target: ResolvedTarget, timeoutMs?: number) {
  const actionable = await waitForActionable(ctx, target, { pointer: true, editable: true, budgetMs: timeoutMs });
  const state = await stateOf(ctx, target);
  if (!state.focused) {
    const click = await dispatchClick(ctx, target, actionable.point, {});
    if (click.dialog) {
      recordDialog(ctx, click.dialog);
      throw new LayerError('MODAL_PENDING', 'A dialog opened when the field was focused; nothing was typed.', {
        delivered: true,
      });
    }
  }
}

function guardedOf(target: ResolvedTarget): GuardedElement {
  return {
    frame: target.frame,
    objectId: target.objectId,
    backendNodeId: target.record.backendNodeId,
    description: target.description,
  };
}

/**
 * Runs a key sequence under a key guard: `keys` sends one event at a time and returns a dialog that opened
 * meanwhile. Keys still down after an error are released; the guard is always removed. `judgeRelease` judges the
 * release of a key that activates on release (Space), for the sequences that can send one (null for the others).
 */
async function withKeyGuard<T>(
  ctx: ToolContext,
  arm: () => Promise<KeyGuard>,
  judgeRelease: ((key: string) => Promise<void>) | null,
  run: (keys: KeyPresser) => Promise<T>,
): Promise<T> {
  const guard = await arm();
  const keys = new KeyPresser(ctx, guard, (await ctx.attach()).page, judgeRelease ?? undefined);
  try {
    const result = await run(keys);
    await guard.finish();
    return result;
  } catch (error) {
    await keys.releaseAll();
    throw error;
  } finally {
    await guard.disarm();
  }
}

/** A dialog opened before the sequence ended: what was not sent is said, and the dialog is pending. */
function interrupted(ctx: ToolContext, dialog: DialogInfo, what: string): never {
  const detail = recordDialog(ctx, dialog);
  throw new LayerError('MODAL_PENDING', `A dialog opened (${detail}); ${what} Use handle_dialog.`, {
    delivered: true,
  });
}

/** What the gate judged, so that a later key can be classified again on the live page. */
interface Judged {
  frame: FrameRecord;
  backendNodeId: number;
  name: string;
  /** The name as printed, when `name` holds a masked value (`RefPrint.shown`). */
  shown?: string;
  role: string;
  description: string;
  action: string;
  gate: GateResult;
}

function judgedOf(target: ResolvedTarget, action: string, gate: GateResult): Judged {
  return {
    frame: target.frame,
    backendNodeId: target.record.backendNodeId,
    name: target.record.print.name,
    shown: target.record.print.shown,
    role: target.record.print.role,
    description: target.description,
    action,
    gate,
  };
}

/**
 * The role and name the gate classifies a live element by: Chrome's, or, for a node Chrome leaves out of the
 * accessibility tree (aria-hidden), the probe's approximation of its name. Hiding a control from accessibility does
 * not hide what it is from the gate.
 */
async function liveName(
  ctx: ToolContext,
  frame: FrameRecord,
  objectId: string,
  backendNodeId: number,
  fallbackRole: string,
): Promise<{ role: string; name: string }> {
  const ax = await axIdentity(ctx, frame, backendNodeId).catch(() => null);
  if (ax && 'role' in ax) return { role: ax.role || fallbackRole, name: ax.name };
  const name = await ctx
    .tab()
    .probe!.call<string>(frame, objectId, 'approximateName')
    .catch(() => '');
  return { role: fallbackRole, name };
}

/**
 * Before a key that submits or activates, after input has already reached the page (a click to focus, earlier
 * characters, a modifier, or the key's own keydown when its release is what activates): the element is classified
 * again on the live page, and policy layer 2 is checked again. The page may have changed what the key does (a field
 * moved into a payment form, a button turned into a submit button); a category the gate did not judge stops the
 * sequence, with nothing more sent. `next` names the input being judged, `what` says what was not sent.
 */
async function recheck(
  ctx: ToolContext,
  judged: Judged,
  modeOf: (state: ProbeState) => KeyMode,
  delivered: boolean,
  what: string,
  next = 'the next key',
): Promise<void> {
  const probe = ctx.tab().probe!;
  let objectId: string | undefined;
  try {
    objectId = await probe.resolve(judged.frame, judged.backendNodeId);
    const state = await probe.call<ProbeState>(judged.frame, objectId, 'state');
    const mode = modeOf(state);
    if (mode === 'none') return;
    const live = await liveName(ctx, judged.frame, objectId, judged.backendNodeId, judged.role);
    await assertJudged(
      ctx,
      {
        mode,
        frame: judged.frame,
        objectId,
        ...live,
        // The same name as the gate judged is printed the same way, so the two reasons can be compared.
        shown: live.name === judged.name ? judged.shown : undefined,
        description: judged.description,
        action: judged.action,
      },
      judged.gate,
      next,
    );
    await preflightNavigation(ctx, judged.frame, objectId, mode, judged.description);
  } catch (error) {
    throw afterInput(error, delivered, what);
  } finally {
    if (objectId) await probe.release(judged.frame, objectId);
  }
}

/**
 * The Enter of `submit: true` on a control that takes no typed text (a select, a date field): the control is
 * focused, and the key is guarded to it and judged again, since the control's events have already run.
 */
async function enterOn(
  ctx: ToolContext,
  target: ResolvedTarget,
  gate: GateResult,
  notSent: string,
): Promise<{ dialog?: DialogInfo }> {
  const { cdp } = await ctx.attach();
  await cdp.send(target.frame.sessionId, 'DOM.focus', { backendNodeId: target.record.backendNodeId });
  const options: KeyGuardOptions = {
    delivered: true,
    progress: arrived => (arrived ? 'Enter reached it.' : notSent),
  };
  return withKeyGuard(
    ctx,
    () => KeyGuard.arm(ctx, guardedOf(target), options),
    null,
    async keys => {
      await recheck(ctx, judgedOf(target, 'set', gate), () => 'enter', true, 'Enter was not sent.');
      return { dialog: await keys.press('Enter') };
    },
  );
}

/** Merges the built-in read-back with an explicit expectation: the expectation wins when given. */
function postcondition(
  builtIn: ActionReceipt['postcondition'],
  expected: ActionReceipt['postcondition'] | undefined,
  hasExpect: boolean,
): ActionReceipt['postcondition'] {
  return hasExpect ? expected : builtIn;
}

async function setText(
  ctx: ToolContext,
  target: ResolvedTarget,
  value: string,
  args: SetArgs,
  gate: GateResult,
): Promise<ToolOutcome> {
  await focusForText(ctx, target, args.timeoutMs);
  const { cdp } = await ctx.attach();
  const probe = ctx.tab().probe!;
  const before = await stateOf(ctx, target);
  const masked = sensitive(target, before) || sensitiveRequest(value);
  if (masked) rememberSecret(ctx.tab().secrets, value);
  if (args.submit) await preflightNavigation(ctx, target.frame, target.objectId, 'enter', target.description);
  checkCancelled(ctx);
  const options: KeyGuardOptions = {
    delivered: true,
    progress: arrived =>
      arrived === 0
        ? 'The value was not inserted.'
        : args.submit
          ? 'The value was inserted; Enter was not sent.'
          : 'The value was inserted.',
  };
  const { evidence } = await withEvidence(ctx, target, args.expect, { masked }, () =>
    withKeyGuard(
      ctx,
      () => KeyGuard.arm(ctx, guardedOf(target), options),
      null,
      async keys => {
        await probe.call(target.frame, target.objectId, 'selectContents');
        ctx.tab().actionSeq++;
        const dialog = await keys.unit(async () => {
          if (value === '') {
            await cdp.send(undefined, 'Input.dispatchKeyEvent', {
              type: 'rawKeyDown',
              key: 'Delete',
              code: 'Delete',
              windowsVirtualKeyCode: 46,
              commands: ['deleteForward'],
            });
            await cdp.send(undefined, 'Input.dispatchKeyEvent', {
              type: 'keyUp',
              key: 'Delete',
              code: 'Delete',
              windowsVirtualKeyCode: 46,
            });
          } else {
            await cdp.send(undefined, 'Input.insertText', { text: value });
          }
        });
        if (dialog && args.submit) interrupted(ctx, dialog, 'the value was inserted; Enter was not sent.');
        if (dialog) return { dialog };
        if (!args.submit) return {};
        await recheck(
          ctx,
          judgedOf(target, 'set', gate),
          () => 'enter',
          true,
          'The value was inserted; Enter was not sent.',
        );
        return { dialog: await keys.press('Enter') };
      },
    ),
  );
  const state = await stateOf(ctx, target).catch(() => null);
  const stillMasked = masked || (state ? sensitive(target, state) : false);
  const receipt = receiptOf('set', target, 'insert-text', {
    postcondition: postcondition(
      readBack(value, state?.value ?? null, stillMasked),
      evidence.postcondition,
      !!args.expect,
    ),
    effect: evidence.effect,
    navigation: evidence.navigation,
    newTab: evidence.newTab,
    ...(evidence.downloads ? { downloads: evidence.downloads } : {}),
  });
  return withPageState(ctx, args.observe, { receipt });
}

/** Declarative and idempotent: the control already has the value, so nothing is dispatched (and nothing judged). */
function toggleAlready(ctx: ToolContext, target: ResolvedTarget, wanted: boolean, args: SetArgs): Promise<ToolOutcome> {
  const receipt = receiptOf('set', target, 'pointer', {
    dispatched: false,
    postcondition: { status: 'met', detail: `already ${wanted ? 'checked' : 'unchecked'}` },
  });
  return withPageState(ctx, args.observe, { receipt });
}

/**
 * A toggle that needs changing is clicked, and the click is judged like any click: a checkbox named "Delete
 * account" is a delete. The gate's result goes to the pointer checks, which classify it again before the release.
 */
async function setToggle(
  ctx: ToolContext,
  target: ResolvedTarget,
  wanted: boolean,
  args: SetArgs,
  gate: GateResult,
): Promise<ToolOutcome> {
  const before = await stateOf(ctx, target);
  if (before.checked === wanted) return toggleAlready(ctx, target, wanted, args);
  const actionable = await waitForActionable(ctx, target, { pointer: true, budgetMs: args.timeoutMs });
  const { outcome: click, evidence } = await withEvidence(ctx, target, args.expect, {}, () =>
    dispatchClick(ctx, target, actionable.point, { gate }),
  );
  const after = await stateOf(ctx, target).catch(() => null);
  if (!evidence.dialog && !evidence.navigation && after?.checked !== wanted) {
    throw new LayerError(
      'STATE_UNCHANGED',
      `${target.description} is still ${after?.checked ? 'checked' : 'unchecked'} after the click`,
      {
        delivered: true,
      },
    );
  }
  const receipt = receiptOf('set', target, 'pointer', {
    dispatched: click.dispatched,
    reachedTarget: click.reachedTarget,
    effect: evidence.effect,
    navigation: evidence.navigation,
    newTab: evidence.newTab,
    ...(evidence.downloads ? { downloads: evidence.downloads } : {}),
    postcondition: postcondition(
      {
        status: after?.checked === wanted ? 'met' : 'not_checked',
        detail: `${after?.checked ? 'checked' : 'unchecked'}`,
      },
      evidence.postcondition,
      !!args.expect,
    ),
  });
  return withPageState(ctx, args.observe, { receipt });
}

async function setSelect(
  ctx: ToolContext,
  target: ResolvedTarget,
  values: string[],
  args: SetArgs,
  gate: GateResult,
): Promise<ToolOutcome> {
  await waitForActionable(ctx, target, { pointer: false, budgetMs: args.timeoutMs });
  // Option values of a sensitive select (saved cards) are never printed, in an error or in the read-back.
  const hide = sensitive(target, await stateOf(ctx, target));
  let requested: SelectedOption[] = [];
  const { evidence } = await withEvidence(ctx, target, args.expect, {}, async () => {
    const result = await ctx.tab().probe!.call<OptionResult>(target.frame, target.objectId, 'selectOption', values);
    if (!result.ok) {
      // Each requested value is checked on its own: the problem can be several of them joined.
      const asked =
        hide || values.some(sensitiveRequest) || looksLikeCardNumber(result.problem ?? '')
          ? 'the value given (masked)'
          : quote(result.problem);
      throw new LayerError(
        result.error!,
        `${result.error === 'NO_SUCH_OPTION' ? 'No option' : 'More than one option'} of ${target.description} matches ${asked}. Options: ${result.options.map(o => listedOption(o, hide)).join('; ')}`,
      );
    }
    ctx.tab().actionSeq++;
    requested = result.requested ?? [];
    if (!args.submit) return {};
    return enterOn(ctx, target, gate, 'The option was selected; Enter was not sent.');
  });
  // A change handler may have made the select sensitive (a one-time-code field): what it was before and what it is
  // now both count, and a select that cannot be read now is treated as sensitive.
  const now = await stateOf(ctx, target).catch(() => null);
  const masked = hide || !now || sensitive(target, now);
  // Read back after settle: a change handler may have changed the selection, at once or later. Options are
  // compared by index and value; two options can share a label.
  const live = await ctx
    .tab()
    .probe!.call<SelectedOption[]>(target.frame, target.objectId, 'selectedOptions')
    .catch(() => null);
  const id = (o: SelectedOption) => `${o.index}|${o.value}`;
  const same = !!live && live.length === requested.length && requested.every(r => live.some(l => id(l) === id(r)));
  const shown = [...(live ?? []), ...requested];
  const sharedLabel = shown.some(a => shown.some(b => a.label === b.label && id(a) !== id(b)));
  const quoted = (options: SelectedOption[]) => options.map(o => quotedOption(o, masked, sharedLabel)).join(', ');
  const readBackSelect: ActionReceipt['postcondition'] =
    live === null
      ? { status: 'not_checked', detail: 'the select could not be read back' }
      : same
        ? { status: 'met', detail: `selected ${quoted(live)}` }
        : {
            status: 'unmet',
            detail: `selected ${live.length ? quoted(live) : 'nothing'}, requested ${quoted(requested)}`,
          };
  const receipt = receiptOf('set', target, 'select-option', {
    effect: evidence.effect,
    navigation: evidence.navigation,
    ...(evidence.downloads ? { downloads: evidence.downloads } : {}),
    postcondition: postcondition(readBackSelect, evidence.postcondition, !!args.expect),
  });
  return withPageState(ctx, args.observe, { receipt });
}

async function setNative(
  ctx: ToolContext,
  target: ResolvedTarget,
  value: string,
  args: SetArgs,
  gate: GateResult,
): Promise<ToolOutcome> {
  await waitForActionable(ctx, target, { pointer: false, budgetMs: args.timeoutMs });
  const before = await stateOf(ctx, target);
  let got = '';
  const { evidence } = await withEvidence(ctx, target, args.expect, { masked: sensitiveRequest(value) }, async () => {
    ctx.tab().actionSeq++;
    got = await ctx.tab().probe!.call<string>(target.frame, target.objectId, 'setNativeValue', value);
    if (!args.submit) return {};
    return enterOn(ctx, target, gate, 'The value was set; Enter was not sent.');
  });
  // Read back after settle: a handler may put the value back, at once or later.
  const after = await stateOf(ctx, target).catch(() => null);
  const masked = sensitive(target, before) || sensitiveRequest(value) || (after ? sensitive(target, after) : false);
  const receipt = receiptOf('set', target, 'set-value', {
    effect: evidence.effect,
    navigation: evidence.navigation,
    newTab: evidence.newTab,
    ...(evidence.downloads ? { downloads: evidence.downloads } : {}),
    postcondition: postcondition(
      after
        ? readBack(value, after.value, masked)
        : {
            status: 'not_checked',
            detail: masked
              ? 'the value could not be read back (masked)'
              : `the value could not be read back (it was ${quote(got)} when set)`,
          },
      evidence.postcondition,
      !!args.expect,
    ),
  });
  return withPageState(ctx, args.observe, { receipt });
}

/** Runs fn on the gated target, adds the gate's record to the receipt, and releases a re-resolved target. */
async function withReleased(
  ctx: ToolContext,
  original: ResolvedTarget,
  current: ResolvedTarget,
  fn: () => Promise<ToolOutcome>,
  gate: GateResult,
): Promise<ToolOutcome> {
  try {
    const outcome = await fn();
    if (outcome.receipt) Object.assign(outcome.receipt, sensitivity(gate));
    return outcome;
  } finally {
    if (current !== original) await ctx.tab().probe?.release(current.frame, current.objectId);
  }
}

/** Runs the gate on a resolved target and re-resolves it when the user was asked. */
async function gateOn(
  ctx: ToolContext,
  target: ResolvedTarget,
  action: string,
  mode: 'activate' | 'enter' | 'none',
  intent: string | undefined,
  needs: { pointer: boolean; editable?: boolean; budgetMs?: number },
  textInput = false,
): Promise<{ target: ResolvedTarget; gate: GateResult }> {
  const prepare = async (t: ResolvedTarget) => {
    await waitForActionable(ctx, t, needs);
    // Policy layer 2 before the user is asked: a refused destination needs no approval.
    if (mode === 'enter') await preflightNavigation(ctx, t.frame, t.objectId, 'enter', t.description);
    return { target: t };
  };
  const { state, gate } = await gateTarget(ctx, await prepare(target), { action, mode, intent, textInput }, prepare);
  return { target: state.target, gate };
}

interface FocusedKey {
  frame: FrameRecord;
  backendNodeId: number;
  name: string;
  role: string;
  description: string;
}

/**
 * The focused element as a gate input: its accessibility role and name, for a target-less key; inside
 * closed shadow roots too (focusedElement). Returns the element the gate judged, so the caller can check the keys go
 * to it, or null when nothing has focus.
 */
async function gateFocused(
  ctx: ToolContext,
  action: string,
  modeOf: (state: ProbeState) => KeyMode,
  intent: string | undefined,
  textInput = false,
): Promise<{ gate: GateResult; focused: FocusedKey | null }> {
  const focused = await focusedElement(ctx);
  if (!focused) {
    const gate = await confirmGate(ctx, {
      action,
      mode: 'none',
      frame: (await (await ctx.attach()).topology.frames())[0],
      objectId: '',
      name: '',
      role: '',
      description: 'the page (nothing has focus)',
      intent,
    });
    return { gate, focused: null };
  }
  const probe = ctx.tab().probe!;
  try {
    const state = await probe.call<ProbeState>(focused.frame, focused.objectId, 'state');
    const { role, name } = await liveName(ctx, focused.frame, focused.objectId, focused.backendNodeId, state.tag);
    const description = `the focused ${role}${name ? ` ${quote(name)}` : ''}`;
    const gate = await confirmGate(ctx, {
      action,
      mode: modeOf(state),
      frame: focused.frame,
      objectId: focused.objectId,
      name,
      role,
      description,
      intent,
      textInput,
    });
    if (gate.prompted) {
      // The key goes to whatever has focus; after the user decided, it must still be the element they approved.
      const now = await focusedElement(ctx);
      if (now) await probe.release(now.frame, now.objectId);
      if (!now || now.backendNodeId !== focused.backendNodeId || now.frame.frameId !== focused.frame.frameId) {
        throw new LayerError('TARGET_CHANGED', `Focus moved while the user decided; ${action} was not sent.`);
      }
    }
    return { gate, focused: { frame: focused.frame, backendNodeId: focused.backendNodeId, name, role, description } };
  } finally {
    await probe.release(focused.frame, focused.objectId);
  }
}

/**
 * Arms the key guard for a target-less `type` or `press`, after checking focus is where the gate judged it: on the
 * focused element, or, when nothing had focus, on the body of the focused document (the document guard), so a page
 * that moves focus to a control during the keys gets none of them.
 */
async function armFocusedGuard(
  ctx: ToolContext,
  judged: FocusedKey | null,
  action: string,
  options: KeyGuardOptions,
): Promise<KeyGuard> {
  const moved = () => new LayerError('TARGET_CHANGED', `Focus moved before ${action} was sent; nothing was sent.`);
  const now = await focusedElement(ctx);
  const probe = ctx.tab().probe!;
  if (!now) {
    if (judged) throw moved();
    // The document whose body has focus gets the keys; with none reported, the main frame's.
    const frames = [...(await (await ctx.attach()).topology.frames())].sort((a, b) => b.depth - a.depth);
    let frame = frames[frames.length - 1];
    for (const f of frames) {
      if (await probe.callGlobal<boolean>(f, 'documentFocused').catch(() => false)) {
        frame = f;
        break;
      }
    }
    return KeyGuard.arm(ctx, { frame, description: 'the page (nothing has focus)' }, options);
  }
  try {
    if (!judged || now.backendNodeId !== judged.backendNodeId || now.frame.frameId !== judged.frame.frameId) {
      throw moved();
    }
    return await KeyGuard.arm(
      ctx,
      { frame: now.frame, objectId: now.objectId, backendNodeId: now.backendNodeId, description: judged.description },
      options,
    );
  } finally {
    await probe.release(now.frame, now.objectId);
  }
}

export async function set(ctx: ToolContext, args: SetArgs): Promise<ToolOutcome> {
  assertNoModal(ctx);
  return withTarget(ctx, args.target, async target => {
    const state = await stateOf(ctx, target);
    const role = target.record.print.role;
    const toggle =
      TOGGLE_ROLES.has(role) || state.type === 'checkbox' || state.type === 'radio' || state.checked !== null;
    if (toggle && state.tag !== 'select') {
      const wanted =
        typeof args.value === 'boolean'
          ? args.value
          : args.value === 'true'
            ? true
            : args.value === 'false'
              ? false
              : null;
      if (wanted === null) throw new LayerError('INVALID_ARGUMENT', `${target.description} takes true or false`);
      // Enter on a toggle is not how a form is sent here: refused before anything, whatever the toggle's state.
      if (args.submit) {
        throw new LayerError(
          'INVALID_ARGUMENT',
          `submit is not supported on ${target.description}. Set the toggle, then activate the form's submit control.`,
        );
      }
      if (state.checked === wanted) return toggleAlready(ctx, target, wanted, args);
      if (!wanted && (state.type === 'radio' || role === 'radio')) {
        throw new LayerError(
          'NOT_INTERACTABLE',
          `${target.description} is a radio button; it is unchecked by checking another one`,
        );
      }
      const gated = await gateOn(ctx, target, 'set', 'activate', args.intent, {
        pointer: true,
        budgetMs: args.timeoutMs,
      });
      return withReleased(
        ctx,
        target,
        gated.target,
        () => setToggle(ctx, gated.target, wanted, args, gated.gate),
        gated.gate,
      );
    }
    if (state.tag === 'select') {
      const values = Array.isArray(args.value) ? args.value : [String(args.value)];
      const gated = await gateOn(
        ctx,
        target,
        'set',
        args.submit ? 'enter' : 'none',
        args.intent,
        {
          pointer: false,
          budgetMs: args.timeoutMs,
        },
        true,
      );
      return withReleased(
        ctx,
        target,
        gated.target,
        () => setSelect(ctx, gated.target, values, args, gated.gate),
        gated.gate,
      );
    }
    if (typeof args.value !== 'string')
      throw new LayerError('INVALID_ARGUMENT', `${target.description} takes a text value`);
    const value = args.value;
    if (state.tag === 'input' && NATIVE_VALUE_TYPES.has(state.type)) {
      // Enter in a colour field opens its picker instead of submitting: refused before the user is asked.
      if (args.submit && state.type === 'color') {
        throw new LayerError(
          'INVALID_ARGUMENT',
          `submit is not supported on ${target.description}: Enter opens a colour field's picker. Set the value, then activate the form's submit control.`,
        );
      }
      const gated = await gateOn(
        ctx,
        target,
        'set',
        args.submit ? 'enter' : 'none',
        args.intent,
        {
          pointer: false,
          budgetMs: args.timeoutMs,
        },
        true,
      );
      return withReleased(
        ctx,
        target,
        gated.target,
        () => setNative(ctx, gated.target, value, args, gated.gate),
        gated.gate,
      );
    }
    if (state.editable || state.contentEditable || state.tag === 'input' || state.tag === 'textarea') {
      const gated = await gateOn(
        ctx,
        target,
        'set',
        args.submit ? 'enter' : 'none',
        args.intent,
        {
          pointer: true,
          editable: true,
          budgetMs: args.timeoutMs,
        },
        true,
      );
      return withReleased(
        ctx,
        target,
        gated.target,
        () => setText(ctx, gated.target, value, args, gated.gate),
        gated.gate,
      );
    }
    throw new LayerError(
      'NOT_INTERACTABLE',
      `${target.description} is not a field, toggle or select that set can change`,
    );
  });
}

export async function type(ctx: ToolContext, args: TypeArgs): Promise<ToolOutcome> {
  assertNoModal(ctx);
  await ctx.attach();
  // Typing presses a key for "\n", "\r" and " ": they submit or activate like press Enter or Space.
  const modeOf = (state: ProbeState) => typedMode(args.text, !!args.submit, state);
  const chars = [...args.text];
  const options: KeyGuardOptions = {
    delivered: false,
    progress: arrived =>
      arrived === 0
        ? 'No text reached it.'
        : arrived < chars.length
          ? `${arrived} of ${chars.length} characters reached it; the rest was not sent.`
          : args.submit
            ? 'All the text reached it; Enter was not sent.'
            : 'All the text reached it.',
  };
  const run = async (target: ResolvedTarget | null): Promise<ToolOutcome> => {
    let gate: GateResult;
    let judged: FocusedKey | null = null;
    let mode: KeyMode = 'none';
    if (target) {
      // The target is editable: Space types a space, Enter may submit its form.
      mode = args.submit ? 'enter' : typedMode(args.text, false, await stateOf(ctx, target));
      const gated = await gateOn(
        ctx,
        target,
        'type',
        mode,
        args.intent,
        {
          pointer: true,
          editable: true,
          budgetMs: args.timeoutMs,
        },
        true,
      );
      if (gated.target !== target) {
        await ctx.tab().probe?.release(target.frame, target.objectId);
        target = gated.target;
      }
      gate = gated.gate;
      await focusForText(ctx, target, args.timeoutMs);
    } else {
      await preflightKeys(ctx, null, modeOf);
      const gated = await gateFocused(ctx, 'type', modeOf, args.intent, true);
      gate = gated.gate;
      judged = gated.focused;
    }
    const masked = sensitiveRequest(args.text) || (target ? sensitive(target, await stateOf(ctx, target)) : false);
    if (masked) rememberSecret(ctx.tab().secrets, args.text);
    if (target && mode === 'enter')
      await preflightNavigation(ctx, target.frame, target.objectId, 'enter', target.description);
    checkCancelled(ctx);
    const arm = () =>
      target
        ? KeyGuard.arm(ctx, guardedOf(target), { ...options, delivered: true })
        : armFocusedGuard(ctx, judged, 'type', options);
    // What a key does is judged again before each newline or space, and before the submitting Enter.
    const again: Judged | null = target
      ? judgedOf(target, 'type', gate)
      : judged && { ...judged, action: 'type', gate };
    // A typed space is a Space press, whose release activates a button or a checkbox: judged again before it.
    const judgeRelease =
      again &&
      (() =>
        recheck(
          ctx,
          again,
          state => typedMode(' ', false, state),
          true,
          'Space was pressed; its release was withheld from the page, and the rest was not sent.',
          'releasing Space',
        ));
    // One character at a time, each checked by the guard before it is sent.
    const { evidence } = await withEvidence(ctx, target, args.expect, { masked }, () =>
      withKeyGuard(ctx, arm, judgeRelease, async keys => {
        ctx.tab().actionSeq++;
        for (let i = 0; i < chars.length; i++) {
          const key = dispatchedKey(chars[i]);
          if (again && (key === 'Enter' || key === 'Space')) {
            await recheck(
              ctx,
              again,
              state => typedMode(chars[i], false, state),
              !!target || i > 0,
              `${i} of ${chars.length} characters were sent; the rest was not.`,
            );
          }
          const dialog = await keys.type(chars[i]);
          if (dialog && (i < chars.length - 1 || args.submit))
            interrupted(ctx, dialog, `${i + 1} of ${chars.length} characters were sent; the rest was not.`);
          if (dialog) return { dialog };
        }
        if (!args.submit) return {};
        if (again) {
          await recheck(
            ctx,
            again,
            state => (target ? 'enter' : keyMode('Enter', state)),
            true,
            'All the text was sent; Enter was not.',
          );
        }
        return { dialog: await keys.press('Enter') };
      }),
    );
    const receipt: ActionReceipt = {
      ...sensitivity(gate),
      action: 'type',
      target: target ? `[${target.record.ref}] ${target.description}` : 'the focused element',
      mechanism: 'keyboard',
      dispatched: true,
      effect: evidence.effect,
      navigation: evidence.navigation,
      newTab: evidence.newTab,
      ...(evidence.downloads ? { downloads: evidence.downloads } : {}),
      postcondition: evidence.postcondition,
    };
    if (target && !args.expect) {
      const state = await stateOf(ctx, target).catch(() => null);
      receipt.postcondition =
        masked || (state && sensitive(target, state))
          ? { status: 'not_checked', detail: 'value is masked' }
          : { status: 'not_checked', detail: `read back ${quote(state?.value ?? '')}` };
    }
    return withPageState(ctx, args.observe, { receipt });
  };
  return args.target ? withTarget(ctx, args.target, run) : run(null);
}

/**
 * Policy layer 2 for keys: Enter in a field submits its form, Enter or Space on a link or button activates it.
 * Without a target the focused element is checked.
 */
async function preflightKeys(
  ctx: ToolContext,
  target: ResolvedTarget | null,
  modeOf: (state: ProbeState) => KeyMode,
): Promise<void> {
  const probe = ctx.tab().probe!;
  const focused = target ? null : await focusedElement(ctx);
  const frame = target?.frame ?? focused?.frame;
  const objectId = target?.objectId ?? focused?.objectId;
  if (!frame || !objectId) return;
  try {
    const state = await probe.call<ProbeState>(frame, objectId, 'state');
    const mode = modeOf(state);
    if (mode === 'none') return;
    await preflightNavigation(ctx, frame, objectId, mode, target?.description ?? `The focused ${state.tag}`);
  } finally {
    if (focused) await probe.release(focused.frame, focused.objectId);
  }
}

export async function press(ctx: ToolContext, args: PressArgs): Promise<ToolOutcome> {
  assertNoModal(ctx);
  const attachment = await ctx.attach();
  // An element that does not take focus makes DOM.focus fail; the key guard then finds focus elsewhere and refuses
  // with INTERCEPTED, nothing sent.
  const focus = (target: ResolvedTarget) =>
    attachment.cdp
      .send(target.frame.sessionId, 'DOM.focus', { backendNodeId: target.record.backendNodeId })
      .catch(error => {
        if (!(error instanceof Error) || error.name !== 'CdpCommandError') throw error;
      });
  const run = async (target: ResolvedTarget | null): Promise<ToolOutcome> => {
    if (target) {
      // The target is focused, not clicked: a click would itself activate a button.
      await waitForActionable(ctx, target, { pointer: false, budgetMs: args.timeoutMs });
      await focus(target);
    }
    // The chord as it will be pressed: an unknown key or modifier is refused before anything is sent.
    const chord = attachment.page.chord(args.keys);
    const { key } = splitChord(args.keys);
    const modeOf = (state: ProbeState) => keyMode(key, state);
    await preflightKeys(ctx, target, modeOf);
    let gate: GateResult;
    let judged: FocusedKey | null = null;
    if (target) {
      const state = await stateOf(ctx, target);
      const gated = await gateOn(
        ctx,
        target,
        `press ${args.keys}`,
        modeOf(state),
        args.intent,
        {
          pointer: false,
          budgetMs: args.timeoutMs,
        },
        printable(args.keys),
      );
      gate = gated.gate;
      if (gated.target !== target) {
        await ctx.tab().probe?.release(target.frame, target.objectId);
        target = gated.target;
      }
      await focus(target);
    } else {
      const gated = await gateFocused(ctx, `press ${args.keys}`, modeOf, args.intent, printable(args.keys));
      gate = gated.gate;
      judged = gated.focused;
    }
    // The key is guarded to the element the gate judged: a focus handler that moved focus, or a page that moves
    // it during the key, gets nothing.
    const options: KeyGuardOptions = {
      delivered: false,
      progress: (arrived, sent) =>
        arrived ? `${args.keys} reached it.` : sent ? `${args.keys} did not reach it.` : `${args.keys} was not sent.`,
    };
    const arm = () =>
      target
        ? KeyGuard.arm(ctx, guardedOf(target), options)
        : armFocusedGuard(ctx, judged, `press ${args.keys}`, options);
    const again: Judged | null = target
      ? judgedOf(target, `press ${args.keys}`, gate)
      : judged && { ...judged, action: `press ${args.keys}`, gate };
    checkCancelled(ctx);
    // Releasing Space is what activates, after the keydown's handlers ran: judged again before the release.
    const judgeRelease =
      again &&
      ((released: string) =>
        recheck(
          ctx,
          again,
          modeOf,
          true,
          `${released} was pressed; its release was withheld from the page.`,
          `releasing ${released}`,
        ));
    // One key event at a time: a dialog opened by a modifier stops the chord before its key.
    const { evidence } = await withEvidence(ctx, target, args.expect, {}, () =>
      withKeyGuard(ctx, arm, judgeRelease, async keys => {
        ctx.tab().actionSeq++;
        for (const modifier of chord.modifiers) {
          const dialog = await keys.down(modifier);
          if (dialog) return { dialog };
        }
        // What the key does is judged again after the focus and the modifiers reached the page.
        if (again) await recheck(ctx, again, modeOf, chord.modifiers.length > 0, `${chord.key} was not sent.`);
        const dialog = await keys.press(chord.key);
        if (dialog) return { dialog };
        for (const modifier of [...chord.modifiers].reverse()) {
          const released = await keys.up(modifier);
          if (released) return { dialog: released };
        }
        return {};
      }),
    );
    const receipt: ActionReceipt = {
      ...sensitivity(gate),
      action: 'press',
      target: target
        ? `[${target.record.ref}] ${target.description} · ${args.keys}`
        : `${args.keys} on the focused element`,
      mechanism: 'keyboard',
      dispatched: true,
      effect: evidence.effect,
      navigation: evidence.navigation,
      newTab: evidence.newTab,
      ...(evidence.downloads ? { downloads: evidence.downloads } : {}),
      postcondition: evidence.postcondition,
    };
    return withPageState(ctx, args.observe, { receipt });
  };
  return args.target ? withTarget(ctx, args.target, run) : run(null);
}

export { MASK };
