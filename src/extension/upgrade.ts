// The update from the old Nanobrowser (0.2). It ran on the same store listing, so its data is in this extension's
// chrome.storage.local. On each worker start, while that data is there, this moves the user's providers, keys, default
// model, saved prompts and blocked sites into this version's stores, then removes the old keys. The old conversations
// stay: this version cannot open them, and Settings → Data exports or deletes them.
//
// Order: shortcuts, then every setting in one write together with the upgrade record, then the cleanup. The old keys
// are removed only once the record is stored, and nothing is written twice, so a worker stopped half way finishes on
// its next start.
import { siteOf } from '@src/browser-control';
import { OLD_CHATS_KEY, OLD_KEYS, UPGRADE_KEY, listShortcuts, mergeSettings, saveShortcut } from '@src/store';
import type { ReasoningEffort } from '@src/llm/catalogue';
import type { ModelRef, ProviderConfig, ProviderKind, SiteRuleEntry, UpgradeRecord } from '@src/store';
import { addFirstShortcuts } from './first-run';
import { WHATS_NEW_KEY } from '@src/store/whats-new';
import type { WhatsNewState } from '@src/store/whats-new';
import { WHATS_NEW, releaseOf } from '@src/ui/whats-new';

// ---- Providers ----

interface OldProvider {
  name?: string;
  type?: string;
  apiKey?: string;
  baseUrl?: string;
  modelNames?: string[];
}

const BUILT_IN = ['openai', 'anthropic', 'deepseek', 'gemini', 'grok', 'ollama', 'openrouter'];

/** Providers the old version removed; it deleted their records, keys included, when it read them. */
const REMOVED = ['cerebras', 'llama', 'groq'];

const OLD_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  gemini: 'Gemini',
  grok: 'Grok',
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
};

/** The model lists the old version gave a built-in provider that had none of its own. */
const OLD_MODELS: Record<string, string[]> = {
  openai: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna'],
  anthropic: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-haiku-4-5'],
  deepseek: ['deepseek-flash', 'deepseek-v4-pro'],
  gemini: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'],
  grok: ['grok-4.7'],
  ollama: ['qwen3.8', 'qwen3.8:27b-mlx'],
  openrouter: ['google/gemini-2.5-pro', 'google/gemini-2.5-flash', 'openai/gpt-4o-2024-11-20'],
};

