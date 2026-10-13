// Perception tier 1: the accessibility capture turned into an outline.
// Cleaning follows the port's buildHierarchicalTree and cleanStructuralNodes (structural wrappers collapse,
// text that repeats a name is dropped); the outline adds states and values, stitches frames under their iframe,
// masks sensitive values, and states every omission.
import type { SessionId } from '../ports';
import type { AXNode } from './ax';
import { cleanText, nameOf, property, roleOf, valueOf } from './ax';
import type { Capture, FieldFacts, FrameCapture } from './capture';
import { isSensitiveField, isSensitiveLabel, MASK } from './masking';
import { decodeSnapshot } from './layout';
import type { LayoutDocument } from './layout';
import { enrichFrame } from './enrich';
import { siteOf } from '../site';

/** Roles that get a ref (agent-browser's interactive roles, plus Chrome's role for <summary>). */
export const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'option',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'treeitem',
  'Iframe',
  'DisclosureTriangle',
]);

/** Containers that never get a ref from focusability alone. */
const NOT_ACTIONABLE_WHEN_FOCUSABLE = new Set([
  'RootWebArea',
  'WebArea',
  'document',
  'dialog',
  'alertdialog',
  'main',
  'region',
  'article',
  'navigation',
  'banner',
  'contentinfo',
  'complementary',
  'form',
  'list',
  'table',
  'grid',
  'treegrid',
  'tree',
  'menu',
  'menubar',
  'tablist',
  'tabpanel',
  'toolbar',
  'application',
  'scrollbar',
]);

/** Roles whose value is printed, and whose children (the value's text) are not. */
const VALUE_ROLES = new Set(['textbox', 'searchbox', 'spinbutton', 'slider', 'combobox']);

/** Structural roles that are printed only when they carry a name. */
const TRANSPARENT_UNLESS_NAMED = new Set([
  'generic',
  'none',
  'presentation',
  'group',
  'LabelText',
  'Legend',
  'rowgroup',
  'cell',
  'gridcell',
  'columnheader',
  'rowheader',
  'Section',
  'Pre',
  'code',
  'strong',
  'emphasis',
  'Abbr',
  'time',
  'mark',
  'subscript',
  'superscript',
  'insertion',
  'deletion',
  'Ruby',
  'ListMarker',
  'Canvas',
  'Figcaption',
  'DescriptionListTerm',
  'DescriptionListDetail',
  'term',
  'definition',
  'blockquote',
]);
/**
 * Cells are transparent even with a name: the row's label carries their text. Tables used for layout (Chrome's
 * layoutTable roles, as on Hacker News) are presentation, like generic wrappers.
 */
const ALWAYS_TRANSPARENT = new Set([
  'LayoutTable',
  'LayoutTableRow',
  'LayoutTableCell',
  'generic',
  'none',
  'presentation',
  'LabelText',
  'Legend',
  'rowgroup',
  'cell',
  'gridcell',
  'columnheader',
  'rowheader',
  'ListMarker',
]);
const DROPPED = new Set(['InlineTextBox', 'LineBreak', 'ListMarker']);
const CHECKABLE = new Set(['checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio']);
const EDITABLE = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);

const DISPLAY_ROLES: Record<string, string> = {
  Iframe: 'iframe',
  DisclosureTriangle: 'summary',
  MenuListPopup: 'listbox',
  MenuListOption: 'option',
  RootWebArea: 'document',
  StaticText: 'text',
  LabelText: 'label',
};

export function displayRole(raw: string): string {
  return DISPLAY_ROLES[raw] ?? (raw ? raw[0].toLowerCase() + raw.slice(1) : raw);
}

