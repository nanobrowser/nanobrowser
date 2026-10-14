import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import old from '../../../fixtures/upgrade/old-storage.json';
import { closeDb, deleteShortcut, listShortcuts, saveShortcut, setPinned } from '@src/store';
import type { ProviderConfig, UpgradeRecord } from '@src/store';
import {
  favoritesToMove,
  moveBlockedSites,
  moveDefaultModel,
  moveEffort,
  moveProviders,
  shortcutName,
  upgradeFromOldVersion,
} from '../upgrade';

/** chrome.storage.local in memory, with the calls the move makes. */
function fakeLocal(initial: Record<string, unknown>) {
  const data: Record<string, unknown> = structuredClone(initial);
  const area = {
    get: vi.fn(async (keys: string[] | string | null) => {
      if (keys === null) return structuredClone(data);
      const list = typeof keys === 'string' ? [keys] : keys;
      return structuredClone(Object.fromEntries(list.filter(k => k in data).map(k => [k, data[k]])));
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, structuredClone(items));
    }),
    remove: vi.fn(async (keys: string[] | string) => {
      for (const k of typeof keys === 'string' ? [keys] : keys) delete data[k];
    }),
    onChanged: { addListener: () => undefined },
  };
  vi.stubGlobal('chrome', { storage: { local: area }, runtime: { getManifest: () => ({ version: '0.3.0' }) } });
  vi.stubGlobal('navigator', { language: 'en-US' });
  return { data, area };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});

describe('moving providers', () => {
  const { providers, keys } = moveProviders(old['llm-api-keys']);
  const byId = (id: string) => providers.find(p => p.id === id);

  it('keeps each id and maps each old type to a kind', () => {
    expect(providers.map(p => [p.id, p.kind])).toEqual([
      ['openai', 'openai'],
      ['anthropic', 'anthropic'],
      ['ollama', 'ollama'],
      ['deepseek', 'openai-compatible'],
      ['grok', 'openai-compatible'],
      ['openrouter', 'openrouter'],
      ['custom_openai_1', 'openai-compatible'],
    ]);
  });

  it('drops Azure and the providers the old version had removed', () => {
    expect(byId('azure_openai')).toBeUndefined();
    expect(byId('groq')).toBeUndefined();
    expect(keys).not.toHaveProperty('azure_openai');
    expect(keys).not.toHaveProperty('groq');
  });

  it('fills a missing type, name and model list as the old version did', () => {
    expect(byId('deepseek')).toMatchObject({
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      models: [{ name: 'deepseek-flash' }, { name: 'deepseek-v4-pro' }],
    });
    expect(byId('custom_openai_1')).toMatchObject({ name: 'custom_openai_1', baseUrl: 'http://localhost:8787/__llm' });
  });

  it('writes addresses as Settings stores them', () => {
    expect(byId('ollama')).toMatchObject({ baseUrl: 'http://localhost:11434' });
    expect(byId('grok')).toMatchObject({ name: 'xAI Grok', baseUrl: 'https://api.x.ai/v1' });
    // OpenRouter's address is fixed here.
    expect(byId('openrouter')?.baseUrl).toBeUndefined();
  });

  it('moves real keys only, not empty ones or the Ollama placeholder', () => {
    expect(keys).toEqual({
      openai: 'sk-fake-openai',
      anthropic: 'sk-ant-fake',
      deepseek: 'sk-fake-deepseek',
      grok: 'xai-fake',
      openrouter: 'sk-or-fake',
    });
  });

  it('takes nothing from a missing or broken record', () => {
    expect(moveProviders(undefined)).toEqual({ providers: [], keys: {} });
    expect(moveProviders({ providers: { openai: null } })).toEqual({ providers: [], keys: {} });
  });
});

describe('the default model and its effort', () => {
  it("takes the navigator's model and adds it to its provider's list", () => {
    const { providers } = moveProviders(old['llm-api-keys']);
    const moved = moveDefaultModel(old['agent-models'], providers);
    expect(moved).toEqual({ model: { providerId: 'anthropic', model: 'claude-opus-5-5' }, reasoning: 'high' });
    expect(providers.find(p => p.id === 'anthropic')?.models.map(m => m.name)).toContain('claude-opus-5-5');
  });

  it('takes nothing when its provider was not moved', () => {
    const agents = { agents: { navigator: { provider: 'azure_openai', modelName: 'gpt-5' } } };
    expect(moveDefaultModel(agents, [])).toBeNull();
  });

  it('reads the old efforts as the old version did', () => {
    expect(['low', 'medium', 'high', 'xhigh', 'minimal', 'minimal/none', 'none', undefined].map(moveEffort)).toEqual([
      'low',
      'medium',
      'high',
      'high',
      'low',
      'low',
      null,
      null,
    ]);
  });
});