/** The old version's type for a record without one, from the provider's id. */
function oldType(id: string): string {
  if (id === 'azure_openai' || id.startsWith('azure_openai_')) return 'azure_openai';
  return BUILT_IN.includes(id) ? id : 'custom_openai';
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The old providers and their keys, as this version stores them. Azure and the removed providers are dropped. */
export function moveProviders(raw: unknown): { providers: ProviderConfig[]; keys: Record<string, string> } {
  const records = (raw as { providers?: Record<string, OldProvider> } | undefined)?.providers;
  const providers: ProviderConfig[] = [];
  const keys: Record<string, string> = {};
  if (!records || typeof records !== 'object') return { providers, keys };
  for (const [id, record] of Object.entries(records)) {
    if (REMOVED.includes(id) || !record || typeof record !== 'object') continue;
    const type = str(record.type) || oldType(id);
    const name = str(record.name) || OLD_NAMES[id] || id;
    const listed = Array.isArray(record.modelNames) ? record.modelNames.map(str).filter(Boolean) : null;
    const names = [...new Set(listed ?? OLD_MODELS[type] ?? [])];
    const base = { id, models: names.map(n => ({ name: n })) };
    let provider: ProviderConfig;
    switch (type) {
      case 'openai':
      case 'anthropic':
      case 'gemini':
      case 'openrouter':
        // OpenRouter's address is fixed here, so an address the user changed is not kept.
        provider = { ...base, kind: type as ProviderKind, name };
        break;
      case 'ollama':
        provider = {
          ...base,
          kind: 'ollama',
          name,
          baseUrl: (str(record.baseUrl) || 'http://localhost:11434').replace(/\/+$/, '').replace(/\/v1$/, ''),
        };
        break;
      case 'deepseek':
        provider = { ...base, kind: 'openai-compatible', name, baseUrl: 'https://api.deepseek.com/v1' };
        break;
      case 'grok':
        provider = {
          ...base,
          kind: 'openai-compatible',
          name: name === 'Grok' ? 'xAI Grok' : name,
          baseUrl: 'https://api.x.ai/v1',
        };
        break;
      case 'custom_openai':
        provider = { ...base, kind: 'openai-compatible', name, baseUrl: str(record.baseUrl) };
        break;
      default:
        // Azure OpenAI, which this version does not offer, and any type it does not know.
        continue;
    }
    providers.push(provider);
    const key = str(record.apiKey);
    if (key && !(type === 'ollama' && key === 'ollama')) keys[id] = key;
  }
  return { providers, keys };
}

// ---- The default model and its effort ----

/** The old effort as this version's: the old `none` sent nothing, so the model's own default applied. */
export function moveEffort(old: unknown): ReasoningEffort | null {
  switch (old) {
    case 'low':
    case 'medium':
    case 'high':
      return old;
    case 'xhigh':
      return 'high';
    case 'minimal':
    case 'minimal/none':
      return 'low';
    default:
      return null;
  }
}

/** The old navigator's model as the default model, when its provider was moved; it joins the list if missing. */
export function moveDefaultModel(
  raw: unknown,
  providers: ProviderConfig[],
): { model: ModelRef; reasoning: ReasoningEffort | null } | null {
  const navigator = (
    raw as { agents?: Record<string, { provider?: string; modelName?: string; reasoningEffort?: string }> }
  )?.agents?.navigator;
  const providerId = str(navigator?.provider);
  const model = str(navigator?.modelName);
  const provider = providers.find(p => p.id === providerId);
  if (!provider || !model) return null;
  if (!provider.models.some(m => m.name === model)) provider.models.push({ name: model });
  return { model: { providerId, model }, reasoning: moveEffort(navigator?.reasoningEffort) };
}

// ---- Saved prompts ----

/** Every title and text the old version ever seeded as its example prompts. Those are not the user's own. */
const SEEDED: Array<{ title: string; content: string }> = [
  {
    title: '📚 Explore AI Papers',
    content:
      '- Go to https://huggingface.co/papers and click through each of the first 3 papers.\n- For each paper:\n  - Record the title, URL and upvotes\n  - Summarise the abstract section\n- Finally, compile together a summary of all 3 papers, ranked by upvotes',
  },
  {
    title: '📚 Explore AI Papers',
    content:
      '- Go to https://huggingface.co/papers and click through each of the top 3 upvoted papers.\n- For each paper:\n  - Record the title, URL and upvotes\n  - Summarise the abstract section\n- Finally, compile together a summary of all 3 papers, ranked by upvotes',
  },
  {
    title: '🐦 Follow us on X/Twitter!',
    content: 'Follow us at https://x.com/nanobrowser_ai to stay updated on the latest news and features!',
  },
  {
    title: '🌟 Star us on GitHub!',
    content:
      "Open the Nanobrowser repository at https://github.com/nanobrowser/nanobrowser and check if you've already starred it. If not, please support us by giving us a star!",
  },
];

export interface OldFavorite {
  id: number | string;
  title: string;
  content: string;
}

/** The saved prompts to move: the user's own, with text. */
export function favoritesToMove(raw: unknown): OldFavorite[] {
  const prompts = (raw as { prompts?: unknown[] } | undefined)?.prompts;
  if (!Array.isArray(prompts)) return [];
  return prompts.filter((p): p is OldFavorite => {
    const f = p as Partial<OldFavorite> | null;
    if (!f || (typeof f.id !== 'number' && typeof f.id !== 'string') || !str(f.content)) return false;
    return !SEEDED.some(s => s.title === f.title && s.content === f.content);
  });
}

const RESERVED = ['new', 'compact'];
const NAME_MAX = 64;

/** A shortcut name from a title: lowercase letters, digits and single hyphens, unique among `taken`. */
export function shortcutName(title: string, taken: Set<string>): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, NAME_MAX)
    .replace(/-+$/, '');
  const free = (name: string) => !taken.has(name) && !RESERVED.includes(name);
  if (!slug) {
    for (let n = 1; ; n++) if (free(`prompt-${n}`)) return `prompt-${n}`;
  }
  if (free(slug)) return slug;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const name = `${slug.slice(0, NAME_MAX - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (free(name)) return name;
  }
}

// ---- Blocked sites ----

interface OldFirewall {
  enabled?: boolean;
  allowList?: unknown[];
  denyList?: unknown[];
}

/**
 * The old deny list as Block rules, when the old firewall was on. An entry becomes the rule for its site when it is a
 * whole site: no path but `/`, no query, fragment or user name, and no `*`. Other entries are counted as skipped.
 */
export function moveBlockedSites(
  raw: unknown,
  setAt: string,
): { rules: Record<string, SiteRuleEntry>; skipped: number; allowList: boolean } {
  const firewall = (raw ?? {}) as OldFirewall;
  const rules: Record<string, SiteRuleEntry> = {};
  if (firewall.enabled === false) return { rules, skipped: 0, allowList: false };
  let skipped = 0;
  for (const entry of Array.isArray(firewall.denyList) ? firewall.denyList : []) {
    const text = str(entry).toLowerCase();
    if (!text) continue;
    // A wildcard gives no site. Chrome escapes `*` in a host as `%2a`, so it is looked for before parsing.
    if (text.includes('*')) {
      skipped++;
      continue;
    }
    let site = '';
    try {
      const url = new URL(`https://${text.replace(/^https?:\/\//, '')}`);
      const whole = url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
      if (whole) site = siteOf(url.href);
    } catch {
      site = '';
    }
    if (site) rules[site] = { rule: 'block', setAt };
    else skipped++;
  }
  const allowList = Array.isArray(firewall.allowList) && firewall.allowList.some(e => str(e));
  return { rules, skipped, allowList };
}