export interface ONode {
  kind: 'element' | 'text';
  /** Chrome's role, as revalidation compares it. */
  rawRole: string;
  role: string;
  name: string;
  /** Chrome's name, when `name` has a masked value replaced in it: compared at revalidation, never printed. */
  rawName?: string;
  value?: string;
  masked?: boolean;
  states: string[];
  actionable: boolean;
  ref?: string;
  backendNodeId?: number;
  frameId: string;
  sessionId: SessionId;
  loaderId: string;
  url?: string;
  /** Shown after the line, for example why a frame was not captured. */
  note?: string;
  /** An iframe whose document is on another site than the page's. */
  site?: string;
  /** An iframe whose document was not captured (ad frames excepted): what it shows is unknown, so a screenshot
   *  blanks it. */
  unseen?: boolean;
  /** Set for nodes found or made actionable by layout signals (tier 2): revalidated by tag and text digest. */
  layout?: { tag: string; digest: string; names: string };
  children: ONode[];
}

function statesOf(node: AXNode, raw: string): string[] {
  const states: string[] = [];
  const checked = property(node, 'checked');
  if (CHECKABLE.has(raw) && checked !== undefined) {
    states.push(checked === 'true' || checked === true ? 'checked' : checked === 'mixed' ? 'mixed' : 'unchecked');
  }
  const pressed = property(node, 'pressed');
  if (pressed === 'true' || pressed === true) states.push('pressed');
  if (pressed === 'mixed') states.push('pressed: mixed');
  const expanded = property(node, 'expanded');
  if (expanded !== undefined) states.push(expanded === true || expanded === 'true' ? 'expanded' : 'collapsed');
  if (property(node, 'selected') === true) states.push('selected');
  const level = property(node, 'level');
  if (raw === 'heading' && level !== undefined) states.push(`level ${level}`);
  if (property(node, 'disabled') === true) states.push('disabled');
  if (property(node, 'required') === true) states.push('required');
  if (property(node, 'readonly') === true && EDITABLE.has(raw)) states.push('readonly');
  const invalid = property(node, 'invalid');
  if (invalid !== undefined && invalid !== 'false' && invalid !== false) states.push('invalid');
  if (property(node, 'modal') === true) states.push('modal');
  if (property(node, 'busy') === true) states.push('busy');
  if (property(node, 'focused') === true && raw !== 'RootWebArea') states.push('focused');
  return states;
}

function isActionable(node: AXNode, raw: string, name: string): boolean {
  if (!node.backendDOMNodeId) return false;
  if (INTERACTIVE_ROLES.has(raw)) return true;
  // A focusable element with a name and no interactive role: a custom control (tier 2 finds more).
  return property(node, 'focusable') === true && !!name && !NOT_ACTIONABLE_WHEN_FOCUSABLE.has(raw);
}

/**
 * How deep the outline goes. Real pages stay far below it; the HTML parser itself stops nesting at 512, and only script
 * builds deeper trees. The outline is built by recursion, and a service worker's stack overflows a few hundred levels
 * further down, so deeper parts are cut and the observation says so.
 */
export const MAX_TREE_DEPTH = 256;

/** Field roles whose value can be a credential; their attributes decide masking (capture.ts looks them up). */
const MASKABLE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);
/** Options, whose labels can be secrets in a sensitive select; a listbox's attributes are looked up too. */
const OPTION_ROLES = new Set(['option', 'MenuListOption']);
const SELECT_ROLES = new Set(['listbox', 'combobox']);

/**
 * Masks the options of a select by the rule of select read-backs (`isSensitiveLabel`): a card number anywhere, and in a
 * sensitive select a label without letters. The accessibility tree gives no option value, so a label that repeats a
 * coded value is masked only when it has no letters. A masked option is printed without a ref and without its text: the
 * agent selects through the select's own ref with `set`, whose errors and read-backs mask the same way.
 */
function maskOptions(nodes: ONode[], sensitiveSelect: boolean): void {
  for (const n of nodes) {
    if (OPTION_ROLES.has(n.rawRole)) {
      if (n.name && isSensitiveLabel({ index: 0, value: '', label: n.name }, sensitiveSelect)) {
        n.name = MASK;
        n.masked = true;
        n.note = 'masked';
        n.actionable = false;
        n.children = [];
      }
    } else maskOptions(n.children, sensitiveSelect);
  }
}

