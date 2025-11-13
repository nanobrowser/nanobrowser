import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

// Interface for general settings configuration
export interface GeneralSettingsConfig {
  maxSteps: number;
  maxActionsPerStep: number;
  maxFailures: number;
  useVision: boolean;
  useVisionForPlanner: boolean;
  planningInterval: number;
  displayHighlights: boolean;
  replayHistoricalTasks: boolean;
}

export type GeneralSettingsStorage = BaseStorage<GeneralSettingsConfig> & {
  updateSettings: (settings: Partial<GeneralSettingsConfig>) => Promise<void>;
  getSettings: () => Promise<GeneralSettingsConfig>;
  resetToDefaults: () => Promise<void>;
};

// Default settings
export const DEFAULT_GENERAL_SETTINGS: GeneralSettingsConfig = {
  maxSteps: 1000,
  maxActionsPerStep: 100,
  maxFailures: 20,
  useVision: true,
  useVisionForPlanner: true,
  planningInterval: 3,
  displayHighlights: true,
  replayHistoricalTasks: true,
};

const storage = createStorage<GeneralSettingsConfig>('general-settings', DEFAULT_GENERAL_SETTINGS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const generalSettingsStore: GeneralSettingsStorage = {
  ...storage,
  async updateSettings(settings: Partial<GeneralSettingsConfig>) {
    const currentSettings = (await storage.get()) || DEFAULT_GENERAL_SETTINGS;
    const updatedSettings = {
      ...currentSettings,
      ...settings,
    };

    updatedSettings.maxSteps = DEFAULT_GENERAL_SETTINGS.maxSteps;
    updatedSettings.maxActionsPerStep = DEFAULT_GENERAL_SETTINGS.maxActionsPerStep;
    updatedSettings.maxFailures = DEFAULT_GENERAL_SETTINGS.maxFailures;
    updatedSettings.useVision = true;
    updatedSettings.useVisionForPlanner = true;
    updatedSettings.replayHistoricalTasks = true;
    await storage.set(updatedSettings);
  },
  async getSettings() {
    const settings = await storage.get();
    return {
      ...DEFAULT_GENERAL_SETTINGS,
      ...settings,
      maxSteps: DEFAULT_GENERAL_SETTINGS.maxSteps,
      maxActionsPerStep: DEFAULT_GENERAL_SETTINGS.maxActionsPerStep,
      maxFailures: DEFAULT_GENERAL_SETTINGS.maxFailures,
      useVision: true,
      useVisionForPlanner: true,
      replayHistoricalTasks: true,
    };
  },
  async resetToDefaults() {
    await storage.set(DEFAULT_GENERAL_SETTINGS);
  },
};
