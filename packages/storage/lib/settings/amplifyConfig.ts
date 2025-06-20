import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

// Interface for Amplify Events configuration
export interface AmplifyEventsConfig {
  enabled: boolean;
  endpoint: string; // AppSync Event API endpoint
  region: string;
  defaultAuthMode: 'apiKey'; // Must be 'apiKey' not 'API_KEY'
  apiKey: string;
  channelNamespace: string; // Default: 'default'
}

// Configuration structure matching amplify_outputs.json
export interface AmplifyOutputs {
  API: {
    Events: {
      endpoint: string;
      region: string;
      defaultAuthMode: 'apiKey';
      apiKey: string;
    };
  };
}

export type AmplifyConfigStorage = BaseStorage<AmplifyEventsConfig> & {
  updateConfig: (config: Partial<AmplifyEventsConfig>) => Promise<void>;
  getConfig: () => Promise<AmplifyEventsConfig>;
  isEnabled: () => Promise<boolean>;
  resetToDefaults: () => Promise<void>;
  validateConfig: () => Promise<boolean>;
  setFromAmplifyOutputs: (outputs: AmplifyOutputs) => Promise<void>;
};

// Default Amplify Events configuration
export const DEFAULT_AMPLIFY_CONFIG: AmplifyEventsConfig = {
  enabled: false,
  endpoint: '',
  region: 'us-east-1',
  defaultAuthMode: 'apiKey',
  apiKey: '',
  channelNamespace: 'default',
};

const storage = createStorage<AmplifyEventsConfig>('amplify-events-config', DEFAULT_AMPLIFY_CONFIG, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const amplifyConfigStore: AmplifyConfigStorage = {
  ...storage,

  async updateConfig(config: Partial<AmplifyEventsConfig>) {
    const currentConfig = (await storage.get()) || DEFAULT_AMPLIFY_CONFIG;
    const updatedConfig = {
      ...currentConfig,
      ...config,
    };
    await storage.set(updatedConfig);
  },

  async getConfig(): Promise<AmplifyEventsConfig> {
    const config = await storage.get();
    return config || DEFAULT_AMPLIFY_CONFIG;
  },

  async isEnabled(): Promise<boolean> {
    const config = await this.getConfig();
    return config.enabled;
  },

  async resetToDefaults(): Promise<void> {
    await storage.set(DEFAULT_AMPLIFY_CONFIG);
  },

  async validateConfig(): Promise<boolean> {
    const config = await this.getConfig();

    if (!config.enabled) {
      return true; // If disabled, no validation needed
    }

    // Validate required fields
    return !!(
      config.endpoint &&
      config.region &&
      config.apiKey &&
      config.defaultAuthMode === 'apiKey' &&
      config.channelNamespace
    );
  },

  async setFromAmplifyOutputs(outputs: AmplifyOutputs): Promise<void> {
    const config: AmplifyEventsConfig = {
      enabled: true,
      endpoint: outputs.API.Events.endpoint,
      region: outputs.API.Events.region,
      defaultAuthMode: outputs.API.Events.defaultAuthMode,
      apiKey: outputs.API.Events.apiKey,
      channelNamespace: 'default',
    };
    await storage.set(config);
  },
};
