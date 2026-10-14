// Accessibility.getFullAXTree payload types and small helpers.

export interface AXValue {
  type: string;
  value?: unknown;
}

export interface AXProperty {
  name: string;
  value: AXValue;
}

export interface AXNode {
  nodeId: string;
  ignored: boolean;
  /** Why the node is ignored (aria-hidden, not rendered, ...), as getPartialAXTree reports it. */
  ignoredReasons?: AXProperty[];
  role?: AXValue;
  chromeRole?: AXValue;
  name?: AXValue;
  description?: AXValue;
  value?: AXValue;
  properties?: AXProperty[];
  parentId?: string;
  childIds?: string[];
  backendDOMNodeId?: number;
  frameId?: string;
}

export function roleOf(node: AXNode): string {
  return typeof node.role?.value === 'string' ? node.role.value : '';
}

export function nameOf(node: AXNode): string {
  return typeof node.name?.value === 'string' ? node.name.value : '';
}

export function valueOf(node: AXNode): string | undefined {
  const v = node.value?.value;
  if (v === undefined || v === null) return undefined;
  return String(v);
}

export function property(node: AXNode, name: string): unknown {
  return node.properties?.find(p => p.name === name)?.value.value;
}

/** Collapses whitespace runs, drops private-use glyphs, trims (the port's cleanText, plus newlines). */
export function cleanText(input: string): string {
  let out = '';
  let space = false;
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code >= 0xe000 && code <= 0xf8ff) continue;
    if (/\s/.test(ch) || code === 0xa0 || code === 0x202f || code === 0x2007 || code === 0xfeff || code === 0x200b) {
      if (!space) out += ' ';
      space = true;
      continue;
    }
    out += ch;
    space = false;
  }
  return out.trim();
}
