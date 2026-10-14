// Joins tier 2 into one frame's outline: nodes found only by layout signals are spliced in under their nearest
// accessibility ancestor, with a role from the tag and a name from their text; a pointer-styled child inside an
// actionable ancestor is dropped unless it is a form control; a native checkbox or radio that is not rendered is
// promoted onto its visible label.
import type { LayoutDocument, LayoutNode } from './layout';
import { isNativeControl, isRendered, labelsOf, layoutHint, layoutRole, layoutSignal, nameSources } from './layout';
import type { ONode } from './outline';

export interface EnrichStats {
  added: number;
  promoted: number;
}

function index(
  nodes: ONode[],
  into: Map<number, ONode>,
  parentOf: Map<ONode, ONode | null>,
  parent: ONode | null,
): void {
  for (const n of nodes) {
    if (n.backendNodeId !== undefined && !into.has(n.backendNodeId)) into.set(n.backendNodeId, n);
    parentOf.set(n, parent);
    index(n.children, into, parentOf, n);
  }
}

/** Whether the layout node `inner` is `outer` or inside it, in the light DOM of one document. */
function within(doc: LayoutDocument, inner: number, outer: number): boolean {
  for (let i = inner; i >= 0; i = doc.byIndex[i]?.parent ?? -1) if (i === outer) return true;
  return false;
}

const NO_VALUE_TYPES = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'image']);

/** A form control whose value the page shows: a text-like input, a textarea or a select. */
function holdsValue(node: LayoutNode): boolean {
  if (node.tag === 'textarea' || node.tag === 'select') return true;
  return node.tag === 'input' && !NO_VALUE_TYPES.has((node.attrs.type ?? '').toLowerCase());
}

