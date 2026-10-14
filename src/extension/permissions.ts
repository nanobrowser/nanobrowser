// Permissions in the extension: the mode belongs to the conversation, the site rules are one map in chrome.storage, and
// the layer asks `decideWrite` for each classified write.
// Blocked sites go into every agent session's navigation policy.
import type { WriteDecision, WriteQuestion } from '@src/browser-control';
import { decideWrite, siteRulesStorage } from '@src/store/settings';
import type { SiteRuleEntry } from '@src/store/settings';
import type { PermissionMode } from '@src/store/types';

export class Permissions {
  #rules: Record<string, SiteRuleEntry> = {};
  #listeners = new Set<() => void>();

  constructor() {
    void siteRulesStorage.get().then(rules => this.#set(rules));
    siteRulesStorage.subscribe(() => this.#set(siteRulesStorage.getSnapshot() ?? {}));
  }

  #set(rules: Record<string, SiteRuleEntry>): void {
    const blockedBefore = this.blockedSites().join('\n');
    this.#rules = rules;
    if (this.blockedSites().join('\n') !== blockedBefore) this.#listeners.forEach(l => l());
  }

  /** Called when the blocked list changes, so open sessions get the new policy. */
  onBlockedChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async ready(): Promise<void> {
    this.#set(await siteRulesStorage.get());
  }

  blockedSites(): string[] {
    return Object.entries(this.#rules)
      .filter(([, e]) => e.rule === 'block')
      .map(([site]) => site);
  }

  /** The answer to the layer for a classified write. */
  decide(mode: PermissionMode, question: WriteQuestion): WriteDecision {
    // A page with no host cannot hold a rule: a write there asks every time, in both modes.
    if (!question.site) return { decision: 'ask', canRemember: false };
    const entry = this.#rules[question.site];
    const rule = entry?.rule === 'allow' || entry?.rule === 'ask' ? entry.rule : undefined;
    const decision = decideWrite(mode, rule);
    return { decision, by: rule ? 'site-rule' : 'auto', canRemember: rule !== 'ask' };
  }

  /** "Allow on this site". */
  async allow(site: string): Promise<void> {
    const now = new Date().toISOString();
    await siteRulesStorage.set(rules => ({ ...rules, [site]: { rule: 'allow', setAt: now } }));
  }
}
