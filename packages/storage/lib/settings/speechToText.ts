import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

export interface SpeechToTextModelConfig {
  provider: string;
  modelName: string;
}

export interface SpeechToTextRecord {
  speechToTextModel?: SpeechToTextModelConfig;
}

export type SpeechToTextStorage = BaseStorage<SpeechToTextRecord> & {
  setSpeechToTextModel: (config: SpeechToTextModelConfig) => Promise<void>;
  getSpeechToTextModel: () => Promise<SpeechToTextModelConfig | undefined>;
  resetSpeechToTextModel: () => Promise<void>;
  hasSpeechToTextModel: () => Promise<boolean>;
};

const storage = createStorage<SpeechToTextRecord>(
  'speech-to-text-model',
  { speechToTextModel: undefined },
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

function validateSpeechToTextModelConfig(config: SpeechToTextModelConfig) {
  if (!config.provider || !config.modelName) {
    throw new Error('Provider and model name must be specified for speech-to-text');
  }
}

export const speechToTextModelStore: SpeechToTextStorage = {
  ...storage,
  setSpeechToTextModel: async (config: SpeechToTextModelConfig) => {
    validateSpeechToTextModelConfig(config);
    await storage.set({ speechToTextModel: config });
  },
  getSpeechToTextModel: async () => {
    const data = await storage.get();
    return data.speechToTextModel;
  },
  resetSpeechToTextModel: async () => {
    await storage.set({ speechToTextModel: undefined });
  },
  hasSpeechToTextModel: async () => {
    const data = await storage.get();
    return data.speechToTextModel !== undefined;
  },
};
