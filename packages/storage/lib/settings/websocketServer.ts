import { createStorage, StorageEnum } from '../base';

export interface WebSocketServerSettings {
  enabled: boolean;
  serverUrl: string;
  autoConnect: boolean;
  reconnectInterval: number; // in milliseconds
  heartbeatInterval: number; // in milliseconds
  connectionTimeout: number; // in milliseconds
  maxReconnectAttempts: number;
  authToken?: string;
}

export const DEFAULT_WEBSOCKET_SERVER_SETTINGS: WebSocketServerSettings = {
  enabled: false,
  serverUrl: 'ws://localhost:8080',
  autoConnect: false,
  reconnectInterval: 5000,
  heartbeatInterval: 30000,
  connectionTimeout: 10000,
  maxReconnectAttempts: 5,
  authToken: undefined,
};

const websocketServerStorage = createStorage<WebSocketServerSettings>(
  'websocket-server-settings',
  DEFAULT_WEBSOCKET_SERVER_SETTINGS,
  {
    storageEnum: StorageEnum.Local,
  },
);

export const websocketServerStore = {
  getSettings: async (): Promise<WebSocketServerSettings> => {
    return await websocketServerStorage.get();
  },

  setSettings: async (settings: Partial<WebSocketServerSettings>): Promise<void> => {
    const currentSettings = await websocketServerStorage.get();
    const newSettings = { ...currentSettings, ...settings };
    await websocketServerStorage.set(newSettings);
  },

  resetToDefaults: async (): Promise<void> => {
    await websocketServerStorage.set(DEFAULT_WEBSOCKET_SERVER_SETTINGS);
  },

  subscribe: websocketServerStorage.subscribe,

  // Helper methods for specific settings
  setEnabled: async (enabled: boolean): Promise<void> => {
    await websocketServerStore.setSettings({ enabled });
  },

  setServerUrl: async (serverUrl: string): Promise<void> => {
    await websocketServerStore.setSettings({ serverUrl });
  },

  setAutoConnect: async (autoConnect: boolean): Promise<void> => {
    await websocketServerStore.setSettings({ autoConnect });
  },

  setAuthToken: async (authToken: string | undefined): Promise<void> => {
    await websocketServerStore.setSettings({ authToken });
  },
};