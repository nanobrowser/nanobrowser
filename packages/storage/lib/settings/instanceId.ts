import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

// Interface for instance ID configuration
export interface InstanceIdConfig {
  instanceId: string;
  createdAt: number;
}

export type InstanceIdStorage = BaseStorage<InstanceIdConfig> & {
  getInstanceId: () => Promise<string>;
  generateNewInstanceId: () => Promise<string>;
  getChannelName: () => Promise<string>;
  getCreatedAt: () => Promise<number>;
};

// Generate a unique instance ID in the format: ext_${chrome.runtime.id}_${timestamp}_${randomHash}
function generateInstanceId(): string {
  const runtimeId = typeof chrome !== 'undefined' ? chrome.runtime.id : 'unknown';
  const timestamp = Date.now();
  const randomHash = Math.random().toString(36).substring(2, 15);
  return `ext_${runtimeId}_${timestamp}_${randomHash}`;
}

// Default instance ID config - will be generated on first access
const getDefaultInstanceIdConfig = (): InstanceIdConfig => ({
  instanceId: generateInstanceId(),
  createdAt: Date.now(),
});

const storage = createStorage<InstanceIdConfig>('instance-id', getDefaultInstanceIdConfig(), {
  storageEnum: StorageEnum.Local,
  liveUpdate: false, // Instance ID shouldn't change during runtime
});

export const instanceIdStore: InstanceIdStorage = {
  ...storage,

  async getInstanceId(): Promise<string> {
    const config = await this.get();
    if (!config || !config.instanceId) {
      // Generate new instance ID if none exists
      const newConfig = getDefaultInstanceIdConfig();
      await this.set(newConfig);
      return newConfig.instanceId;
    }
    return config.instanceId;
  },

  async generateNewInstanceId(): Promise<string> {
    const newConfig = getDefaultInstanceIdConfig();
    await this.set(newConfig);
    return newConfig.instanceId;
  },

  async getChannelName(): Promise<string> {
    const instanceId = await this.getInstanceId();
    return `/default/${instanceId}`;
  },

  async getCreatedAt(): Promise<number> {
    const config = await this.get();
    if (!config || !config.createdAt) {
      const newConfig = getDefaultInstanceIdConfig();
      await this.set(newConfig);
      return newConfig.createdAt;
    }
    return config.createdAt;
  },
};
