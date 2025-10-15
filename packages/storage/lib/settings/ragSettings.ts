import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

export interface RagSettingsConfig {
  enabled: boolean;
  endpoint: string;
  apiKey?: string;
  apiKeyHeaderName?: string; // e.g. Authorization
  queryParamName?: string; // if endpoint expects query param with the user input
  method?: 'GET' | 'POST';
  additionalHeaders?: Record<string, string>;
}

export type RagSettingsStorage = BaseStorage<RagSettingsConfig> & {
  updateSettings: (settings: Partial<RagSettingsConfig>) => Promise<void>;
  getSettings: () => Promise<RagSettingsConfig>;
  resetToDefaults: () => Promise<void>;
};

export const DEFAULT_RAG_SETTINGS: RagSettingsConfig = {
  enabled: false,
  endpoint: '',
  apiKey: undefined,
  apiKeyHeaderName: 'Authorization',
  queryParamName: 'q',
  method: 'POST',
  additionalHeaders: {},
};

const storage = createStorage<RagSettingsConfig>('rag-settings', DEFAULT_RAG_SETTINGS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const ragSettingsStore: RagSettingsStorage = {
  ...storage,
  async updateSettings(settings: Partial<RagSettingsConfig>) {
    const current = (await storage.get()) || DEFAULT_RAG_SETTINGS;
    const updated = { ...current, ...settings };
    await storage.set(updated);
  },
  async getSettings() {
    const s = await storage.get();
    return { ...DEFAULT_RAG_SETTINGS, ...s };
  },
  async resetToDefaults() {
    await storage.set(DEFAULT_RAG_SETTINGS);
  },
};
