// Perception tier 2: DOMSnapshot.captureSnapshot decoded and joined with the accessibility tree.
// It finds what the accessibility tree leaves out (a clickable div is a nameless generic node there) and gives
// geometry to the window and the budget (step 3.2). Live input values in the snapshot are never printed.

/** The computed styles requested, in this order (about ten). */
export const LAYOUT_STYLES = [
  'display',
  'visibility',
  'opacity',
  'cursor',
  'pointer-events',
  'overflow-x',
  'overflow-y',
  'position',
  'z-index',
  'content-visibility',
] as const;

type Rect = [number, number, number, number];

interface RareString {
  index: number[];
  value: number[];
}
interface RareBoolean {
  index: number[];
}
interface RareInteger {
  index: number[];
  value: number[];
}

export interface RawDocument {
  documentURL: number;
  frameId: number;
  scrollOffsetX?: number;
  scrollOffsetY?: number;
  contentWidth?: number;
  contentHeight?: number;
  nodes: {
    parentIndex?: number[];
    nodeType?: number[];
    shadowRootType?: RareString;
    nodeName?: number[];
    nodeValue?: number[];
    backendNodeId?: number[];
    attributes?: number[][];
    inputChecked?: RareBoolean;
    contentDocumentIndex?: RareInteger;
    isClickable?: RareBoolean;
  };
  layout: {
    nodeIndex: number[];
    styles: number[][];
    bounds: Rect[];
    clientRects?: Rect[];
    scrollRects?: Rect[];
  };
}

export interface RawSnapshot {
  documents: RawDocument[];
  strings: string[];
}

export interface LayoutNode {
  index: number;
  backendNodeId: number;
  parent: number;
  tag: string;
  attrs: Record<string, string>;
  /** Document coordinates in CSS pixels; null when the node has no layout box. */
  bounds: Rect | null;
  /** The client rect (inside the border), relative to the border box; null without a box. */
  client: Rect | null;
  styles: Record<string, string>;
  clickable: boolean;
  scrollable: boolean;
  checked: boolean;
}

export interface LayoutDocument {
  frameId: string;
  url: string;
  scrollX: number;
  scrollY: number;
  contentWidth: number;
  contentHeight: number;
  byIndex: LayoutNode[];
  byBackendId: Map<number, LayoutNode>;
  /** Snapshot index of each child document's owner element, by the child document's position in the snapshot. */
  ownerOfDocument: Map<number, number>;
  /** The text digest of an element: text nodes concatenated as they are. */
  digest(index: number, max?: number): string;
  /**
   * The element's text for display: text nodes joined with spaces, whitespace collapsed, without the content of
   * selects, textareas and options.
   */
  text(index: number, max?: number): string;
}

/**
 * Whitespace collapsed, first `max` characters: the form of display text, and of the text digest, which `digestOf`
 * below builds node by node as the probe does.
 */
export function digestText(raw: string, max = 80): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Elements whose content never appears in display text (names, descriptions), with `role=option`: a select's or a
 * listbox's options and a textarea's text can be secrets.
 */
const UNQUOTED = new Set(['select', 'textarea', 'datalist', 'option', 'optgroup']);

/**
 * Decodes every document of a snapshot. `scale` is the device pixels per CSS pixel: the snapshot gives bounds, scroll
 * offsets and content sizes in device pixels, and they are converted here, so everything decoded is in CSS pixels
 * (client and scroll rects already are).
 */