describe('saved prompts', () => {
  it('skips the example prompts the old version seeded, in every old version of their text', () => {
    expect(favoritesToMove(old.favorites).map(f => f.id)).toEqual([4, 5, 6]);
    const older = {
      prompts: [
        {
          id: 1,
          title: '📚 Explore AI Papers',
          content:
            '- Go to https://huggingface.co/papers and click through each of the first 3 papers.\n- For each paper:\n  - Record the title, URL and upvotes\n  - Summarise the abstract section\n- Finally, compile together a summary of all 3 papers, ranked by upvotes',
        },
      ],
    };
    expect(favoritesToMove(older)).toEqual([]);
  });

  it('makes names of lowercase letters, digits and hyphens', () => {
    const taken = new Set<string>();
    expect(shortcutName('📚 Explore AI Papers', taken)).toBe('explore-ai-papers');
    expect(shortcutName('每日总结', taken)).toBe('prompt-1');
    expect(shortcutName('🎉', new Set(['prompt-1']))).toBe('prompt-2');
    expect(shortcutName('New', taken)).toBe('new-2');
    expect(shortcutName('Daily news', new Set(['daily-news', 'daily-news-2']))).toBe('daily-news-3');
    const long = shortcutName('a'.repeat(80), new Set(['a'.repeat(64)]));
    expect(long).toBe(`${'a'.repeat(62)}-2`);
  });
});

describe('blocked sites', () => {
  it('turns whole sites on the deny list into Block rules and counts the rest', () => {
    const { rules, skipped, allowList } = moveBlockedSites(old['firewall-settings'], 'T');
    expect(Object.keys(rules).sort()).toEqual(['bank.example.com', 'localhost:3000', 'shop.example']);
    expect(rules['bank.example.com']).toEqual({ rule: 'block', setAt: 'T' });
    expect(skipped).toBe(2);
    expect(allowList).toBe(true);
  });

  it('keeps a site with a bare slash and drops one with a scheme', () => {
    const { rules } = moveBlockedSites({ enabled: true, denyList: ['example.com/', 'https://Example.net'] }, 'T');
    expect(Object.keys(rules).sort()).toEqual(['example.com', 'example.net']);
  });

  it('moves nothing when the old firewall was off', () => {
    expect(moveBlockedSites({ enabled: false, allowList: ['a.com'], denyList: ['b.com'] }, 'T')).toEqual({
      rules: {},
      skipped: 0,
      allowList: false,
    });
  });
});

