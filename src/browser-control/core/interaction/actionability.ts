// Actionability: Playwright's checks, done with CDP, with the hit test repeated up the frame chain.
// Every retry happens here, before anything is dispatched.
import { LayerError } from '../../protocol/errors';
import type { ProbeState, HitVerdict } from '../../probe';
import type { ToolContext } from '../controller';
import { checkCancelled } from '../controller';
import type { FrameRecord } from '../ports';
import { NodeArg } from '../probe-client';
import type { ChainStep, Point, Quad } from '../geometry';
import { chainToTop, nodeAtViewportPoint, quadArea, quadCenter, sessionRoot } from '../geometry';
import type { AXNode } from '../perception/ax';
import { cleanText } from '../perception/ax';
import { assertAsShown } from './resolve';
import type { ResolvedTarget } from './resolve';
import { quote } from '../text';

/** The budget: 5 s; re-check at 0, 20, 100, 100, 500 ms, then every 500 ms. */
export const ACTIONABILITY_BUDGET_MS = 5_000;
const SCHEDULE = [0, 20, 100, 100, 500];
const STABLE_GAP_MS = 50;
const STABLE_TOLERANCE_PX = 2;

export interface Needs {
  /** Pointer actions need the hit test; text actions need an editable target. */
  pointer: boolean;
  editable?: boolean;
  budgetMs?: number;
  /**
   * For hover and scroll: a control inside the target may be at the point. The pointer only moves or turns the
   * wheel there, which activates nothing, so the rule against nested controls (made for clicks) does not apply.
   */
  overControls?: boolean;
}

