import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

// Interface for instance ID configuration
export interface InstanceIdConfig {
  instanceId: string;
  createdAt: number;
}

export type InstanceIdStorage = BaseStorage<InstanceIdConfig> & {
  getOrCreateInstanceId: () => Promise<string>;
  getInstanceId: () => Promise<string | null>;
  generateNewInstanceId: () => Promise<string>;
  getChannelName: () => Promise<string>;
  getCreatedAt: () => Promise<number | null>;
  awaitInstanceId: (timeout?: number, interval?: number) => Promise<string>;
};

// Generate a unique instance ID in AppSync-compatible format (max 50 chars): ext-{short_runtime_id}-{short_timestamp}-{hash}
function generateInstanceId(): string {
  const runtimeId = typeof chrome !== 'undefined' ? chrome.runtime.id : 'unknown';
  // Take first 8 chars of runtime ID for brevity
  const shortRuntimeId = runtimeId.substring(0, 8);
  // Use last 6 digits of timestamp for uniqueness
  const shortTimestamp = Date.now().toString().slice(-6);
  // Generate 8-char random hash
  const randomHash = Math.random().toString(36).substring(2, 10);
  return `ext-${shortRuntimeId}-${shortTimestamp}-${randomHash}`;
}

// Default instance ID config - will be generated on first access
const getDefaultInstanceIdConfig = (): InstanceIdConfig => ({
  instanceId: generateInstanceId(),
  createdAt: Date.now(),
});

const storage = createStorage<InstanceIdConfig>('instance-id', {} as InstanceIdConfig, {
  storageEnum: StorageEnum.Local,
  liveUpdate: false, // Instance ID shouldn't change during runtime
});

export const instanceIdStore: InstanceIdStorage = {
  ...storage,

  async getOrCreateInstanceId(): Promise<string> {
    const config = await this.get();
    if (!config || !config.instanceId) {
      // Generate new instance ID if none exists
      const newConfig = getDefaultInstanceIdConfig();
      await this.set(newConfig);
      return newConfig.instanceId;
    }
    return config.instanceId;
  },

  async getInstanceId(): Promise<string | null> {
    const config = await this.get();
    return config?.instanceId ?? null;
  },

  async generateNewInstanceId(): Promise<string> {
    const newConfig = getDefaultInstanceIdConfig();
    await this.set(newConfig);
    return newConfig.instanceId;
  },

  async getChannelName(): Promise<string> {
    const instanceId = await this.getInstanceId();
    if (!instanceId) {
      throw new Error('Cannot get channel name, instance ID not yet created.');
    }
    return `/default/${instanceId}`;
  },

  async awaitInstanceId(timeout = 5000, interval = 100): Promise<string> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const id = await this.getInstanceId(); // Use the new read-only method
      if (id) {
        return id;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    throw new Error('Timed out waiting for instance ID to become available.');
  },

  async getCreatedAt(): Promise<number | null> {
    const config = await this.get();
    return config?.createdAt ?? null;
  },
};
