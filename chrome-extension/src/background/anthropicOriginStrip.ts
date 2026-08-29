import { llmProviderStore, ProviderTypeEnum } from '@extension/storage';

const BASE_RULE_ID = 10001;
const MAX_RULES = 20;

export async function updateAnthropicOriginRules(): Promise<void> {
  try {
    const providers = await llmProviderStore.getAllProviders();
    const newRules: chrome.declarativeNetRequest.Rule[] = [];
    let ruleId = BASE_RULE_ID;

    for (const provider of Object.values(providers)) {
      if (provider.type !== ProviderTypeEnum.Anthropic || !provider.baseUrl?.trim()) continue;
      if (ruleId >= BASE_RULE_ID + MAX_RULES) break;

      let hostname: string;
      try {
        hostname = new URL(provider.baseUrl).hostname;
      } catch {
        continue;
      }

      newRules.push({
        id: ruleId++,
        priority: 1,
        action: {
          type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
          requestHeaders: [{ header: 'Origin', operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation }],
        },
        condition: {
          urlFilter: `||${hostname}/*`,
          resourceTypes: ['xmlhttprequest', 'other'] as chrome.declarativeNetRequest.ResourceType[],
        },
      });
    }

    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const oldIds = existing.filter(r => r.id >= BASE_RULE_ID && r.id < BASE_RULE_ID + MAX_RULES).map(r => r.id);
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: oldIds, addRules: newRules });
  } catch (e) {
    console.error('[anthropicOriginStrip] Failed to update rules:', e);
  }
}
