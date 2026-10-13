// An observation: the stitched outline with refs, cut to the budget, with every omission stated.
import type { RefPrint, RefRegistry, Shown } from '../refs';
import { fingerprint } from '../hash';

/** Containers whose content identifies a record, and how much of their text the fingerprint covers. */
const RECORD_ROLES = new Set(['row', 'listitem', 'article', 'treeitem']);
export const RECORD_DIGEST_CHARS = 2_000;
import type { Capture } from './capture';
import type { FrameOwner, ONode, RenderedLine } from './outline';
import { applyBudget, assignRefs, interactiveOnly, MAX_TREE_DEPTH, renderLines, stitchFrames } from './outline';
import { applyWindow, budgetByDistance, nodeSpans, windowSpan } from './window';
import type { WindowMode } from './window';

/** The default budget: 30,000 characters. */
export const DEFAULT_BUDGET = 30_000;

export interface ObserveOptions {
  mode: 'interactive' | 'all';
  /** How much of the page to print; 'near' by default. Without layout, the whole page is printed. */
  window?: WindowMode;
  /** Only the subtree of this node (resolved from a ref by the caller). */
  scope?: { frameId: string; backendNodeId: number };
  budget: number;
}

export interface ObservationEntry {
  ref: string;
  role: string;
  name: string;
  value?: string;
  line: string;
  frameId: string;
  backendNodeId: number;
  /** Names of the enclosing elements, nearest last; used by find's `within`. */
  path: string[];
}

export interface Observation {
  tabId: number;
  url: string;
  title: string;
  /** Header, for example 'Invoices · https://… · viewport 0–900 of 4200 px'. Page-derived. */
  header: string;
  /** Outline lines. Page-derived. */
  body: string;
  /** Tool-generated notices about omissions. */
  notices: string[];
  /** Refs printed; exactly the refs the agent may use from this observation. */
  refs: string[];
  /**
   * The source and print of every ref this observation assigned, as of its capture. A session is shown a ref with
   * this print, never with the registry's, which later captures replace.
   */
  shown: Map<string, Shown>;
  entries: ObservationEntry[];
  /** The whole stitched tree, before mode, scope and budget; used by read and find. */
  tree: ONode[];
  /** Iframes whose content could not be placed in the tree; a screenshot paints over them. */
  unplaced: FrameOwner[];
  /** The values this observation masks; never printed. The controller keeps them for the result filter. */
  secrets: string[];
  status: 'complete' | 'partial';
  frames: { captured: number; skipped: number; failed: number };
  captureMs: number;
}

function findScope(nodes: ONode[], scope: { frameId: string; backendNodeId: number }): ONode | undefined {
  for (const n of nodes) {
    if (n.frameId === scope.frameId && n.backendNodeId === scope.backendNodeId) return n;
    const inner = findScope(n.children, scope);
    if (inner) return inner;
  }
  return undefined;
}