// ---- The move ----

let running: Promise<void> | null = null;

/** Runs the move when the old version's data is there. Safe to call on every worker start, and more than once. */
export function upgradeFromOldVersion(): Promise<void> {
  running ??= move().finally(() => {
    running = null;
  });
  return running;
}

async function move(): Promise<void> {
  const stored = await chrome.storage.local.get([...OLD_KEYS, OLD_CHATS_KEY, UPGRADE_KEY]);
  const oldKeys = OLD_KEYS.filter(k => k in stored);
  const hasRecord = !!stored[UPGRADE_KEY];
  if (!hasRecord && !oldKeys.length && !(OLD_CHATS_KEY in stored)) return;

  if (!hasRecord) {
    const favorites = favoritesToMove(stored.favorites);
    await moveShortcuts(favorites);
    await moveSettings(stored, favorites.length);
  }
  if (oldKeys.length) await chrome.storage.local.remove(oldKeys);
}

/** Writes each saved prompt as a shortcut, and `/summarize`, leaving any already written by an earlier run. */
async function moveShortcuts(favorites: OldFavorite[]): Promise<void> {
  const existing = await listShortcuts();
  const ids = new Set(existing.map(s => s.id));
  const taken = new Set(existing.map(s => s.name));
  for (const f of favorites) {
    const id = `old-favorite-${f.id}`;
    if (ids.has(id)) continue;
    const name = shortcutName(str(f.title), taken);
    taken.add(name);
    await saveShortcut({ id, name, description: str(f.title).slice(0, 1024), text: String(f.content) });
  }
  if (!ids.has('upgrade-summarize') && !taken.has('summarize')) await addFirstShortcuts('upgrade-summarize');
}

/** Providers, keys, the default model, Block rules and the upgrade record, in one write. What is there stays. */
async function moveSettings(stored: Record<string, unknown>, favorites: number): Promise<void> {
  const at = new Date().toISOString();
  const now = await chrome.storage.local.get(['nb.providers', 'nb.keys', 'nb.settings', 'nb.siteRules', WHATS_NEW_KEY]);
  const existing = Array.isArray(now['nb.providers']) ? (now['nb.providers'] as ProviderConfig[]) : [];
  const moved = moveProviders(stored['llm-api-keys']);
  const added = moved.providers.filter(p => !existing.some(e => e.id === p.id));
  const def = moveDefaultModel(stored['agent-models'], added);
  const keys = Object.fromEntries(Object.entries(moved.keys).filter(([id]) => added.some(p => p.id === id)));
  const sites = moveBlockedSites(stored['firewall-settings'], at);

  const items: Record<string, unknown> = {
    'nb.providers': [...existing, ...added],
    'nb.keys': { ...keys, ...((now['nb.keys'] as Record<string, string> | undefined) ?? {}) },
    'nb.siteRules': { ...sites.rules, ...((now['nb.siteRules'] as Record<string, SiteRuleEntry> | undefined) ?? {}) },
  };
  const settings = mergeSettings(now['nb.settings']);
  if (def && !settings.defaultModel) {
    items['nb.settings'] = {
      ...((now['nb.settings'] as object | undefined) ?? {}),
      defaultModel: def.model,
      ...(def.reasoning ? { reasoning: def.reasoning } : {}),
    };
  }
  const record: UpgradeRecord = {
    at,
    favorites,
    blockedSites: Object.keys(sites.rules).length,
    skippedSites: sites.skipped,
    allowList: sites.allowList,
    analytics: (stored['analytics-settings'] as { enabled?: unknown } | undefined)?.enabled !== false,
    dismissed: false,
  };
  items[UPGRADE_KEY] = record;
  // The release's What's new card, with this update's rows, unless it was already opened (and maybe closed).
  const release = releaseOf(chrome.runtime.getManifest().version);
  if (WHATS_NEW[release] && (now[WHATS_NEW_KEY] as WhatsNewState | undefined)?.version !== release) {
    items[WHATS_NEW_KEY] = { version: release, dismissed: false } satisfies WhatsNewState;
  }
  await chrome.storage.local.set(items);
}
