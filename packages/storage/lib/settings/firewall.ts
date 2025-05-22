import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

// Interface for firewall settings configuration
export interface FirewallConfig {
  allowList: string[]; // URLs that are explicitly allowed
  denyList: string[]; // URLs that are explicitly denied
  enabled: boolean; // Whether the firewall is enabled
}

/**
 * Normalizes a URL by trimming whitespace and converting to lowercase
 * @param url The URL to normalize
 * @returns The normalized URL
 */
function normalizeUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '');
}

export type FirewallStorage = BaseStorage<FirewallConfig> & {
  updateFirewall: (settings: Partial<FirewallConfig>) => Promise<void>;
  getFirewall: () => Promise<FirewallConfig>;
  resetToDefaults: () => Promise<void>;
  addToAllowList: (url: string) => Promise<void>;
  removeFromAllowList: (url: string) => Promise<void>;
  addToDenyList: (url: string) => Promise<void>;
  removeFromDenyList: (url: string) => Promise<void>;
};

// Default settings
export const DEFAULT_FIREWALL_SETTINGS: FirewallConfig = {
  allowList: [],
  denyList: [],
  enabled: true,
};

const storage = createStorage<FirewallConfig>('firewall-settings', DEFAULT_FIREWALL_SETTINGS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const firewallStore: FirewallStorage = {
  ...storage,
  async updateFirewall(settings: Partial<FirewallConfig>) {
    const currentSettings = (await storage.get()) || DEFAULT_FIREWALL_SETTINGS;
    await storage.set({
      ...currentSettings,
      ...settings,
    });
  },
  async getFirewall() {
    const settings = await storage.get();
    return settings || DEFAULT_FIREWALL_SETTINGS;
  },
  async resetToDefaults() {
    await storage.set(DEFAULT_FIREWALL_SETTINGS);
  },
  async addToAllowList(url: string) {
    const normalizedUrl = normalizeUrl(url);
    const currentSettings = await this.getFirewall();

    if (!currentSettings.allowList.includes(normalizedUrl)) {
      // Remove from deny list if it exists there
      const denyList = currentSettings.denyList.filter(item => item !== normalizedUrl);
      // Add to allow list
      await this.updateFirewall({
        allowList: [...currentSettings.allowList, normalizedUrl],
        denyList,
      });
    }
  },
  async removeFromAllowList(url: string) {
    const normalizedUrl = normalizeUrl(url);
    const currentSettings = await this.getFirewall();
    await this.updateFirewall({
      allowList: currentSettings.allowList.filter(item => item !== normalizedUrl),
    });
  },
  async addToDenyList(url: string) {
    const normalizedUrl = normalizeUrl(url);
    const currentSettings = await this.getFirewall();

    if (!currentSettings.denyList.includes(normalizedUrl)) {
      // Remove from allow list if it exists there
      const allowList = currentSettings.allowList.filter(item => item !== normalizedUrl);
      // Add to deny list
      await this.updateFirewall({
        denyList: [...currentSettings.denyList, normalizedUrl],
        allowList,
      });
    }
  },
  async removeFromDenyList(url: string) {
    const normalizedUrl = normalizeUrl(url);
    const currentSettings = await this.getFirewall();
    await this.updateFirewall({
      denyList: currentSettings.denyList.filter(item => item !== normalizedUrl),
    });
  },
};