export interface Actionable {
  /** Top-level viewport point: what is checked at every level is what is clicked. */
  point: Point;
  /** The same point in the target's session root viewport. */
  localPoint: Point;
  chain: ChainStep[];
  quad: Quad;
  state: ProbeState;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const TERMINAL = new Set(['NODE_DETACHED', 'TARGET_CHANGED', 'NOT_INTERACTABLE', 'FRAME_DETACHED', 'STALE_DOCUMENT']);

export async function waitForActionable(ctx: ToolContext, target: ResolvedTarget, needs: Needs): Promise<Actionable> {
  const budget = needs.budgetMs ?? ACTIONABILITY_BUDGET_MS;
  const start = performance.now();
  let attempt = 0;
  for (;;) {
    checkCancelled(ctx);
    try {
      return await checkOnce(ctx, target, needs);
    } catch (error) {
      if (!(error instanceof LayerError) || TERMINAL.has(error.code) || nestedHit(error)) throw error;
      const wait = SCHEDULE[Math.min(attempt + 1, SCHEDULE.length - 1)];
      if (performance.now() - start + wait > budget) throw error;
      attempt++;
      await sleep(wait);
    }
  }
}

/** A control inside the target is at its click point: part of the page's structure, not something to wait out. */
function nestedHit(error: LayerError): boolean {
  return error.code === 'OBSCURED' && (error.details as { kind?: string } | undefined)?.kind === 'nested';
}

async function scrollIntoView(ctx: ToolContext, target: ResolvedTarget): Promise<void> {
  const { cdp } = await ctx.attach();
  await cdp
    .send(target.frame.sessionId, 'DOM.scrollIntoViewIfNeeded', { backendNodeId: target.record.backendNodeId })
    .catch(() => undefined);
  // An out-of-process frame scrolls only its own document; bring each owner iframe into view in its parent too.
  const byId = new Map(target.frames.map(f => [f.frameId, f]));
  let root = sessionRoot(target.frames, target.frame);
  while (root.parentFrameId) {
    const parent = byId.get(root.parentFrameId);
    if (!parent) break;
    try {
      const { backendNodeId } = await cdp.send<{ backendNodeId: number }>(parent.sessionId, 'DOM.getFrameOwner', {
        frameId: root.frameId,
      });
      await cdp.send(parent.sessionId, 'DOM.scrollIntoViewIfNeeded', { backendNodeId });
    } catch {
      // The frame is going away; the checks below report it.
    }
    root = sessionRoot(target.frames, parent);
  }
}

async function firstQuad(ctx: ToolContext, target: ResolvedTarget): Promise<Quad | null> {
  const { cdp } = await ctx.attach();
  try {
    const { quads } = await cdp.send<{ quads: Quad[] }>(target.frame.sessionId, 'DOM.getContentQuads', {
      backendNodeId: target.record.backendNodeId,
    });
    return quads.find(q => quadArea(q) > 0) ?? null;
  } catch {
    return null;
  }
}

async function checkOnce(ctx: ToolContext, target: ResolvedTarget, needs: Needs): Promise<Actionable> {
  const probe = ctx.tab().probe!;
  const name = target.description;
  const state = await probe.call<ProbeState>(target.frame, target.objectId, 'state');
  if (!state.connected) throw new LayerError('NODE_DETACHED', `${name} is no longer in the page`);
  await scrollIntoView(ctx, target);
  if (!state.enabled) throw new LayerError('DISABLED', `${name} is disabled`);
  if (needs.editable && !state.editable) throw new LayerError('NOT_EDITABLE', `${name} does not accept text`);
  let quad = state.visible ? await firstQuad(ctx, target) : null;
  // A hidden native checkbox or radio is clicked through its visible label, at a point off any link or control
  // inside the label.
  const viaLabel = !quad && needs.pointer && (state.type === 'checkbox' || state.type === 'radio');
  const pointOf = async (): Promise<{ quad: Quad; point: Point } | null> => {
    if (!viaLabel) {
      const q = await firstQuad(ctx, target);
      return q ? { quad: q, point: quadCenter(q) } : null;
    }
    return labelPoint(ctx, target);
  };
  if (!state.visible && !viaLabel) throw new LayerError('NOT_VISIBLE', `${name} is not visible`);
  const first = await pointOf();
  if (!first)
    throw new LayerError(
      'NOT_VISIBLE',
      viaLabel ? `${name} is hidden and has no label to click` : `${name} has no box on the page`,
    );
  quad = first.quad;
  await sleep(STABLE_GAP_MS);
  const second = await pointOf();
  const again = second?.quad;
  const a = first.point;
  const b = second ? second.point : null;
  if (!b || Math.abs(a.x - b.x) > STABLE_TOLERANCE_PX || Math.abs(a.y - b.y) > STABLE_TOLERANCE_PX) {
    throw new LayerError('NOT_STABLE', `${name} is moving`);
  }
  const { cdp } = await ctx.attach();
  const chain = await chainToTop(cdp, target.frames, target.frame, b, root => probe.callGlobal(root, 'viewport'));
  const top = chain[chain.length - 1].point;
  const metrics = await cdp.send<{ cssLayoutViewport: { clientWidth: number; clientHeight: number } }>(
    undefined,
    'Page.getLayoutMetrics',
  );
  if (
    top.x < 0 ||
    top.y < 0 ||
    top.x >= metrics.cssLayoutViewport.clientWidth ||
    top.y >= metrics.cssLayoutViewport.clientHeight
  ) {
    throw new LayerError('NOT_VISIBLE', `${name} is outside the visible part of the page`);
  }
  if (needs.pointer) await hitTest(ctx, target, b, chain, !!needs.overControls);
  // The wait above can last seconds, and it scrolls: the element that is now actionable must still be the one the
  // session was shown. A node hidden when it was resolved had nothing to compare until now.
  await assertAsShown(ctx, target, { context: true });
  return { point: top, localPoint: b, chain, quad: again!, state };
}

/** The receives-events check: in the target's session, then at every process boundary up to the top. */
async function hitTest(
  ctx: ToolContext,
  target: ResolvedTarget,
  local: Point,
  chain: ChainStep[],
  overControls = false,
): Promise<void> {
  const { cdp } = await ctx.attach();
  const probe = ctx.tab().probe!;
  const sessionId = target.frame.sessionId;
  const hit = await nodeAtViewportPoint(cdp, sessionId, local);
  if (!hit) throw new LayerError('NOT_VISIBLE', `Nothing is at the click point of ${target.description}`);
  const hitFrame = target.frames.find(f => f.frameId === hit.frameId);
  if (hit.frameId === target.frame.frameId) {
    const hitObject = await probe.resolve(target.frame, hit.backendNodeId);
    try {
      const verdict = await probe.call<HitVerdict>(target.frame, target.objectId, 'hitAccepts', new NodeArg(hitObject));
      if (!verdict.accepted && !(overControls && verdict.kind === 'nested')) {
        const covering = await nameCovering(ctx, target.frame, hit.backendNodeId);
        if (verdict.kind === 'nested') {
          // A separate control inside the target (a "Pay" button inside a clickable card) would take the click,
          // and it was not what was classified.
          throw new LayerError(
            'OBSCURED',
            `The click point of ${target.description} is on ${covering}, a separate control inside it, which would take the click.`,
            {
              details: { covering, kind: verdict.kind },
              hint: 'A control inside the target is at its centre. Act on that control by its own ref if that is what you mean, or choose another element.',
            },
          );
        }
        const message =
          verdict.kind === 'ancestor'
            ? `${target.description} does not take pointer events; its container ${covering} would receive the click.`
            : `${target.description} is covered by ${covering} at its click point.`;
        throw new LayerError('OBSCURED', message, { details: { covering, kind: verdict.kind } });
      }
    } finally {
      await probe.release(target.frame, hitObject);
    }
  } else {
    const covering = hitFrame
      ? await nameCovering(ctx, hitFrame, hit.backendNodeId)
      : `an element in frame ${hit.frameId}`;
    throw new LayerError('OBSCURED', `${target.description} is covered by ${covering} at its click point.`, {
      details: { covering },
    });
  }
  // Up the chain: in each parent session, the converted point must hit the owner iframe element itself.
  for (let i = 0; i < chain.length - 1; i++) {
    const owner = chain[i].owner!;
    const point = chain[i + 1].point;
    const up = await nodeAtViewportPoint(cdp, owner.sessionId, point);
    if (up && up.backendNodeId === owner.backendNodeId) continue;
    const frame = up ? target.frames.find(f => f.frameId === up.frameId) : undefined;
    const covering = up && frame ? await nameCovering(ctx, frame, up.backendNodeId) : 'nothing (outside the page)';
    const where = frame && frame.parentFrameId ? ` in frame ${quote(frame.url)}` : ' in the page';
    throw new LayerError('OBSCURED', `${target.description} is covered by ${covering}${where} at its click point.`, {
      details: { covering, level: i + 1 },
    });
  }
}

/**
 * Names the element at a point for a message: the nearest element with an accessibility role and name, its ref when
 * it has one, and the element itself (tag, id, classes, text).
 */
/** The click point of a hidden checkbox or radio on its label, in the session root's viewport. */
async function labelPoint(ctx: ToolContext, target: ResolvedTarget): Promise<{ quad: Quad; point: Point } | null> {
  const probe = ctx.tab().probe!;
  const fractions = await probe.call<{ fx: number; fy: number } | null>(target.frame, target.objectId, 'labelPoint');
  if (!fractions) return null;
  const label = await probe.callForNode(target.frame, target.objectId, 'labelFor');
  if (label === null) return null;
  const { cdp } = await ctx.attach();
  const { quads } = await cdp.send<{ quads: Quad[] }>(target.frame.sessionId, 'DOM.getContentQuads', {
    backendNodeId: label,
  });
  const quad = quads.find(q => quadArea(q) > 0);
  if (!quad) return null;
  const b = quad;
  // Bilinear position inside the quad, so the point follows a transformed label too.
  const top = { x: b[0] + (b[2] - b[0]) * fractions.fx, y: b[1] + (b[3] - b[1]) * fractions.fx };
  const bottom = { x: b[6] + (b[4] - b[6]) * fractions.fx, y: b[7] + (b[5] - b[7]) * fractions.fx };
  return {
    quad,
    point: { x: top.x + (bottom.x - top.x) * fractions.fy, y: top.y + (bottom.y - top.y) * fractions.fy },
  };
}

export async function nameCovering(ctx: ToolContext, frame: FrameRecord, backendNodeId: number): Promise<string> {
  const { cdp } = await ctx.attach();
  const probe = ctx.tab().probe!;
  let element = `node ${backendNodeId}`;
  try {
    const objectId = await probe.resolve(frame, backendNodeId);
    element = await probe.call<string>(frame, objectId, 'describe');
    await probe.release(frame, objectId);
  } catch {
    // Described by its ID only.
  }
  try {
    const { nodes } = await cdp.send<{ nodes: AXNode[] }>(frame.sessionId, 'Accessibility.getPartialAXTree', {
      backendNodeId,
      fetchRelatives: true,
    });
    const byId = new Map(nodes.map(n => [n.nodeId, n]));
    let node = nodes.find(n => n.backendDOMNodeId === backendNodeId);
    while (node) {
      const role = typeof node.role?.value === 'string' ? node.role.value : '';
      const name = cleanText(typeof node.name?.value === 'string' ? node.name.value : '');
      const ref = node.backendDOMNodeId
        ? ctx.controller.registry.findLive(ctx.tab().tabId, frame.frameId, frame.loaderId, node.backendDOMNodeId)
        : undefined;
      if (role === 'RootWebArea' || role === 'WebArea') break;
      if (!node.ignored && (ref || (name && !['generic', 'none', 'StaticText', 'paragraph'].includes(role)))) {
        return `${ref ? `[${ref.ref}] ` : ''}${role}${name ? ` ${quote(name, 60)}` : ''} (${quote(element, 80)})`;
      }
      node = node.parentId ? byId.get(node.parentId) : undefined;
    }
  } catch {
    // No accessibility information; the element description stands alone.
  }
  return element;
}