export interface TreeStats {
  /** Subtrees cut below MAX_TREE_DEPTH. */
  deepCut: number;
  /** Field values masked because the field's attributes were not read (fail closed). */
  unknownMasked?: number;
  /** The values masked, as they would appear in text: the result filter replaces them wherever they are printed. */
  secrets?: string[];
}

/**
 * The field facts of a frame, completed from the layout snapshot's attributes for fields the capture did not look up
 * (past its lookup limit, or when the lookup failed).
 */
export function completeFieldFacts(frame: FrameCapture, doc: LayoutDocument | undefined): Record<string, FieldFacts> {
  if (!doc) return frame.fields;
  let fields = frame.fields;
  for (const node of frame.nodes) {
    const id = node.backendDOMNodeId;
    const role = roleOf(node);
    if (!id || fields[String(id)]) continue;
    if (!(MASKABLE_ROLES.has(role) && valueOf(node)) && role !== 'listbox') continue;
    const el = doc.byBackendId.get(id);
    if (!el || el.tag === '#text') continue;
    if (fields === frame.fields) fields = { ...frame.fields };
    fields[String(id)] = {
      tag: el.tag,
      type: el.attrs.type?.toLowerCase(),
      autocomplete: el.attrs.autocomplete?.toLowerCase(),
      name: el.attrs.name,
      id: el.attrs.id,
    };
  }
  return fields;
}