export function enrichFrame(
  roots: ONode[],
  doc: LayoutDocument,
  base: Pick<ONode, 'frameId' | 'sessionId' | 'loaderId'>,
): { roots: ONode[]; stats: EnrichStats } {
  const stats: EnrichStats = { added: 0, promoted: 0 };
  const byBackend = new Map<number, ONode>();
  const parentOf = new Map<ONode, ONode | null>();
  index(roots, byBackend, parentOf, null);
  const top: ONode = {
    kind: 'element',
    rawRole: 'RootWebArea',
    role: 'document',
    name: '',
    states: [],
    actionable: false,
    children: roots,
    ...base,
  };
  for (const r of roots) parentOf.set(r, top);

  // Document order of outline nodes, for placing new nodes among their siblings.
  const orderOf = (n: ONode): number =>
    n.backendNodeId !== undefined ? (doc.byBackendId.get(n.backendNodeId)?.index ?? -1) : -1;

  // Whether an element (or an ancestor) is already actionable: AX refs first, then layout refs as they are added.
  const actionable = new Set<number>();
  for (const [backendId, n] of byBackend)
    if (n.actionable) {
      const node = doc.byBackendId.get(backendId);
      if (node) actionable.add(node.index);
    }
  const insideActionable = (node: LayoutNode): boolean => {
    for (let p = doc.byIndex[node.parent]; p; p = doc.byIndex[p.parent]) if (actionable.has(p.index)) return true;
    return false;
  };
  const nearestOutlineAncestor = (node: LayoutNode): ONode => {
    for (let p = doc.byIndex[node.parent]; p; p = doc.byIndex[p.parent]) {
      const o = byBackend.get(p.backendNodeId);
      if (o && o.kind === 'element') return o;
    }
    return top;
  };

  const splice = (node: LayoutNode, created: ONode) => {
    const parent = nearestOutlineAncestor(node);
    // Outline nodes that are inside the new element in the DOM move under it.
    const moved: ONode[] = [];
    const kept: ONode[] = [];
    for (const child of parent.children) {
      const childNode = child.backendNodeId !== undefined ? doc.byBackendId.get(child.backendNodeId) : undefined;
      (childNode && within(doc, childNode.index, node.index) ? moved : kept).push(child);
    }
    // Text that only repeats the new node's name is dropped, as for nodes from the accessibility tree.
    const norm = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();
    // A paragraph printed as one text line that contains the new node: drop it when it only repeats the name.
    for (let i = kept.length - 1; i >= 0; i--) {
      const c = kept[i];
      const cNode =
        c.kind === 'text' && c.backendNodeId !== undefined ? doc.byBackendId.get(c.backendNodeId) : undefined;
      if (
        cNode &&
        cNode.tag !== '#text' &&
        within(doc, node.index, cNode.index) &&
        norm(created.name).includes(norm(c.name))
      ) {
        kept.splice(i, 1);
      }
    }
    created.children = moved.filter(
      c => !(c.kind === 'text' && created.name && norm(created.name).includes(norm(c.name))),
    );
    for (const c of created.children) parentOf.set(c, created);
    const position = node.index;
    const at = kept.findIndex(c => orderOf(c) > position);
    kept.splice(at === -1 ? kept.length : at, 0, created);
    parent.children = kept;
    parentOf.set(created, parent);
    byBackend.set(node.backendNodeId, created);
  };

  for (const node of doc.byIndex) {
    if (!node || node.tag === '#text') continue;
    // A native checkbox or radio that is not rendered (display: none): promoted onto its visible label.
    if (
      node.tag === 'input' &&
      (node.attrs.type === 'checkbox' || node.attrs.type === 'radio') &&
      !node.bounds &&
      !byBackend.has(node.backendNodeId)
    ) {
      const label = labelsOf(doc, node).find(isRendered);
      if (!label) continue;
      const name = doc.text(label.index);
      const created: ONode = {
        kind: 'element',
        rawRole: node.attrs.type,
        role: node.attrs.type,
        name,
        states: [node.checked ? 'checked' : 'unchecked'],
        actionable: true,
        backendNodeId: node.backendNodeId,
        layout: { tag: node.tag, digest: '', names: nameSources(doc, node) },
        note: 'hidden input, acted on through its label',
        children: [],
        ...base,
      };
      splice(label, created);
      // The label's own outline lines are now this node's name.
      created.children = [];
      actionable.add(node.index);
      actionable.add(label.index);
      stats.promoted++;
      continue;
    }
    const existing = byBackend.get(node.backendNodeId);
    if (existing?.actionable) continue;
    if (!isRendered(node)) continue;
    const parent = doc.byIndex[node.parent];
    const signal = layoutSignal(node, parent);
    if (!signal) continue;
    if (insideActionable(node) && !isNativeControl(node) && !existing?.name) continue;
    const digest = doc.digest(node.index);
    // A field is named by its aria-label, labels or title (the sources revalidation checks), never by what it holds:
    // a textarea's text or a select's options can be secrets.
    const name = holdsValue(node)
      ? node.attrs['aria-label'] ||
        labelsOf(doc, node)
          .map(l => doc.text(l.index))
          .join(' ')
          .trim() ||
        node.attrs.title ||
        ''
      : doc.text(node.index) || node.attrs['aria-label'] || node.attrs.title || '';
    if (existing && existing.kind === 'element') {
      // An outline node without a ref (for example a named group) becomes actionable in place.
      existing.actionable = true;
      existing.layout = { tag: node.tag, digest, names: nameSources(doc, node) };
      if (!existing.name) existing.name = name;
    } else {
      splice(node, {
        kind: 'element',
        rawRole: `layout:${node.tag}`,
        role: layoutRole(node, signal),
        name,
        states: [],
        actionable: true,
        backendNodeId: node.backendNodeId,
        layout: { tag: node.tag, digest, names: nameSources(doc, node) },
        note: name ? undefined : layoutHint(node),
        // Its value is not read (the accessibility tree has no node for it): a screenshot blanks it.
        masked: holdsValue(node) || undefined,
        children: [],
        ...base,
      });
    }
    actionable.add(node.index);
    stats.added++;
  }
  return { roots: top.children, stats };
}
