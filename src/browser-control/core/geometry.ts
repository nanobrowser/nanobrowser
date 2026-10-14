// Coordinates across frames. DOM.getContentQuads, DOM.getBoxModel and Input.dispatchMouseEvent use viewport
// coordinates of the session's root frame; DOM.getNodeForLocation takes document coordinates, so the session's scroll
// offset is added before every hit test (as measured in Chrome).
import type { CdpPort, FrameRecord, SessionId } from './ports';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Quad = number[];

export function quadCenter(q: Quad): Point {
  return { x: (q[0] + q[2] + q[4] + q[6]) / 4, y: (q[1] + q[3] + q[5] + q[7]) / 4 };
}

export function quadArea(q: Quad): number {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += q[i * 2] * q[j * 2 + 1] - q[j * 2] * q[i * 2 + 1];
  }
  return Math.abs(area) / 2;
}

export function quadBounds(q: Quad): Rect {
  const xs = [q[0], q[2], q[4], q[6]];
  const ys = [q[1], q[3], q[5], q[7]];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export async function scrollOffset(cdp: CdpPort, sessionId: SessionId): Promise<Point> {
  const m = await cdp.send<{ cssLayoutViewport: { pageX: number; pageY: number } }>(sessionId, 'Page.getLayoutMetrics');
  return { x: m.cssLayoutViewport.pageX, y: m.cssLayoutViewport.pageY };
}

/** Hit test at a viewport point of the session's root frame. */
export async function nodeAtViewportPoint(
  cdp: CdpPort,
  sessionId: SessionId,
  p: Point,
): Promise<{ backendNodeId: number; frameId: string } | null> {
  const offset = await scrollOffset(cdp, sessionId);
  try {
    return await cdp.send<{ backendNodeId: number; frameId: string }>(sessionId, 'DOM.getNodeForLocation', {
      x: Math.round(p.x + offset.x),
      y: Math.round(p.y + offset.y),
      includeUserAgentShadowDOM: true,
      ignorePointerEventsNone: false,
    });
  } catch {
    return null;
  }
}

/** The frame whose session owns `frame` as its root: the nearest ancestor-or-self on a different session than its parent. */
export function sessionRoot(frames: FrameRecord[], frame: FrameRecord): FrameRecord {
  const byId = new Map(frames.map(f => [f.frameId, f]));
  let current = frame;
  for (;;) {
    const parent = current.parentFrameId ? byId.get(current.parentFrameId) : undefined;
    if (!parent || parent.sessionId !== current.sessionId) return current;
    current = parent;
  }
}

/** The viewport of a session's root frame in CSS pixels, scrollbars included (the probe's `viewport`). */
export type ViewportOf = (root: FrameRecord) => Promise<{ width: number; height: number }>;

export interface ChainStep {
  /** The session root frame the point is in at this level. */
  frame: FrameRecord;
  point: Point;
  /** The owner iframe element of `frame` in the parent session, when there is one. */
  owner?: { sessionId: SessionId; backendNodeId: number; frameId: string };
}

/**
 * Converts a viewport point of `frame`'s session up to the tab's top-level viewport, one process boundary at a time:
 * the owner iframe's content quad in the parent session, scaled by the child viewport's size.
 * `viewportOf` gives that size with the frame's scrollbars, which the iframe's content quad includes and the layout
 * viewport of `Page.getLayoutMetrics` does not. Returns every level, nearest first; the last point is top-level.
 */
export async function chainToTop(
  cdp: CdpPort,
  frames: FrameRecord[],
  frame: FrameRecord,
  point: Point,
  viewportOf: ViewportOf,
): Promise<ChainStep[]> {
  const byId = new Map(frames.map(f => [f.frameId, f]));
  const steps: ChainStep[] = [];
  let root = sessionRoot(frames, frame);
  let p = point;
  for (;;) {
    const parent = root.parentFrameId ? byId.get(root.parentFrameId) : undefined;
    if (!parent) {
      steps.push({ frame: root, point: p });
      return steps;
    }
    const { backendNodeId } = await cdp.send<{ backendNodeId: number }>(parent.sessionId, 'DOM.getFrameOwner', {
      frameId: root.frameId,
    });
    const { model } = await cdp.send<{ model: { content: Quad } }>(parent.sessionId, 'DOM.getBoxModel', {
      backendNodeId,
    });
    const viewport = await viewportOf(root);
    steps.push({
      frame: root,
      point: p,
      owner: { sessionId: parent.sessionId, backendNodeId, frameId: parent.frameId },
    });
    // The point's position in the child viewport, as fractions, placed on the owner's content quad (top-left,
    // top-right, bottom-right, bottom-left): right for a scaled or rotated iframe too.
    const c = model.content;
    const fx = p.x / Math.max(1, viewport.width);
    const fy = p.y / Math.max(1, viewport.height);
    p = {
      x: c[0] + (c[2] - c[0]) * fx + (c[6] - c[0]) * fy,
      y: c[1] + (c[3] - c[1]) * fx + (c[7] - c[1]) * fy,
    };
    root = sessionRoot(frames, parent);
  }
}

/** A node's first quad, converted to top-level viewport coordinates (null when it has no box). */
export async function topLevelQuad(
  cdp: CdpPort,
  frames: FrameRecord[],
  frame: FrameRecord,
  backendNodeId: number,
  viewportOf: ViewportOf,
): Promise<Quad | null> {
  let quads: Quad[];
  try {
    ({ quads } = await cdp.send<{ quads: Quad[] }>(frame.sessionId, 'DOM.getContentQuads', { backendNodeId }));
  } catch {
    return null;
  }
  const quad = quads.find(q => quadArea(q) > 0);
  if (!quad) return null;
  if (!frame.parentFrameId || sessionRoot(frames, frame).parentFrameId === undefined) return quad;
  const corners: Point[] = [0, 1, 2, 3].map(i => ({ x: quad[i * 2], y: quad[i * 2 + 1] }));
  const converted: number[] = [];
  for (const corner of corners) {
    const steps = await chainToTop(cdp, frames, frame, corner, viewportOf);
    const top = steps[steps.length - 1].point;
    converted.push(top.x, top.y);
  }
  return converted;
}