/** Converts one frame's AX nodes into outline nodes (the frame's document children). */
export function buildFrameTree(frame: FrameCapture, stats: TreeStats = { deepCut: 0 }): ONode[] {
  const byId = new Map(frame.nodes.map(n => [n.nodeId, n]));
  const base = { frameId: frame.frameId, sessionId: frame.sessionId, loaderId: frame.loaderId };
  /** The values masked so far, in document order, as they would appear inside a name. */
  const secrets: string[] = [];

  const convert = (id: string, depth: number): ONode[] => {
    const node = byId.get(id);
    if (!node) return [];
    if (depth > MAX_TREE_DEPTH) {
      stats.deepCut++;
      return [];
    }
    const raw = roleOf(node);
    if (DROPPED.has(raw)) return [];
    const kids = () => (node.childIds ?? []).flatMap(c => convert(c, depth + 1));
    if (node.ignored) return kids();
    if (raw === 'StaticText') {
      const text = cleanText(nameOf(node));
      return text
        ? [
            {
              kind: 'text',
              rawRole: raw,
              role: 'text',
              name: text,
              states: [],
              actionable: false,
              children: [],
              backendNodeId: node.backendDOMNodeId,
              ...base,
            },
          ]
        : [];
    }
    const name = cleanText(nameOf(node));
    const actionable = isActionable(node, raw, name);
    if (raw === 'RootWebArea') return kids();
    if (raw === 'paragraph') {
      // A paragraph prints as one text line, unless it holds something actionable such as a link.
      const children = kids();
      if (hasActionable(children)) return children;
      const text = cleanText(rawText(node));
      return text
        ? [
            {
              kind: 'text',
              rawRole: raw,
              role: 'text',
              name: text,
              states: [],
              actionable: false,
              children: [],
              backendNodeId: node.backendDOMNodeId,
              ...base,
            },
          ]
        : [];
    }
    const before = secrets.length;
    let children = kids();
    const states = statesOf(node, raw);
    const out: ONode = {
      kind: 'element',
      rawRole: raw,
      role: displayRole(raw),
      name,
      states,
      actionable,
      backendNodeId: node.backendDOMNodeId,
      children: [],
      ...base,
    };
    const url = property(node, 'url');
    if (raw === 'link' && typeof url === 'string') out.url = url;
    if (VALUE_ROLES.has(raw)) {
      const value = valueOf(node);
      if (value !== undefined && value !== '') {
        const facts = frame.fields[String(node.backendDOMNodeId)];
        // A field whose attributes were not read could be a password or a one-time code: masked (fail closed).
        const unknown = !facts && MASKABLE_ROLES.has(raw);
        if (unknown) stats.unknownMasked = (stats.unknownMasked ?? 0) + 1;
        if (unknown || isSensitiveField(facts, name, value)) {
          out.value = MASK;
          out.masked = true;
          if (cleanText(value).length >= MIN_SECRET_LENGTH) secrets.push(cleanText(value));
          stats.secrets?.push(cleanText(value));
        } else {
          out.value = value;
        }
      }
      // The value's own text is not repeated; an expanded combobox keeps its popup's options.
      children = raw === 'combobox' && states.includes('expanded') ? children.filter(c => c.kind === 'element') : [];
    }
    // Options of a sensitive select, and card numbers in any select, are masked.
    if (OPTION_ROLES.has(raw)) {
      maskOptions([out], false);
      if (out.masked) children = [];
    } else if (SELECT_ROLES.has(raw)) {
      maskOptions(children, isSensitiveField(frame.fields[String(node.backendDOMNodeId)], name, ''));
    }
    if (raw === 'row' && !name) out.name = cleanText(collectText(children)).slice(0, 120);
    // Chrome puts the value of a text field into the name of an element that is named from its content and contains
    // the field (a custom radio or tab wrapping it, a heading). A value masked inside this element, or its own, is
    // replaced in its name too; the name as Chrome gave it is kept for revalidation, never printed.
    const inside = secrets.slice(before).filter(secret => out.name.includes(secret));
    if (inside.length) {
      out.rawName = out.name;
      for (const secret of inside) out.name = out.name.split(secret).join(MASK);
    }
    out.children = children;
    const transparent =
      !actionable && (ALWAYS_TRANSPARENT.has(raw) || (TRANSPARENT_UNLESS_NAMED.has(raw) && !name && !states.length));
    if (transparent) return children;
    if (!actionable && !out.name && !children.length && !states.length && raw !== 'Iframe') return [];
    return [out];
  };

  /** Text of an AX subtree as the page spells it, spaces included. */
  const rawText = (node: AXNode, depth = 0): string => {
    if (roleOf(node) === 'StaticText') return nameOf(node);
    if (depth > MAX_TREE_DEPTH) return '';
    return (node.childIds ?? [])
      .map(id => byId.get(id))
      .map(c => (c ? rawText(c, depth + 1) : ''))
      .join('');
  };

  const root = frame.nodes.find(n => !n.parentId) ?? frame.nodes[0];
  if (!root) return [];
  const tree = convert(root.nodeId, 0);
  // Elsewhere in the frame (an element whose `aria-labelledby` points at the field), only a value with a digit in
  // it is replaced: a card number or a code. A value made of letters could be a word of an unrelated control's name,
  // which the gate classifies.
  scrubNames(
    tree,
    secrets.filter(secret => /\d/.test(secret)),
  );
  return dedupeText(tree, []);
}

function scrubNames(nodes: ONode[], secrets: string[]): void {
  if (!secrets.length) return;
  const stack = [...nodes];
  while (stack.length) {
    const n = stack.pop()!;
    for (const secret of secrets) {
      if (!n.name.includes(secret)) continue;
      n.rawName ??= n.name;
      n.name = n.name.split(secret).join(MASK);
    }
    stack.push(...n.children);
  }
}

/** Masked values of one or two characters (a digit, a month) are not searched for in names: they would match by chance. */
const MIN_SECRET_LENGTH = 3;

function hasActionable(nodes: ONode[]): boolean {
  return nodes.some(n => n.actionable || hasActionable(n.children));
}

