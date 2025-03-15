import { useEffect, useState } from 'react';
import { Button } from '@extension/ui';
import {
  llmProviderStore,
  agentModelStore,
  AgentNameEnum,
  LLMProviderEnum,
  llmProviderModelNames,
} from '@extension/storage';

interface ModelSettingsProps {
  isDarkMode?: boolean;
}

export const ModelSettings = ({ isDarkMode = false }: ModelSettingsProps) => {
  const [apiKeys, setApiKeys] = useState<Record<LLMProviderEnum, { apiKey: string; baseUrl?: string }>>(
    {} as Record<LLMProviderEnum, { apiKey: string; baseUrl?: string }>,
  );
  const [modifiedProviders, setModifiedProviders] = useState<Set<LLMProviderEnum>>(new Set());
  const [selectedModels, setSelectedModels] = useState<Record<AgentNameEnum, string>>({
    [AgentNameEnum.Navigator]: '',
    [AgentNameEnum.Planner]: '',
    [AgentNameEnum.Validator]: '',
  });

  useEffect(() => {
    const loadApiKeys = async () => {
      try {
        const providers = await llmProviderStore.getConfiguredProviders();

        const keys: Record<LLMProviderEnum, { apiKey: string; baseUrl?: string }> = {} as Record<
          LLMProviderEnum,
          { apiKey: string; baseUrl?: string }
        >;

        for (const provider of providers) {
          const config = await llmProviderStore.getProvider(provider);
          if (config) {
            keys[provider] = {
              apiKey: config.apiKey || '',
              baseUrl: config.baseUrl,
            };
          }
        }

        setApiKeys(keys);
      } catch (error) {
        console.error('Failed to load API keys:', error);
      }
    };

    const loadAgentModels = async () => {
      try {
        const models: Record<AgentNameEnum, string> = {
          [AgentNameEnum.Navigator]: '',
          [AgentNameEnum.Planner]: '',
          [AgentNameEnum.Validator]: '',
        };

        for (const agent of Object.values(AgentNameEnum)) {
          const model = await agentModelStore.getAgentModel(agent);
          if (model) {
            models[agent] = model.modelName;
          }
        }

        setSelectedModels(models);
      } catch (error) {
        console.error('Failed to load agent models:', error);
      }
    };

    loadApiKeys();
    loadAgentModels();
  }, []);

  const handleApiKeyChange = (provider: LLMProviderEnum, apiKey: string, baseUrl?: string) => {
    setApiKeys(prev => ({
      ...prev,
      [provider]: { apiKey, baseUrl },
    }));

    setModifiedProviders(prev => {
      const newSet = new Set(prev);
      newSet.add(provider);
      return newSet;
    });
  };

  const handleSave = async (provider: LLMProviderEnum) => {
    try {
      await llmProviderStore.setProvider(provider, apiKeys[provider]);
      setModifiedProviders(prev => {
        const newSet = new Set(prev);
        newSet.delete(provider);
        return newSet;
      });
    } catch (error) {
      console.error('Failed to save API key:', error);
    }
  };

  const handleDelete = async (provider: LLMProviderEnum) => {
    try {
      await llmProviderStore.removeProvider(provider);
      setApiKeys(prev => {
        const newKeys = { ...prev };
        delete newKeys[provider];
        return newKeys;
      });
      setModifiedProviders(prev => {
        const newSet = new Set(prev);
        newSet.delete(provider);
        return newSet;
      });
    } catch (error) {
      console.error('Failed to delete API key:', error);
    }
  };

  const getButtonProps = (provider: LLMProviderEnum) => {
    const isModified = modifiedProviders.has(provider);
    const hasApiKey = apiKeys[provider]?.apiKey;

    return {
      saveButton: {
        disabled: !isModified || !hasApiKey,
        className: `rounded-md px-3 py-1 text-sm font-medium ${
          !isModified || !hasApiKey
            ? `${isDarkMode ? 'bg-slate-700 text-gray-400' : 'bg-gray-200 text-gray-500'}`
            : `${isDarkMode ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-blue-500 text-white hover:bg-blue-600'}`
        }`,
      },
      deleteButton: {
        disabled: !hasApiKey,
        className: `ml-2 rounded-md px-3 py-1 text-sm font-medium ${
          !hasApiKey
            ? `${isDarkMode ? 'bg-slate-700 text-gray-400' : 'bg-gray-200 text-gray-500'}`
            : `${isDarkMode ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-red-500 text-white hover:bg-red-600'}`
        }`,
      },
    };
  };

  const getAvailableModels = () => {
    const models: string[] = [];
    Object.values(LLMProviderEnum).forEach(provider => {
      if (apiKeys[provider]?.apiKey) {
        models.push(...(llmProviderModelNames[provider] || []));
      }
    });
    return models;
  };

  const handleModelChange = async (agentName: AgentNameEnum, model: string) => {
    try {
      // Determine provider from model name
      let provider: LLMProviderEnum | undefined;
      for (const [providerKey, models] of Object.entries(llmProviderModelNames)) {
        if (models.includes(model)) {
          provider = providerKey as LLMProviderEnum;
          break;
        }
      }

      if (provider) {
        await agentModelStore.setAgentModel(agentName, {
          provider,
          modelName: model,
        });
        setSelectedModels(prev => ({
          ...prev,
          [agentName]: model,
        }));
      }
    } catch (error) {
      console.error(`Failed to set model for ${agentName}:`, error);
    }
  };

  const renderApiKeyInput = (provider: LLMProviderEnum) => {
    const buttonProps = getButtonProps(provider);
    const needsBaseUrl =
      provider === LLMProviderEnum.OpenAI ||
      provider === LLMProviderEnum.Anthropic ||
      provider === LLMProviderEnum.Groq ||
      provider === LLMProviderEnum.Grok;

    return (
      <div key={provider} className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className={`text-lg font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            {provider === LLMProviderEnum.OpenAI
              ? 'OpenAI'
              : provider === LLMProviderEnum.Anthropic
                ? 'Anthropic'
                : provider === LLMProviderEnum.Gemini
                  ? 'Gemini'
                  : provider === LLMProviderEnum.Groq
                    ? 'Groq AI'
                    : provider === LLMProviderEnum.Grok
                      ? 'Grok AI'
                      : provider}
          </h3>
          <div>
            <Button
              onClick={() => handleSave(provider)}
              disabled={buttonProps.saveButton.disabled}
              className={buttonProps.saveButton.className}>
              Save
            </Button>
            <Button
              onClick={() => handleDelete(provider)}
              disabled={buttonProps.deleteButton.disabled}
              className={buttonProps.deleteButton.className}>
              Delete
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div>
            <label
              htmlFor={`${provider}-api-key`}
              className={`mb-1 block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              API Key
            </label>
            <input
              id={`${provider}-api-key`}
              type="password"
              value={apiKeys[provider]?.apiKey || ''}
              onChange={e => handleApiKeyChange(provider, e.target.value, apiKeys[provider]?.baseUrl)}
              className={`w-full rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
              placeholder={`Enter your ${provider} API key`}
            />
          </div>

          {needsBaseUrl && (
            <div>
              <label
                htmlFor={`${provider}-base-url`}
                className={`mb-1 block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Base URL (Optional)
              </label>
              <input
                id={`${provider}-base-url`}
                type="text"
                value={apiKeys[provider]?.baseUrl || ''}
                onChange={e => handleApiKeyChange(provider, apiKeys[provider]?.apiKey || '', e.target.value)}
                className={`w-full rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
                placeholder={
                  provider === LLMProviderEnum.Groq
                    ? 'https://api.groq.com/v1'
                    : provider === LLMProviderEnum.Grok
                      ? 'https://api.grok.x.ai/v1'
                      : `Enter custom base URL for ${provider} (optional)`
                }
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderModelSelect = (agentName: AgentNameEnum) => (
    <div key={agentName} className="mb-6">
      <div className="mb-2">
        <h3 className={`text-lg font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{agentName}</h3>
        <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{getAgentDescription(agentName)}</p>
      </div>

      <select
        id={`${agentName}-model`}
        value={selectedModels[agentName] || ''}
        onChange={e => handleModelChange(agentName, e.target.value)}
        className={`w-full rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
        disabled={getAvailableModels().length === 0}>
        <option value="">Select a model</option>
        {getAvailableModels().map(model => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
      </select>
    </div>
  );

  const getAgentDescription = (agentName: AgentNameEnum) => {
    switch (agentName) {
      case AgentNameEnum.Navigator:
        return 'Handles browsing and interacting with web pages';
      case AgentNameEnum.Planner:
        return 'Creates and updates the plan for completing tasks';
      case AgentNameEnum.Validator:
        return 'Validates the results of actions and task completion';
      default:
        return '';
    }
  };

  return (
    <div className="space-y-8">
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-white'} p-6 text-left shadow-sm`}>
        <h2 className={`mb-4 text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          LLM Provider API Keys
        </h2>
        <p className={`mb-4 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          Configure your API keys for the LLM providers you want to use. Your keys are stored locally and never sent to
          our servers.
        </p>

        {Object.values(LLMProviderEnum).map(provider => renderApiKeyInput(provider))}
      </div>

      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-white'} p-6 text-left shadow-sm`}>
        <h2 className={`mb-4 text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>Agent Models</h2>
        <p className={`mb-4 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          Select which models to use for each agent. You must configure at least one LLM provider above.
        </p>

        {getAvailableModels().length === 0 && (
          <div
            className={`mb-4 rounded-md ${isDarkMode ? 'bg-slate-700 text-gray-300' : 'bg-yellow-50 text-yellow-800'} p-3`}>
            <p className="text-sm">Please configure at least one LLM provider API key to select models.</p>
          </div>
        )}

        {Object.values(AgentNameEnum).map(agentName => renderModelSelect(agentName))}
      </div>
    </div>
  );
};
