// Content for `read`: the page or one element as Markdown or plain text, from the same capture as the outline, so
// frames and closed shadow roots are included and masked values stay masked.
import type { ONode } from './outline';
import { MASK } from './masking';

const BLOCK_CONTAINERS = new Set([
  'list',
  'table',
  'grid',
  'treegrid',
  'navigation',
  'main',
  'form',
  'region',
  'article',
  'banner',
  'contentinfo',
  'complementary',
  'dialog',
  'alertdialog',
  'group',
  'tablist',
  'tabpanel',
  'menu',
  'menubar',
  'toolbar',
  'tree',
  'listbox',
  'iframe',
  'blockquote',
  'figure',
  'search',
]);
const FIELD_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider']);
const TOGGLE_ROLES = new Set(['checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio']);

export function renderContent(roots: ONode[], format: 'markdown' | 'text'): string {
  const md = format === 'markdown';
  const lines: string[] = [];
  const push = (line: string) => {
    if (line.trim()) lines.push(line);
  };
  const walk = (n: ONode, listDepth: number) => {
    if (n.kind === 'text') return push(n.name);
    const value = n.masked ? MASK : n.value;
    switch (n.role) {
      case 'heading': {
        const level = Number(/level (\d)/.exec(n.states.join(' '))?.[1] ?? 2);
        return push(md ? `${'#'.repeat(Math.min(6, level))} ${n.name}` : n.name);
      }
      case 'link':
        return push(md && n.url ? `[${n.name || n.url}](${n.url})` : n.name);
      case 'listitem': {
        const indent = '  '.repeat(Math.max(0, listDepth - 1));
        const own = n.name && !n.children.length ? n.name : '';
        const before = lines.length;
        if (own) push(`${indent}- ${own}`);
        else {
          n.children.forEach(c => walk(c, listDepth));
          if (lines.length > before) lines[before] = `${indent}- ${lines[before]}`;
        }
        return;
      }
      case 'row':
        if (n.name) push(md ? `| ${n.name} |` : n.name);
        return;
      case 'image':
      case 'img':
        return push(md ? `![${n.name}]` : n.name ? `[image: ${n.name}]` : '');
      default:
        break;
    }
    if (FIELD_ROLES.has(n.role)) return push(`${n.name || n.role}: ${value ?? ''}`);
    if (TOGGLE_ROLES.has(n.role)) return push(`${n.states.includes('checked') ? '[x]' : '[ ]'} ${n.name}`);
    if (
      n.role === 'button' ||
      n.role === 'summary' ||
      n.role === 'tab' ||
      n.role === 'option' ||
      n.role === 'menuitem'
    ) {
      return push(n.children.length ? '' : n.name);
    }
    if (BLOCK_CONTAINERS.has(n.role) && n.children.length) {
      if (lines.length && lines[lines.length - 1] !== '') lines.push('');
      n.children.forEach(c => walk(c, n.role === 'list' ? listDepth + 1 : listDepth));
      if (lines.length && lines[lines.length - 1] !== '') lines.push('');
      return;
    }
    if (!n.children.length) return push(n.name);
    n.children.forEach(c => walk(c, listDepth));
  };
  roots.forEach(r => walk(r, 0));
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Slices content for maxChars and offset, and says what is left. */
export function sliceContent(content: string, offset: number, maxChars: number): { text: string; remaining: number } {
  const text = content.slice(offset, offset + maxChars);
  return { text, remaining: Math.max(0, content.length - offset - text.length) };
}