/** Text of a subtree in document order: text nodes and element names. */
export function collectText(nodes: ONode[]): string {
  const parts: string[] = [];
  const walk = (n: ONode) => {
    if (n.kind === 'text') parts.push(n.name);
    else if (n.children.length) n.children.forEach(walk);
    else if (n.name) parts.push(n.name);
  };
  nodes.forEach(walk);
  return parts.join(' ');
}

const norm = (s: string) =>
  cleanText(s)
    .replace(/[:*]+$/, '')
    .trim()
    .toLowerCase();

/**
 * Drops text that only repeats a name: text inside an element whose name contains it (a button's label, a row's
 * cells), and a label's text next to the control it names.
 */
function dedupeText(nodes: ONode[], ancestorNames: string[]): ONode[] {
  const siblingNames = new Set(nodes.filter(n => n.kind === 'element' && n.name).map(n => norm(n.name)));
  const out: ONode[] = [];
  for (const n of nodes) {
    if (n.kind === 'text') {
      const t = norm(n.name);
      // A label's text next to the control it names is dropped, also when it is only part of the name.
      const partOfSibling = t.length >= 3 && [...siblingNames].some(name => name.includes(t));
      // Separators and punctuation alone ("|", "·", "›") carry nothing for an agent.
      if (!/[\p{L}\p{N}]/u.test(t)) continue;
      if (!t || siblingNames.has(t) || partOfSibling || ancestorNames.some(a => a.includes(t))) continue;
      out.push(n);
      continue;
    }
    const names = n.name ? [...ancestorNames, norm(n.name)] : ancestorNames;
    out.push({ ...n, children: dedupeText(n.children, names) });
  }
  return out;
}

export interface LayoutSummary {
  /** Frames enriched by the layout snapshot. */
  frames: number;
  added: number;
  promoted: number;
}

/** Decodes the raw layout snapshots of a capture, by frame ID. */
export function decodeLayout(capture: Capture): Map<string, LayoutDocument> {
  const out = new Map<string, LayoutDocument>();
  for (const raw of Object.values(capture.layout ?? {}))
    for (const doc of decodeSnapshot(raw, capture.viewport?.scale ?? 1)) out.set(doc.frameId, doc);
  return out;
}

/** An iframe element: the frame it is in and its backend node. */
export interface FrameOwner {
  frameId: string;
  backendNodeId: number;
}

export interface StitchedFrame {
  frameId: string;
  url: string;
  status: FrameCapture['status'];
  reason?: string;
}