describe('the move', () => {
  it('moves everything once, keeps the old conversations and removes the other old keys', async () => {
    const { data } = fakeLocal(old);
    await upgradeFromOldVersion();

    const providers = data['nb.providers'] as ProviderConfig[];
    expect(providers.map(p => p.id)).toContain('anthropic');
    expect(data['nb.keys']).toMatchObject({ anthropic: 'sk-ant-fake' });
    expect(data['nb.settings']).toMatchObject({
      defaultModel: { providerId: 'anthropic', model: 'claude-opus-5-5' },
      reasoning: 'high',
    });
    expect(Object.keys(data['nb.siteRules'] as object).sort()).toEqual([
      'bank.example.com',
      'localhost:3000',
      'shop.example',
    ]);
    expect(data['nb.upgrade']).toMatchObject({
      favorites: 3,
      blockedSites: 3,
      skippedSites: 2,
      allowList: true,
      // The old "Help improve Nanobrowser" switch was off in the fixture.
      analytics: false,
      dismissed: false,
    } satisfies Partial<UpgradeRecord>);
    // The release's What's new card opens with the move.
    expect(data['nb.whatsNew']).toEqual({ version: '0.3', dismissed: false });

    const names = (await listShortcuts()).map(s => s.name).sort();
    expect(names).toEqual(['daily-news-digest', 'explore-ai-papers', 'prompt-1', 'summarize']);

    const left = Object.keys(data)
      .filter(k => !k.startsWith('nb.'))
      .sort();
    expect(left).toEqual(['chat_agent_step_s1', 'chat_messages_s1', 'chat_messages_s2', 'chat_sessions_meta']);
  });

  it('changes nothing on a second run', async () => {
    const { data } = fakeLocal(old);
    await upgradeFromOldVersion();
    const after = structuredClone(data);
    const shortcuts = await listShortcuts();
    await upgradeFromOldVersion();
    expect(data).toEqual(after);
    expect(await listShortcuts()).toEqual(shortcuts);
  });

  it('never runs again once done, so what the user changes afterwards stays', async () => {
    const { data } = fakeLocal(old);
    await upgradeFromOldVersion();

    // The user changes everything the move wrote, deletes a moved shortcut and a provider, and closes the card.
    const providers = (data['nb.providers'] as ProviderConfig[]).filter(p => p.id !== 'openai');
    providers[0] = { ...providers[0], name: 'My Anthropic', models: [{ name: 'claude-haiku-4-5' }] };
    data['nb.providers'] = providers;
    data['nb.keys'] = { anthropic: 'sk-changed' };
    data['nb.settings'] = { defaultModel: { providerId: 'anthropic', model: 'claude-haiku-4-5' }, reasoning: 'none' };
    data['nb.siteRules'] = { 'bank.example.com': { rule: 'ask', setAt: 'later' } };
    data['nb.upgrade'] = { ...(data['nb.upgrade'] as UpgradeRecord), dismissed: true };
    const edited = (await listShortcuts()).find(s => s.id === 'old-favorite-4')!;
    await saveShortcut({ ...edited, text: 'Changed.' });
    await deleteShortcut('old-favorite-5');
    const changed = structuredClone(data);
    const shortcuts = await listShortcuts();

    // Later starts, with or without old data showing up again.
    await upgradeFromOldVersion();
    expect(data).toEqual(changed);
    data['llm-api-keys'] = old['llm-api-keys'];
    data.favorites = old.favorites;
    await upgradeFromOldVersion();
    // The record is there, so the old keys are only removed again: nothing else changes.
    expect(data).toEqual(changed);
    expect(data['llm-api-keys']).toBeUndefined();
    expect(await listShortcuts()).toEqual(shortcuts);
  });

  it('keeps the old "Help improve Nanobrowser" switch, which was on unless turned off', async () => {
    for (const [setting, expected] of [
      [{ enabled: true, anonymousUserId: 'x' }, true],
      [undefined, true],
      [{ enabled: false }, false],
    ] as const) {
      const storage: Record<string, unknown> = { ...old, 'analytics-settings': setting };
      if (setting === undefined) delete storage['analytics-settings'];
      const { data } = fakeLocal(storage);
      await upgradeFromOldVersion();
      expect((data['nb.upgrade'] as UpgradeRecord).analytics).toBe(expected);
      expect(data).not.toHaveProperty('analytics-settings');
      await closeDb();
      globalThis.indexedDB = new IDBFactory();
    }
  });

  it('keeps what the user set up in this version', async () => {
    const mine: ProviderConfig = { id: 'mine', kind: 'openai', name: 'Mine', models: [{ name: 'gpt-6-luna' }] };
    const { data } = fakeLocal({
      ...old,
      'nb.providers': [mine],
      'nb.keys': { mine: 'sk-mine', anthropic: 'sk-newer' },
      'nb.settings': { defaultModel: { providerId: 'mine', model: 'gpt-6-luna' } },
      'nb.siteRules': { 'bank.example.com': { rule: 'ask', setAt: 'before' } },
    });
    await upgradeFromOldVersion();
    expect((data['nb.providers'] as ProviderConfig[])[0]).toEqual(mine);
    expect(data['nb.keys']).toMatchObject({ mine: 'sk-mine', anthropic: 'sk-newer', openai: 'sk-fake-openai' });
    expect(data['nb.settings']).toEqual({ defaultModel: { providerId: 'mine', model: 'gpt-6-luna' } });
    expect((data['nb.siteRules'] as Record<string, unknown>)['bank.example.com']).toEqual({
      rule: 'ask',
      setAt: 'before',
    });
  });

  it('finishes a run that stopped after the shortcuts, keeping what the user changed since', async () => {
    const { data, area } = fakeLocal(old);
    area.set.mockRejectedValueOnce(new Error('worker stopped'));
    await expect(upgradeFromOldVersion()).rejects.toThrow('worker stopped');
    expect(data['nb.upgrade']).toBeUndefined();
    expect(data['llm-api-keys']).toBeDefined();

    // The user edits and pins a moved shortcut before the next start.
    const moved = (await listShortcuts()).find(s => s.id === 'old-favorite-4')!;
    await saveShortcut({ ...moved, text: 'My own words.' });
    await setPinned(moved.id, true);

    await upgradeFromOldVersion();
    const after = (await listShortcuts()).find(s => s.id === 'old-favorite-4')!;
    expect(after).toMatchObject({ text: 'My own words.', pinned: true });
    expect((await listShortcuts()).length).toBe(4);
    expect(data['nb.upgrade']).toBeDefined();
    expect(data['llm-api-keys']).toBeUndefined();
  });

  it('only removes the old keys when the record is already there', async () => {
    const record: UpgradeRecord = {
      at: 'T',
      favorites: 0,
      blockedSites: 0,
      skippedSites: 0,
      allowList: false,
      dismissed: true,
    };
    const { data } = fakeLocal({ 'nb.upgrade': record, favorites: old.favorites, 'user-profile': {} });
    await upgradeFromOldVersion();
    expect(data).toEqual({ 'nb.upgrade': record });
    expect(await listShortcuts()).toEqual([]);
  });

  it('does nothing on a fresh install', async () => {
    const { data, area } = fakeLocal({ 'nb.settings': { onboarded: true } });
    await upgradeFromOldVersion();
    expect(data).toEqual({ 'nb.settings': { onboarded: true } });
    expect(area.set).not.toHaveBeenCalled();
  });
});