export function decodeSnapshot(snapshot: RawSnapshot, scale = 1): LayoutDocument[] {
  const css = (rect: Rect | undefined): Rect | null =>
    !rect ? null : scale === 1 ? rect : [rect[0] / scale, rect[1] / scale, rect[2] / scale, rect[3] / scale];
  const S = snapshot.strings;
  const str = (i: number | undefined) => (i === undefined || i < 0 ? '' : (S[i] ?? ''));
  const docs: LayoutDocument[] = snapshot.documents.map(doc => {
    const n = doc.nodes;
    const count = n.nodeName?.length ?? 0;
    const parent = n.parentIndex ?? [];
    const type = n.nodeType ?? [];
    const clickable = new Set(n.isClickable?.index ?? []);
    const checked = new Set(n.inputChecked?.index ?? []);
    const children: number[][] = Array.from({ length: count }, () => []);
    for (let i = 0; i < count; i++) if (parent[i] >= 0) children[parent[i]].push(i);
    const layoutOf = new Map<number, number>();
    doc.layout.nodeIndex.forEach((nodeIndex, i) => layoutOf.set(nodeIndex, i));

    // The snapshot is Chrome's flat tree: a shadow host's children are its shadow tree's nodes, and nodes slotted
    // into it sit under their slot. `shadowRootType` marks every node inside a shadow tree. The text of an element is
    // the text of its own tree, as a TreeWalker in the page gives it (the probe's `textDigest`): a text node counts
    // when it is inside a shadow tree exactly if the element is, so shadow content under a light element is left
    // out and the text slotted into it is kept. A template's content (a document fragment) is skipped. Limit: a
    // shadow tree nested in another cannot be told from its host's tree, and is read with it.
    const inShadow = new Set(n.shadowRootType?.index ?? []);
    const ownTree = (i: number) => children[i].filter(c => type[c] !== 11);
    /**
     * The text digest, with the probe's algorithm (`textDigest`): text nodes are added in tree order and whitespace is
     * collapsed as they are added, until more than `max` characters are held.
     */
    const digestOf = (root: number, max: number): string => {
      let out = '';
      const own = inShadow.has(root);
      const stack = [root];
      while (stack.length && out.length <= max) {
        const i = stack.pop()!;
        if (type[i] === 3) {
          if (inShadow.has(i) === own) out = (out + str(n.nodeValue?.[i])).replace(/\s+/g, ' ').trimStart();
        } else for (const c of ownTree(i).reverse()) stack.push(c);
      }
      return out.trim().slice(0, max);
    };
    const textCache = new Map<string, string>();
    const textOf = (root: number, separator: string): string => {
      const key = (i: number) => `${separator}${i}`;
      const stack: Array<[number, boolean]> = [[root, false]];
      while (stack.length) {
        const [i, ready] = stack.pop()!;
        if (textCache.has(key(i))) continue;
        const kids = ownTree(i);
        if (!ready) {
          stack.push([i, true]);
          for (const c of kids) if (!textCache.has(key(c))) stack.push([c, false]);
          continue;
        }
        // Display text leaves out what a select, a textarea or an option holds: option labels and field content can be
        // secrets, and the outline masks or leaves them out. The digest keeps them, as the probe's does.
        if (separator && (UNQUOTED.has(str(n.nodeName?.[i]).toLowerCase()) || byIndex[i]?.attrs.role === 'option')) {
          textCache.set(key(i), '');
          continue;
        }
        const parts: string[] = type[i] === 3 ? [str(n.nodeValue?.[i])] : [];
        let length = 0;
        for (const c of kids) {
          const t = textCache.get(key(c)) ?? '';
          parts.push(t);
          length += t.length;
          if (length > 8000) break;
        }
        textCache.set(key(i), parts.join(separator));
      }
      return textCache.get(key(root)) ?? '';
    };

    const byIndex: LayoutNode[] = [];
    const byBackendId = new Map<number, LayoutNode>();
    for (let i = 0; i < count; i++) {
      if (type[i] === 3) {
        // Text nodes are indexed for document order and containment; they are never actionable.
        const text: LayoutNode = {
          index: i,
          backendNodeId: n.backendNodeId?.[i] ?? 0,
          parent: parent[i] ?? -1,
          tag: '#text',
          attrs: {},
          bounds: layoutOf.has(i) ? css(doc.layout.bounds[layoutOf.get(i)!]) : null,
          client: null,
          styles: {},
          clickable: false,
          scrollable: false,
          checked: false,
        };
        byIndex[i] = text;
        byBackendId.set(text.backendNodeId, text);
        continue;
      }
      if (type[i] !== 1) continue;
      const attrs: Record<string, string> = {};
      const list = n.attributes?.[i] ?? [];
      for (let a = 0; a + 1 < list.length; a += 2) attrs[str(list[a]).toLowerCase()] = str(list[a + 1]);
      const li = layoutOf.get(i);
      const styles: Record<string, string> = {};
      if (li !== undefined) LAYOUT_STYLES.forEach((name, k) => (styles[name] = str(doc.layout.styles[li]?.[k])));
      const client = li !== undefined ? doc.layout.clientRects?.[li] : undefined;
      const scroll = li !== undefined ? doc.layout.scrollRects?.[li] : undefined;
      const overflowing =
        !!client &&
        !!scroll &&
        (scroll[3] > client[3] + 1 || scroll[2] > client[2] + 1) &&
        client[3] > 0 &&
        client[2] > 0;
      const scrollable =
        overflowing && /(auto|scroll)/.test(`${styles['overflow-x'] ?? ''} ${styles['overflow-y'] ?? ''}`);
      const node: LayoutNode = {
        index: i,
        backendNodeId: n.backendNodeId?.[i] ?? 0,
        parent: parent[i] ?? -1,
        tag: str(n.nodeName?.[i]).toLowerCase(),
        attrs,
        bounds: li !== undefined ? css(doc.layout.bounds[li]) : null,
        client: client ?? null,
        styles,
        clickable: clickable.has(i),
        scrollable,
        checked: checked.has(i),
      };
      byIndex[i] = node;
      byBackendId.set(node.backendNodeId, node);
    }
    const ownerOfDocument = new Map<number, number>();
    const cdi = n.contentDocumentIndex;
    cdi?.index.forEach((ownerIndex, k) => ownerOfDocument.set(cdi.value[k], ownerIndex));
    return {
      frameId: str(doc.frameId),
      url: str(doc.documentURL),
      scrollX: (doc.scrollOffsetX ?? 0) / scale,
      scrollY: (doc.scrollOffsetY ?? 0) / scale,
      contentWidth: (doc.contentWidth ?? 0) / scale,
      contentHeight: (doc.contentHeight ?? 0) / scale,
      byIndex,
      byBackendId,
      ownerOfDocument,
      digest: (index: number, max = 80) => digestOf(index, max),
      text: (index: number, max = 120) => digestText(textOf(index, ' '), max),
    };
  });
  return docs;
}