/** Builds every frame and places each child frame's content under its owner iframe (the port's injectSubtrees). */
export function stitchFrames(capture: Capture): {
  roots: ONode[];
  /** Frames with no place in the outline: not captured, or captured with content whose iframe is not in it. */
  orphans: StitchedFrame[];
  /**
   * Iframe elements whose frame could not be placed under them (the iframe is not in the outline, for example inside
   * `aria-hidden`): their content is not shown, so a screenshot paints over them. Ad frames are left out.
   */
  unplaced: FrameOwner[];
  layout: LayoutSummary;
  docs: Map<string, LayoutDocument>;
  /** Subtrees left out because they were nested deeper than MAX_TREE_DEPTH. */
  deepCut: number;
  /** Field values masked because their attributes were not read. */
  unknownMasked: number;
  /** The values the outline masks, for the result filter. */
  secrets: string[];
} {
  const depthStats: TreeStats = { deepCut: 0, unknownMasked: 0, secrets: [] };
  const trees = new Map<string, ONode[]>();
  const layout = decodeLayout(capture);
  const summary: LayoutSummary = { frames: 0, added: 0, promoted: 0 };
  for (const frame of capture.frames) {
    if (frame.status !== 'captured') continue;
    const doc = layout.get(frame.frameId);
    let tree = buildFrameTree({ ...frame, fields: completeFieldFacts(frame, doc) }, depthStats);
    if (doc) {
      const enriched = enrichFrame(tree, doc, {
        frameId: frame.frameId,
        sessionId: frame.sessionId,
        loaderId: frame.loaderId,
      });
      tree = enriched.roots;
      summary.frames++;
      summary.added += enriched.stats.added;
      summary.promoted += enriched.stats.promoted;
    }
    trees.set(frame.frameId, tree);
  }
  const owners = new Map<string, ONode>();
  const indexOwners = (nodes: ONode[]) => {
    for (const n of nodes) {
      if (n.rawRole === 'Iframe' && n.backendNodeId) owners.set(`${n.frameId}|${n.backendNodeId}`, n);
      indexOwners(n.children);
    }
  };
  for (const nodes of trees.values()) indexOwners(nodes);
  const orphans: StitchedFrame[] = [];
  const unplaced: FrameOwner[] = [];
  const captured = new Set(capture.frames.filter(f => f.status === 'captured').map(f => f.frameId));
  const pageSite = siteOf(capture.frames[0]?.url ?? '');
  // Parents come before children in tree order, so owner nodes exist by the time a child is placed.
  for (const frame of capture.frames.slice(1)) {
    const owner =
      frame.parentFrameId && frame.ownerBackendNodeId !== null
        ? owners.get(`${frame.parentFrameId}|${frame.ownerBackendNodeId}`)
        : undefined;
    if (!owner) {
      // Inside a frame that was not captured, the outer frame's own iframe is painted over already.
      if (
        frame.parentFrameId &&
        captured.has(frame.parentFrameId) &&
        frame.ownerBackendNodeId !== null &&
        !frame.adFrame
      )
        unplaced.push({ frameId: frame.parentFrameId, backendNodeId: frame.ownerBackendNodeId });
      // A captured frame with content is left out of the outline: the observation reports it.
      if (frame.status !== 'captured' || trees.get(frame.frameId)?.length) {
        orphans.push({ frameId: frame.frameId, url: frame.url, status: frame.status, reason: frame.reason });
      }
      continue;
    }
    const frameSite = siteOf(frame.url);
    if (frameSite && frameSite !== pageSite) owner.site = frameSite;
    if (frame.status === 'captured') {
      owner.children = trees.get(frame.frameId) ?? [];
      indexOwners(owner.children);
    } else {
      owner.note = `not captured: ${frame.reason ?? frame.status}`;
      owner.unseen = !frame.adFrame;
    }
  }
  const roots = trees.get(capture.frames[0]?.frameId ?? '') ?? [];
  depthStats.deepCut += cutDeeperThan(roots, MAX_TREE_DEPTH);
  return {
    roots,
    orphans,
    unplaced,
    layout: summary,
    docs: layout,
    deepCut: depthStats.deepCut,
    unknownMasked: depthStats.unknownMasked ?? 0,
    secrets: depthStats.secrets ?? [],
  };
}

/**
 * Cuts children deeper than `max` levels of the stitched outline, without recursion: each frame is within the limit
 * on its own, but frames inside frames add up. Returns how many subtrees were cut.
 */
function cutDeeperThan(roots: ONode[], max: number): number {
  let cut = 0;
  const stack: Array<[ONode, number]> = roots.map(n => [n, 1]);
  while (stack.length) {
    const [n, depth] = stack.pop()!;
    if (depth >= max) {
      if (n.children.length) cut++;
      n.children = [];
      continue;
    }
    for (const c of n.children) stack.push([c, depth + 1]);
  }
  return cut;
}

// ---------------------------------------------------------------------------------------------------------------
// Refs

export type AssignRef = (node: ONode, nth: number | null, ancestors: ONode[]) => string;

