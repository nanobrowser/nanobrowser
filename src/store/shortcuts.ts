// Shortcuts: saved prompts the user starts with `/`. Each is stored as the text of an Agent Skills file (`SKILL.md`):
// YAML front matter with `name` and `description`, the Nanobrowser fields under `metadata.nanobrowser`, then the
// prompt. Only this module writes the files, so the parser reads the subset it writes: scalars, nested maps by
// indentation, and quoted strings.
import { db } from './db';
import { newId } from './conversations';
import type { ModelRef, PermissionMode, StoredShortcut } from './types';

export interface Shortcut {
  /** Lowercase letters, digits and hyphens, as Agent Skills names are; the launcher shows `/name`. */
  name: string;
  description: string;
  /** The prompt, sent as the user's message. */
  text: string;
  startUrl?: string;
  mode?: PermissionMode;
  model?: ModelRef;
}

export const NAME_MAX = 64;
export const DESCRIPTION_MAX = 1024;
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Why a shortcut cannot be saved, or null. Messages are i18n keys for the editor. */
export function checkShortcut(
  s: Shortcut,
  others: Array<{ name: string }> = [],
): 'shortcut.error.name' | 'shortcut.error.taken' | 'shortcut.error.text' | 'shortcut.error.url' | null {
  if (!NAME.test(s.name) || s.name.length > NAME_MAX) return 'shortcut.error.name';
  if (s.name === 'new' || s.name === 'compact' || others.some(o => o.name === s.name)) return 'shortcut.error.taken';
  if (!s.text.trim()) return 'shortcut.error.text';
  if (s.startUrl && !isStartUrl(s.startUrl)) return 'shortcut.error.url';
  return null;
}

/** A start URL is a web address: nothing the browser would run or open locally. */
export function isStartUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function scalar(value: string): string {
  // Plain when YAML reads it back as the same string, quoted (JSON is valid YAML) otherwise.
  return /^[A-Za-z0-9][\w ./:?=&%+~,@()-]*$/.test(value) && !/: |\s$|^(true|false|null|yes|no|~)$/i.test(value)
    ? value
    : JSON.stringify(value);
}

/** The `SKILL.md` text of a shortcut. */
export function toSkillMd(s: Shortcut): string {
  const lines = [
    '---',
    `name: ${s.name}`,
    `description: ${scalar(s.description.replace(/\s+/g, ' ').trim())}`,
    'disable-model-invocation: true',
    'user-invocable: true',
  ];
  const meta: string[] = [];
  if (s.startUrl) meta.push(`    start-url: ${scalar(s.startUrl)}`);
  if (s.mode) meta.push(`    mode: ${s.mode}`);
  if (s.model) meta.push(`    provider: ${scalar(s.model.providerId)}`, `    model: ${scalar(s.model.model)}`);
  if (meta.length) lines.push('metadata:', '  nanobrowser:', ...meta);
  lines.push('---', s.text.replace(/\s+$/, ''), '');
  return lines.join('\n');
}

type Yaml = { [key: string]: string | Yaml };

function unquote(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value.replace(/\s+#.*$/, '');
}

function parseYaml(lines: string[]): Yaml {
  const root: Yaml = {};
  const stack: Array<{ indent: number; map: Yaml }> = [{ indent: -1, map: root }];
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const match = /^([\w-]+):(.*)$/.exec(line.trim());
    if (!match) continue;
    while (stack.length > 1 && stack.at(-1)!.indent >= indent) stack.pop();
    const parent = stack.at(-1)!.map;
    const [, key, rest] = match;
    if (rest.trim() === '' || rest.trim().startsWith('#')) {
      const child: Yaml = {};
      parent[key] = child;
      stack.push({ indent, map: child });
    } else {
      parent[key] = unquote(rest);
    }
  }
  return root;
}

const str = (v: string | Yaml | undefined): string | undefined => (typeof v === 'string' ? v : undefined);

/** A shortcut from its `SKILL.md` text, or null when the text is not one. */
export function parseSkillMd(text: string): Shortcut | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return null;
  const yaml = parseYaml(match[1].split(/\r?\n/));
  const name = str(yaml.name);
  if (!name) return null;
  const meta = typeof yaml.metadata === 'object' ? yaml.metadata.nanobrowser : undefined;
  const nb = typeof meta === 'object' ? meta : {};
  const mode = str(nb.mode);
  const provider = str(nb.provider);
  const model = str(nb.model);
  const startUrl = str(nb['start-url']);
  return {
    name,
    description: str(yaml.description) ?? '',
    text: match[2].replace(/\s+$/, ''),
    ...(startUrl && isStartUrl(startUrl) ? { startUrl } : {}),
    ...(mode === 'ask' || mode === 'auto' ? { mode } : {}),
    ...(provider && model ? { model: { providerId: provider, model } } : {}),
  };
}

export interface SavedShortcut extends Shortcut {
  id: string;
  pinned: boolean;
  updatedAt: string;
}

function read(stored: StoredShortcut): SavedShortcut | null {
  const parsed = parseSkillMd(stored.text);
  return parsed ? { ...parsed, id: stored.id, pinned: stored.pinned, updatedAt: stored.updatedAt } : null;
}

/** Pinned first, then by name: the launcher's order. */
export function launcherOrder(list: SavedShortcut[]): SavedShortcut[] {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
}

export async function listShortcuts(): Promise<SavedShortcut[]> {
  const all = await (await db()).getAll('shortcuts');
  return launcherOrder(all.map(read).filter((s): s is SavedShortcut => !!s));
}

/** Writes a shortcut: a new one without `id`. Returns its id. */
export async function saveShortcut(s: Shortcut & { id?: string; pinned?: boolean }): Promise<string> {
  const id = s.id ?? newId();
  await (
    await db()
  ).put('shortcuts', { id, text: toSkillMd(s), pinned: !!s.pinned, updatedAt: new Date().toISOString() });
  notify();
  return id;
}

export async function setPinned(id: string, pinned: boolean): Promise<void> {
  const database = await db();
  const stored = await database.get('shortcuts', id);
  if (!stored) return;
  await database.put('shortcuts', { ...stored, pinned, updatedAt: new Date().toISOString() });
  notify();
}

export async function deleteShortcut(id: string): Promise<void> {
  await (await db()).delete('shortcuts', id);
  notify();
}

export async function clearShortcuts(): Promise<void> {
  await (await db()).clear('shortcuts');
  notify();
}

// The panel and the settings page are separate documents: a change in one reaches the other through a broadcast.
const CHANNEL = 'nb-shortcuts';

function notify(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage('changed');
  channel.close();
}

/** Calls `listener` when shortcuts change in any of the extension's pages. */
export function onShortcutsChanged(listener: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = () => listener();
  return () => channel.close();
}