export function isRendered(node: LayoutNode): boolean {
  if (!node.bounds) return false;
  const [, , w, h] = node.bounds;
  return (
    w > 0 &&
    h > 0 &&
    node.styles.visibility !== 'hidden' &&
    node.styles.display !== 'none' &&
    node.styles.opacity !== '0'
  );
}

const NATIVE_CONTROLS = new Set(['button', 'select', 'textarea', 'summary']);

/**
 * What a layout ref's name can come from besides its text: the `aria-label`, `aria-labelledby` and `title` attributes
 * as written, and the text digests of a field's labels, sorted. One definition, shared with the probe's `nameSources`;
 * fields separated by U+001F.
 */
export function nameSources(doc: LayoutDocument, node: LayoutNode): string {
  const attrs = ['aria-label', 'aria-labelledby', 'title'].map(a => node.attrs[a] ?? '');
  const labelled = ['input', 'select', 'textarea'].includes(node.tag)
    ? labelsOf(doc, node)
        .map(l => doc.digest(l.index))
        .sort()
    : [];
  return [...attrs, ...labelled].join('\u001f');
}

/** A native control or a link: these have accessibility roles and are found by tier 1 when rendered. */
export function isNativeControl(node: LayoutNode): boolean {
  if (NATIVE_CONTROLS.has(node.tag)) return true;
  if (node.tag === 'a' && 'href' in node.attrs) return true;
  return node.tag === 'input' && node.attrs.type !== 'hidden';
}

/** The layout signals for one node: why it looks actionable, or null. */
export function layoutSignal(node: LayoutNode, parent: LayoutNode | undefined): string | null {
  // A label acts through its control, which is listed itself (a hidden one is promoted onto the label).
  if (node.tag === 'body' || node.tag === 'html' || node.tag === 'label') return null;
  if (isNativeControl(node)) return 'native control';
  if ('contenteditable' in node.attrs && node.attrs.contenteditable !== 'false') return 'contenteditable';
  const tabindex = Number(node.attrs.tabindex);
  if ('tabindex' in node.attrs && Number.isFinite(tabindex) && tabindex >= 0) return 'tabindex';
  if (node.clickable) return 'click listener';
  if (node.styles.cursor === 'pointer' && parent?.styles.cursor !== 'pointer') return 'pointer cursor';
  if (node.scrollable) return 'scrollable';
  return null;
}

/** The role shown for a layout-only node: from its tag, or what it does. */
export function layoutRole(node: LayoutNode, signal: string): string {
  if (signal === 'scrollable') return 'scrollable';
  if (node.tag === 'input')
    return node.attrs.type === 'checkbox' ? 'checkbox' : node.attrs.type === 'radio' ? 'radio' : 'textbox';
  if (node.tag === 'a') return 'link';
  if (node.tag === 'select') return 'combobox';
  if (node.tag === 'textarea') return 'textbox';
  if (signal === 'contenteditable') return 'textbox';
  return 'clickable';
}

/** A short element description when a layout node has no text: tag, id and first classes. */
export function layoutHint(node: LayoutNode): string {
  let out = node.tag;
  if (node.attrs.id) out += `#${node.attrs.id}`;
  const classes = (node.attrs.class ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (classes.length) out += `.${classes.join('.')}`;
  return out;
}

/** The labels of an input: a wrapping label, or labels whose `for` names its id. */
export function labelsOf(doc: LayoutDocument, input: LayoutNode): LayoutNode[] {
  const out: LayoutNode[] = [];
  for (let p = doc.byIndex[input.parent]; p; p = doc.byIndex[p.parent]) {
    if (p.tag === 'label') {
      out.push(p);
      break;
    }
  }
  if (input.attrs.id) {
    for (const node of doc.byIndex)
      if (node?.tag === 'label' && node.attrs.for === input.attrs.id && !out.includes(node)) out.push(node);
  }
  return out;
}