/** Gives every actionable node a ref, in document order. `nth` counts same role and name within a frame. */
export function assignRefs(roots: ONode[], assign: AssignRef): void {
  const counts = new Map<string, number>();
  const keyOf = (n: ONode) => `${n.frameId}|${n.rawRole}|${n.name}`;
  const count = (n: ONode) => {
    if (n.actionable && n.backendNodeId) counts.set(keyOf(n), (counts.get(keyOf(n)) ?? 0) + 1);
    n.children.forEach(count);
  };
  roots.forEach(count);
  const seen = new Map<string, number>();
  const walk = (n: ONode, ancestors: ONode[]) => {
    if (n.actionable && n.backendNodeId) {
      const k = keyOf(n);
      const index = seen.get(k) ?? 0;
      seen.set(k, index + 1);
      n.ref = assign(n, (counts.get(k) ?? 0) > 1 ? index : null, ancestors);
    }
    n.children.forEach(c => walk(c, [...ancestors, n]));
  };
  roots.forEach(r => walk(r, []));
}

// ---------------------------------------------------------------------------------------------------------------
// Rendering

const LANDMARKS = new Set([
  'navigation',
  'main',
  'banner',
  'contentinfo',
  'complementary',
  'region',
  'form',
  'search',
  'dialog',
  'alertdialog',
  'table',
  'grid',
  'treegrid',
  'row',
  'list',
  'listbox',
  'menu',
  'menubar',
  'tablist',
  'tabpanel',
  'tree',
  'toolbar',
  'group',
  'article',
  'heading',
  'iframe',
  'alert',
  'status',
]);

/** Keeps actionable nodes, headings, and the named or landmark containers around them. */
export function interactiveOnly(nodes: ONode[]): ONode[] {
  const out: ONode[] = [];
  for (const n of nodes) {
    if (n.kind === 'text') continue;
    const children = interactiveOnly(n.children);
    if (n.actionable || n.role === 'heading') out.push({ ...n, children });
    else if (children.length && (LANDMARKS.has(n.role) || n.name)) out.push({ ...n, children });
    else out.push(...children);
  }
  return out;
}

const MAX_TEXT = 160;

export function quote(s: string, max = MAX_TEXT): string {
  const t = s.length > max ? `${s.slice(0, max - 1)}…` : s;
  return `"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export function renderLine(n: ONode): string {
  if (n.kind === 'text') return `text ${quote(n.name)}`;
  let line = n.ref ? `[${n.ref}] ${n.role}` : n.role;
  if (n.name) line += ` ${quote(n.name)}`;
  if (n.states.length) line += ` (${n.states.join(', ')})`;
  if (n.value !== undefined) line += ` = ${n.masked ? `"${MASK}" (masked)` : quote(n.value, 200)}`;
  if (n.site) line += ` (site ${n.site})`;
  if (n.note) line += ` (${n.note})`;
  return line;
}

export interface RenderedLine {
  text: string;
  depth: number;
  ref?: string;
  node: ONode;
}

export function renderLines(roots: ONode[]): RenderedLine[] {
  const lines: RenderedLine[] = [];
  const walk = (n: ONode, depth: number) => {
    lines.push({ text: `${'  '.repeat(depth)}${renderLine(n)}`, depth, ref: n.ref, node: n });
    n.children.forEach(c => walk(c, depth + 1));
  };
  roots.forEach(r => walk(r, 0));
  return lines;
}

export interface Budgeted {
  lines: RenderedLine[];
  cutLines: number;
  cutRefs: number;
}

/**
 * Applies the character budget before the known set is recorded, so the printed refs and the accepted refs are
 * the same set. Without geometry (tier 1), lines are cut from the end of the document.
 */
export function applyBudget(lines: RenderedLine[], budget: number): Budgeted {
  let used = 0;
  let i = 0;
  for (; i < lines.length; i++) {
    used += lines[i].text.length + 1;
    if (used > budget) break;
  }
  const cut = lines.slice(i);
  return { lines: lines.slice(0, i), cutLines: cut.length, cutRefs: cut.filter(l => l.ref).length };
}
