import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

// Interface for WebSocket configuration
export interface WebSocketConfig {
  enabled: boolean;
  serverUrl: string;
  connectionTimeout: number;
}

export type WebSocketStorage = BaseStorage<WebSocketConfig> & {
  updateSettings: (settings: Partial<WebSocketConfig>) => Promise<void>;
  getSettings: () => Promise<WebSocketConfig>;
  resetToDefaults: () => Promise<void>;
};

// Default WebSocket settings
export const DEFAULT_WEBSOCKET_SETTINGS: WebSocketConfig = {
  enabled: false,
  serverUrl: 'ws://localhost:8080',
  connectionTimeout: 5000,
};

/**
 * Validates WebSocket configuration settings
 */
function validateWebSocketSettings(settings: Partial<WebSocketConfig>): void {
  // Validate server URL format
  if (settings.serverUrl !== undefined) {
    const url = settings.serverUrl.trim();
    if (url.indexOf('ws://') !== 0 && url.indexOf('wss://') !== 0) {
      throw new Error('Server URL must start with ws:// or wss://');
    }

    // Extract and validate port if present using regex
    const urlPattern = /^wss?:\/\/([^:/\s]+):?(\d+)?(\/.*)?$/;
    const match = url.match(urlPattern);
    if (!match) {
      throw new Error('Invalid server URL format');
    }

    // Validate port number if present
    if (match[2]) {
      const portNumber = parseInt(match[2], 10);
      if (isNaN(portNumber) || portNumber < 1 || portNumber > 65535) {
        throw new Error('Port number must be between 1 and 65535');
      }
    }
  }

  // Validate connection timeout
  if (settings.connectionTimeout !== undefined) {
    if (settings.connectionTimeout < 1000 || settings.connectionTimeout > 30000) {
      throw new Error('Connection timeout must be between 1000 and 30000 milliseconds');
    }
  }
}

const storage = createStorage<WebSocketConfig>('websocket-settings', DEFAULT_WEBSOCKET_SETTINGS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const websocketStore: WebSocketStorage = {
  ...storage,
  async updateSettings(settings: Partial<WebSocketConfig>) {
    // Validate settings before applying
    validateWebSocketSettings(settings);

    const currentSettings = (await storage.get()) || DEFAULT_WEBSOCKET_SETTINGS;
    const updatedSettings = {
      ...currentSettings,
      ...settings,
    };

    await storage.set(updatedSettings);
  },
  async getSettings() {
    const settings = await storage.get();
    return {
      ...DEFAULT_WEBSOCKET_SETTINGS,
      ...settings,
    };
  },
  async resetToDefaults() {
    await storage.set(DEFAULT_WEBSOCKET_SETTINGS);
  },
};
