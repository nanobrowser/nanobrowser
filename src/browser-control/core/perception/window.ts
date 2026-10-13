// The window and the character budget, with tier 2 geometry: by default the outline covers the viewport plus one
// viewport height above and below; lines farthest from the viewport are cut first, before the known set is recorded, so
// the printed refs and the accepted refs are the same set.
import type { Capture } from './capture';
import type { LayoutDocument } from './layout';
import type { ONode, RenderedLine } from './outline';

export type WindowMode = 'viewport' | 'near' | 'page';

/** A vertical span in page CSS pixels (the main document's coordinates). */
export interface Span {
  top: number;
  bottom: number;
}

/** Vertical offset of each captured frame's document origin in the main document, through its owner iframes. */
function frameOffsets(capture: Capture, docs: Map<string, LayoutDocument>): Map<string, number> {
  const offsets = new Map<string, number>();
  const main = capture.frames[0];
  if (main) offsets.set(main.frameId, 0);
  for (const frame of capture.frames.slice(1)) {
    const parentOffset = frame.parentFrameId ? offsets.get(frame.parentFrameId) : undefined;
    const parentDoc = frame.parentFrameId ? docs.get(frame.parentFrameId) : undefined;
    const doc = docs.get(frame.frameId);
    if (parentOffset === undefined || !parentDoc || frame.ownerBackendNodeId === null) continue;
    const owner = parentDoc.byBackendId.get(frame.ownerBackendNodeId);
    if (!owner?.bounds) continue;
    // The child document starts at the owner's content box, and is scrolled by its own offset.
    offsets.set(frame.frameId, parentOffset + owner.bounds[1] + (owner.client?.[1] ?? 0) - (doc?.scrollY ?? 0));
  }
  return offsets;
}

/** Spans of outline nodes: their own box, else the union of their children's. Unknown geometry stays unset. */
export function nodeSpans(roots: ONode[], capture: Capture, docs: Map<string, LayoutDocument>): Map<ONode, Span> {
  const offsets = frameOffsets(capture, docs);
  const spans = new Map<ONode, Span>();
  const visit = (n: ONode): Span | undefined => {
    let span: Span | undefined;
    const offset = offsets.get(n.frameId);
    const doc = docs.get(n.frameId);
    const box = n.backendNodeId !== undefined ? doc?.byBackendId.get(n.backendNodeId)?.bounds : undefined;
    if (box && offset !== undefined && (box[2] > 0 || box[3] > 0))
      span = { top: offset + box[1], bottom: offset + box[1] + box[3] };
    for (const c of n.children) {
      const child = visit(c);
      // An element's own box wins; the children's union is used only when it has none.
      if (child && !box)
        span = span ? { top: Math.min(span.top, child.top), bottom: Math.max(span.bottom, child.bottom) } : child;
    }
    if (span) spans.set(n, span);
    return span;
  };
  roots.forEach(visit);
  return spans;
}

export function windowSpan(mode: WindowMode, viewport: { scrollY: number; height: number }): Span | null {
  if (mode === 'page') return null;
  const extra = mode === 'near' ? viewport.height : 0;
  return { top: viewport.scrollY - extra, bottom: viewport.scrollY + viewport.height + extra };
}

function countRefs(n: ONode): number {
  return (n.ref ? 1 : 0) + n.children.reduce((sum, c) => sum + countRefs(c), 0);
}

/**
 * Keeps the nodes whose span meets the window, with the containers around them. Nodes without geometry are kept.
 * Returns how many actionable elements were left out above and below.
 */
export function applyWindow(
  roots: ONode[],
  spans: Map<ONode, Span>,
  window: Span,
): { roots: ONode[]; above: number; below: number } {
  let above = 0;
  let below = 0;
  const filter = (nodes: ONode[]): ONode[] => {
    const out: ONode[] = [];
    for (const n of nodes) {
      const span = spans.get(n);
      if (span && span.bottom < window.top) {
        above += countRefs(n);
        continue;
      }
      if (span && span.top > window.bottom) {
        below += countRefs(n);
        continue;
      }
      out.push(n.children.length ? { ...n, children: filter(n.children) } : n);
    }
    return out;
  };
  return { roots: filter(roots), above, below };
}

/** Distance of a span from the viewport: 0 when it overlaps. */
export function distance(span: Span | undefined, viewport: Span): number {
  if (!span) return 0;
  if (span.bottom < viewport.top) return viewport.top - span.bottom;
  if (span.top > viewport.bottom) return span.top - viewport.bottom;
  return 0;
}

/**
 * Cuts lines until the text fits, farthest from the viewport first and a child before its container, so the
 * outline stays a tree. Returns the kept lines in document order and what was cut.
 */
export function budgetByDistance(
  lines: RenderedLine[],
  spans: Map<ONode, Span>,
  viewport: Span,
  budget: number,
): { lines: RenderedLine[]; cutLines: number; cutAbove: number; cutBelow: number } {
  let total = lines.reduce((sum, l) => sum + l.text.length + 1, 0);
  if (total <= budget) return { lines, cutLines: 0, cutAbove: 0, cutBelow: 0 };
  // A container is as close as its closest descendant line.
  const dist = lines.map(l => distance(spans.get(l.node), viewport));
  for (let i = lines.length - 1; i >= 0; i--) {
    for (let j = i + 1; j < lines.length && lines[j].depth > lines[i].depth; j++) dist[i] = Math.min(dist[i], dist[j]);
  }
  const order = lines.map((_, i) => i).sort((a, b) => dist[b] - dist[a] || lines[b].depth - lines[a].depth || b - a);
  const cut = new Set<number>();
  let cutAbove = 0;
  let cutBelow = 0;
  for (const i of order) {
    if (total <= budget) break;
    cut.add(i);
    total -= lines[i].text.length + 1;
    if (lines[i].ref) {
      const span = spans.get(lines[i].node);
      if (span && span.bottom < viewport.top) cutAbove++;
      else cutBelow++;
    }
  }
  return { lines: lines.filter((_, i) => !cut.has(i)), cutLines: cut.size, cutAbove, cutBelow };
}