export function buildObservation(capture: Capture, registry: RefRegistry, options: ObserveOptions): Observation {
  const { roots, orphans, unplaced, layout, docs, deepCut, unknownMasked, secrets } = stitchFrames(capture);
  // The record context: the enclosing row, list item, article or tree item, and a fingerprint of its content computed
  // from the layout snapshot. Without layout for the frame, no context is stored.
  let contextMissing = false;
  const contextOf = (node: ONode, ancestors: ONode[]): RefPrint['context'] => {
    const container = [...ancestors]
      .reverse()
      .find(a => RECORD_ROLES.has(a.role) && a.backendNodeId !== undefined && a.frameId === node.frameId);
    if (!container) return null;
    const doc = docs.get(node.frameId);
    const layoutNode = doc?.byBackendId.get(container.backendNodeId!);
    if (!doc || !layoutNode) {
      contextMissing = true;
      return null;
    }
    return {
      backendNodeId: container.backendNodeId!,
      digest: fingerprint(doc.digest(layoutNode.index, RECORD_DIGEST_CHARS)),
    };
  };
  const shown = new Map<string, Shown>();
  assignRefs(roots, (node, nth, ancestors) => {
    const context = contextOf(node, ancestors);
    const record = registry.assign(
      {
        tabId: capture.tabId,
        sessionId: node.sessionId,
        frameId: node.frameId,
        loaderId: node.loaderId,
        backendNodeId: node.backendNodeId!,
      },
      // Refs from layout signals are revalidated by tag, text digest and name sources.
      node.layout ? 'layout' : 'ax',
      node.layout
        ? {
            role: node.rawRole,
            name: node.name,
            tag: node.layout.tag,
            text: node.layout.digest,
            names: node.layout.names,
            nth,
            context,
          }
        : {
            role: node.rawRole,
            name: node.rawName ?? node.name,
            ...(node.rawName !== undefined ? { shown: node.name } : {}),
            tag: '',
            text: '',
            nth,
            context,
          },
    );
    shown.set(record.ref, { source: record.source, print: record.print });
    return record.ref;
  });

  const notices: string[] = [];
  if (contextMissing)
    notices.push('… some refs inside rows or list items have no record context: their frame has no layout snapshot.');
  let selected = roots;
  if (options.scope) {
    const node = findScope(roots, options.scope);
    selected = node ? [node] : [];
    if (!node) notices.push('The scope element is not in the current page.');
  }
  // The window: needs layout geometry; a scoped snapshot is printed whole.
  const v = capture.viewport;
  const spans = capture.layout && v ? nodeSpans(roots, capture, docs) : null;
  const viewportSpan = v ? { top: v.scrollY, bottom: v.scrollY + v.height } : null;
  const windowMode = options.window ?? 'near';
  const view = spans && v && !options.scope ? windowSpan(windowMode, v) : null;
  if (view && spans) {
    const windowed = applyWindow(selected, spans, view);
    selected = windowed.roots;
    const where = windowMode === 'viewport' ? 'the viewport' : 'the window';
    if (windowed.above)
      notices.push(
        `… ${windowed.above} more actionable elements above ${where}. Scroll up, or use window "page" or find.`,
      );
    if (windowed.below)
      notices.push(
        `… ${windowed.below} more actionable elements below ${where}. Scroll down, or use window "page" or find.`,
      );
  }
  if (options.mode === 'interactive') selected = interactiveOnly(selected);

  const all = renderLines(selected);
  let lines: RenderedLine[];
  if (spans && viewportSpan) {
    // Lines farthest from the viewport are cut first.
    const cut = budgetByDistance(all, spans, viewportSpan, options.budget);
    lines = cut.lines;
    if (cut.cutLines) {
      notices.push(
        `… outline cut at ${options.budget.toLocaleString('en')} characters, farthest from the viewport first: ${cut.cutLines} lines, ${cut.cutAbove} actionable elements above and ${cut.cutBelow} below not shown. Use scope, mode "interactive" or find to see them.`,
      );
    }
  } else {
    const cut = applyBudget(all, options.budget);
    lines = cut.lines;
    if (cut.cutLines) {
      notices.push(
        `… outline cut at ${options.budget.toLocaleString('en')} characters: ${cut.cutLines} more lines, ${cut.cutRefs} actionable elements not shown. Use scope, mode "interactive" or find to see them.`,
      );
    }
  }
  const cutLines = all.length - lines.length;

  const counts = { captured: 0, skipped: 0, failed: 0 };
  const byReason = new Map<string, string[]>();
  for (const frame of capture.frames) {
    counts[frame.status]++;
    if (frame.status === 'captured') continue;
    const reason = frame.status === 'failed' ? `capture failed (${frame.reason})` : (frame.reason ?? 'skipped');
    byReason.set(reason, [...(byReason.get(reason) ?? []), frame.url]);
  }
  for (const [reason, urls] of byReason) {
    notices.push(`… ${urls.length} frame${urls.length > 1 ? 's' : ''} not captured: ${reason}.`);
  }
  // Captured content left out because its iframe is not in the outline (for example inside aria-hidden).
  const lost = orphans.filter(o => o.status === 'captured').length;
  if (lost)
    notices.push(
      lost > 1
        ? `… ${lost} captured frames could not be placed under their iframes (not in the accessibility tree, for example inside aria-hidden) and are not shown; a screenshot paints over them.`
        : '… 1 captured frame could not be placed under its iframe (not in the accessibility tree, for example inside aria-hidden) and is not shown; a screenshot paints over it.',
    );
  if (capture.frames[0]?.status !== 'captured') notices.push('The main frame could not be captured.');
  if (deepCut)
    notices.push(
      `… ${deepCut} part${deepCut > 1 ? 's' : ''} of the page ${deepCut > 1 ? 'are' : 'is'} nested deeper than ${MAX_TREE_DEPTH} levels: only controls the layout snapshot finds there are listed, under the deepest element shown.`,
    );
  if (unknownMasked)
    notices.push(
      `… ${unknownMasked} field value${unknownMasked > 1 ? 's are' : ' is'} masked because the field's attributes could not be read.`,
    );
  if (!capture.layout) {
    notices.push(
      `Layout was not captured${capture.layoutError ? ` (${capture.layoutError})` : ''}: the outline is built from the accessibility tree alone, the whole page is printed, and elements without an accessibility role are not listed.`,
    );
  } else if (layout.frames < counts.captured) {
    notices.push(
      `… layout is missing for ${counts.captured - layout.frames} captured frame(s); their elements without an accessibility role are not listed.`,
    );
  }

  const header = [
    capture.title || '(untitled)',
    capture.url,
    v
      ? `viewport ${Math.round(v.scrollY)}–${Math.round(v.scrollY + v.height)} of ${Math.round(v.contentHeight)} px`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    tabId: capture.tabId,
    url: capture.url,
    title: capture.title,
    header,
    body: lines.map(l => l.text).join('\n'),
    notices,
    refs: lines.filter(l => l.ref).map(l => l.ref!),
    shown,
    entries: entriesOf(lines),
    tree: roots,
    unplaced,
    secrets,
    status: counts.failed || counts.skipped || cutLines || lost ? 'partial' : 'complete',
    frames: counts,
    captureMs: capture.ms,
  };
}

function entriesOf(lines: RenderedLine[]): ObservationEntry[] {
  const out: ObservationEntry[] = [];
  const path: string[] = [];
  for (const l of lines) {
    path.length = l.depth;
    if (l.ref) {
      out.push({
        ref: l.ref,
        role: l.node.role,
        name: l.node.name,
        value: l.node.masked ? undefined : l.node.value,
        line: l.text.trim(),
        frameId: l.node.frameId,
        backendNodeId: l.node.backendNodeId!,
        path: [...path],
      });
    }
    path[l.depth] = l.node.ref ? `${l.node.ref}` : l.node.name || l.node.role;
  }
  return out;
}
