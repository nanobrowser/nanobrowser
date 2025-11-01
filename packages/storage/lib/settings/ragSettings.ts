import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

export interface RAGSettingsConfig {
  enabled: boolean;
  // Optional custom system message that will be sent with planner prompts and used during RAG retrieval
  customSystemMessage?: string;
  // which provider id to use for retrieval/embedding (optional)
  providerId?: string;
  // index name or path for local/vector DB
  index?: string;
  // number of documents to retrieve
  topK?: number;
  // any provider-level overrides such as custom headers or query templates
  customQuery?: string;
  // optional external RAG endpoint settings (from control_behaviour UI)
  endpoint?: string;
  apiKey?: string;
  apiKeyHeaderName?: string;
  queryParamName?: string;
  method?: 'GET' | 'POST';
}

export type RAGSettingsStorage = BaseStorage<RAGSettingsConfig> & {
  updateSettings: (partial: Partial<RAGSettingsConfig>) => Promise<void>;
  getSettings: () => Promise<RAGSettingsConfig>;
};

export const DEFAULT_RAG_SETTINGS: RAGSettingsConfig = {
  enabled: false,
  providerId: undefined,
  index: undefined,
  topK: 5,
  customQuery: undefined,
  customSystemMessage: undefined,
  endpoint: undefined,
  apiKey: undefined,
  apiKeyHeaderName: undefined,
  queryParamName: undefined,
  method: 'POST',
};

const storage = createStorage<RAGSettingsConfig>('rag-settings', DEFAULT_RAG_SETTINGS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const ragSettingsStore: RAGSettingsStorage = {
  ...storage,
  async updateSettings(partial: Partial<RAGSettingsConfig>) {
    const current = (await storage.get()) || DEFAULT_RAG_SETTINGS;
    await storage.set({ ...current, ...partial });
  },
  async getSettings() {
    const settings = await storage.get();
    return { ...DEFAULT_RAG_SETTINGS, ...settings };
  },
};
