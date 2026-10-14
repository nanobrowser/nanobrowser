import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';
import { AgentNameEnum, ProviderTypeEnum } from './types';
import { migrateRetiredDeepSeekModelName } from './llmProviders';

// Reasoning effort for a model. 'none' sends no effort, so the model's own default applies
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * A saved reasoning effort as the current options. Minimal was removed, so a saved 'minimal'
 * (or the older 'minimal/none') becomes low.
 */
export function normalizeReasoningEffort(saved: string | undefined): ReasoningEffort | undefined {
  return saved === 'minimal' || saved === 'minimal/none' ? 'low' : (saved as ReasoningEffort | undefined);
}

// Interface for a single model configuration
export interface ModelConfig {
  // providerId, the key of the provider in the llmProviderStore, not the provider name
  provider: string;
  modelName: string;
  // Unset uses the provider's default (getDefaultReasoningEffort). Temperature and top P are never sent
  reasoningEffort?: ReasoningEffort;
}

// Interface for storing multiple agent model configurations
export interface AgentModelRecord {
  agents: Record<AgentNameEnum, ModelConfig>;
}

export type AgentModelStorage = BaseStorage<AgentModelRecord> & {
  setAgentModel: (agent: AgentNameEnum, config: ModelConfig) => Promise<void>;
  getAgentModel: (agent: AgentNameEnum) => Promise<ModelConfig | undefined>;
  resetAgentModel: (agent: AgentNameEnum) => Promise<void>;
  hasAgentModel: (agent: AgentNameEnum) => Promise<boolean>;
  getConfiguredAgents: () => Promise<AgentNameEnum[]>;
  getAllAgentModels: () => Promise<Record<AgentNameEnum, ModelConfig>>;
  cleanupLegacyValidatorSettings: () => Promise<void>;
};

const storage = createStorage<AgentModelRecord>(
  'agent-models',
  { agents: {} as Record<AgentNameEnum, ModelConfig> },
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

function migrateDeepSeekAgentModel(config: ModelConfig): ModelConfig {
  if (config.provider !== ProviderTypeEnum.DeepSeek) {
    return config;
  }
  const modelName = migrateRetiredDeepSeekModelName(config.modelName);
  if (modelName === config.modelName) {
    return config;
  }
  return { ...config, modelName };
}

function validateModelConfig(config: ModelConfig) {
  if (!config.provider || !config.modelName) {
    throw new Error('Provider and model name must be specified');
  }
}

export const agentModelStore: AgentModelStorage = {
  ...storage,
  setAgentModel: async (agent: AgentNameEnum, config: ModelConfig) => {
    validateModelConfig(config);
    await storage.set(current => ({
      agents: {
        ...current.agents,
        [agent]: config,
      },
    }));
  },
  getAgentModel: async (agent: AgentNameEnum) => {
    const data = await storage.get();
    const config = data.agents[agent];
    return config ? migrateDeepSeekAgentModel(config) : undefined;
  },
  resetAgentModel: async (agent: AgentNameEnum) => {
    await storage.set(current => {
      const newAgents = { ...current.agents };
      delete newAgents[agent];
      return { agents: newAgents };
    });
  },
  hasAgentModel: async (agent: AgentNameEnum) => {
    const data = await storage.get();
    return agent in data.agents;
  },
  getConfiguredAgents: async () => {
    const data = await storage.get();
    // Filter out any legacy validator entries for backward compatibility
    return Object.keys(data.agents).filter(
      agentKey => agentKey !== 'validator' && Object.values(AgentNameEnum).includes(agentKey as AgentNameEnum),
    ) as AgentNameEnum[];
  },
  getAllAgentModels: async () => {
    const data = await storage.get();
    // Filter out any legacy validator entries for backward compatibility
    const filteredAgents: Partial<Record<AgentNameEnum, ModelConfig>> = {};
    for (const [agentKey, config] of Object.entries(data.agents)) {
      if (agentKey !== 'validator' && Object.values(AgentNameEnum).includes(agentKey as AgentNameEnum)) {
        filteredAgents[agentKey as AgentNameEnum] = migrateDeepSeekAgentModel(config);
      }
    }
    return filteredAgents as Record<AgentNameEnum, ModelConfig>;
  },
  cleanupLegacyValidatorSettings: async () => {
    await storage.set(current => {
      const newAgents = { ...current.agents };
      delete newAgents['validator' as keyof typeof newAgents];
      return { agents: newAgents };
    });
  },
};
