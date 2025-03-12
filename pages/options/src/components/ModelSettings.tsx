import { useEffect, useState } from 'react';
import { Button } from '@extension/ui';
import {
  llmProviderStore,
  agentModelStore,
  AgentNameEnum,
  LLMProviderEnum,
  llmProviderModelNames,
} from '@extension/storage';

export const ModelSettings = () => {
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
            keys[provider] = config;
          }
        }
        setApiKeys(keys);
      } catch (error) {
        console.error('Error loading API keys:', error);
        setApiKeys({} as Record<LLMProviderEnum, { apiKey: string; baseUrl?: string }>);
      }
    };

    loadApiKeys();
  }, []);

  // Load existing agent models on mount
  useEffect(() => {
    const loadAgentModels = async () => {
      try {
        const models: Record<AgentNameEnum, string> = {
          [AgentNameEnum.Planner]: '',
          [AgentNameEnum.Navigator]: '',
          [AgentNameEnum.Validator]: '',
        };

        for (const agent of Object.values(AgentNameEnum)) {
          const config = await agentModelStore.getAgentModel(agent);
          if (config) {
            models[agent] = config.modelName;
          }
        }
        setSelectedModels(models);
      } catch (error) {
        console.error('Error loading agent models:', error);
      }
    };

    loadAgentModels();
  }, []);

  const handleApiKeyChange = (provider: LLMProviderEnum, apiKey: string, baseUrl?: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));
    setApiKeys(prev => ({
      ...prev,
      [provider]: {
        apiKey: apiKey.trim(),
        baseUrl: baseUrl !== undefined ? baseUrl.trim() : prev[provider]?.baseUrl,
      },
    }));
  };

  const handleSave = async (provider: LLMProviderEnum) => {
    try {
      await llmProviderStore.setProvider(provider, apiKeys[provider]);
      setModifiedProviders(prev => {
        const next = new Set(prev);
        next.delete(provider);
        return next;
      });
    } catch (error) {
      console.error('Error saving API key:', error);
    }
  };

  const handleDelete = async (provider: LLMProviderEnum) => {
    try {
      await llmProviderStore.removeProvider(provider);
      setApiKeys(prev => {
        const next = { ...prev };
        delete next[provider];
        return next;
      });
    } catch (error) {
      console.error('Error deleting API key:', error);
    }
  };

  const getButtonProps = (provider: LLMProviderEnum) => {
    const hasStoredKey = Boolean(apiKeys[provider]?.apiKey);
    const isModified = modifiedProviders.has(provider);
    const hasInput = Boolean(apiKeys[provider]?.apiKey?.trim());

    if (hasStoredKey && !isModified) {
      return {
        variant: 'danger' as const,
        children: 'Delete',
        disabled: false,
      };
    }

    return {
      variant: 'primary' as const,
      children: 'Save',
      disabled: !hasInput || !isModified,
    };
  };

  const getAvailableModels = () => {
    const models: string[] = [];
    Object.entries(apiKeys).forEach(([provider, config]) => {
      if (config.apiKey) {
        models.push(...(llmProviderModelNames[provider as LLMProviderEnum] || []));
      }
    });
    return models.length ? models : [''];
  };

  const handleModelChange = async (agentName: AgentNameEnum, model: string) => {
    setSelectedModels(prev => ({
      ...prev,
      [agentName]: model,
    }));

    try {
      if (model) {
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
        }
      } else {
        // Reset storage if no model is selected
        await agentModelStore.resetAgentModel(agentName);
      }
    } catch (error) {
      console.error('Error saving agent model:', error);
    }
  };

  const renderModelSelect = (agentName: AgentNameEnum) => (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-lg font-medium text-gray-700">{agentName.charAt(0).toUpperCase() + agentName.slice(1)}</h3>
        <p className="text-sm font-normal text-gray-500">{getAgentDescription(agentName)}</p>
      </div>
      <select
        className="w-64 px-3 py-2 border rounded-md"
        disabled={getAvailableModels().length <= 1}
        value={selectedModels[agentName] || ''}
        onChange={e => handleModelChange(agentName, e.target.value)}>
        <option key="default" value="">
          Choose model
        </option>
        {getAvailableModels().map(
          model =>
            model && (
              <option key={model} value={model}>
                {model}
              </option>
            ),
        )}
      </select>
    </div>
  );

  const getAgentDescription = (agentName: AgentNameEnum) => {
    switch (agentName) {
      case AgentNameEnum.Navigator:
        return 'Navigates websites and performs actions';
      case AgentNameEnum.Planner:
        return 'Develops and refines strategies to complete tasks';
      case AgentNameEnum.Validator:
        return 'Checks if tasks are completed successfully';
      default:
        return '';
    }
  };

  return (
    <section className="space-y-6">
      {/* API Keys Section */}
      <div className="bg-white rounded-lg p-6 shadow-sm border border-blue-100 text-left">
        <h2 className="text-xl font-semibold mb-4 text-gray-800 text-left">API Keys</h2>
        <div className="space-y-6">
          {/* OpenAI Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-700">OpenAI</h3>
              <Button
                {...getButtonProps(LLMProviderEnum.OpenAI)}
                size="sm"
                onClick={() =>
                  apiKeys[LLMProviderEnum.OpenAI]?.apiKey && !modifiedProviders.has(LLMProviderEnum.OpenAI)
                    ? handleDelete(LLMProviderEnum.OpenAI)
                    : handleSave(LLMProviderEnum.OpenAI)
                }
              />
            </div>
            <div className="space-y-3">
              <input
                type="password"
                placeholder="OpenAI API key"
                value={apiKeys[LLMProviderEnum.OpenAI]?.apiKey || ''}
                onChange={e => handleApiKeyChange(LLMProviderEnum.OpenAI, e.target.value)}
                className="w-full p-2 rounded-md bg-gray-50 border border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-200 outline-none"
              />
              <input
                type="text"
                placeholder="Custom Base URL (Optional)"
                value={apiKeys[LLMProviderEnum.OpenAI]?.baseUrl || ''}
                onChange={e =>
                  handleApiKeyChange(
                    LLMProviderEnum.OpenAI,
                    apiKeys[LLMProviderEnum.OpenAI]?.apiKey || '',
                    e.target.value,
                  )
                }
                className="w-full p-2 rounded-md bg-gray-50 border border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-200 outline-none"
              />
            </div>
          </div>

          <div className="border-t border-gray-200"></div>

          {/* Anthropic Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-700">Anthropic</h3>
              <Button
                {...getButtonProps(LLMProviderEnum.Anthropic)}
                size="sm"
                onClick={() =>
                  apiKeys[LLMProviderEnum.Anthropic]?.apiKey && !modifiedProviders.has(LLMProviderEnum.Anthropic)
                    ? handleDelete(LLMProviderEnum.Anthropic)
                    : handleSave(LLMProviderEnum.Anthropic)
                }
              />
            </div>
            <div className="space-y-3">
              <input
                type="password"
                placeholder="Anthropic API key"
                value={apiKeys[LLMProviderEnum.Anthropic]?.apiKey || ''}
                onChange={e => handleApiKeyChange(LLMProviderEnum.Anthropic, e.target.value)}
                className="w-full p-2 rounded-md bg-gray-50 border border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-200 outline-none"
              />
            </div>
          </div>

          <div className="border-t border-gray-200" />

          {/* Gemini Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-700">Gemini</h3>
              <Button
                {...getButtonProps(LLMProviderEnum.Gemini)}
                size="sm"
                onClick={() =>
                  apiKeys[LLMProviderEnum.Gemini]?.apiKey && !modifiedProviders.has(LLMProviderEnum.Gemini)
                    ? handleDelete(LLMProviderEnum.Gemini)
                    : handleSave(LLMProviderEnum.Gemini)
                }
              />
            </div>
            <div className="space-y-3">
              <input
                type="password"
                placeholder="Gemini API key"
                value={apiKeys[LLMProviderEnum.Gemini]?.apiKey || ''}
                onChange={e => handleApiKeyChange(LLMProviderEnum.Gemini, e.target.value)}
                className="w-full p-2 rounded-md bg-gray-50 border border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-200 outline-none"
              />
            </div>
          </div>

          <div className="border-t border-gray-200" />

          {/* DeepSeek Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-700">DeepSeek</h3>
              <Button
                {...getButtonProps(LLMProviderEnum.DeepSeek)}
                size="sm"
                onClick={() =>
                  apiKeys[LLMProviderEnum.DeepSeek]?.apiKey && !modifiedProviders.has(LLMProviderEnum.DeepSeek)
                    ? handleDelete(LLMProviderEnum.DeepSeek)
                    : handleSave(LLMProviderEnum.DeepSeek)
                }
              />
            </div>
            <div className="space-y-3">
              <input
                type="password"
                placeholder="DeepSeek API key"
                value={apiKeys[LLMProviderEnum.DeepSeek]?.apiKey || ''}
                onChange={e => handleApiKeyChange(LLMProviderEnum.DeepSeek, e.target.value)}
                className="w-full p-2 rounded-md bg-gray-50 border border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-200 outline-none"
              />
              <input
                type="text"
                placeholder="Custom Base URL (Optional)"
                value={apiKeys[LLMProviderEnum.DeepSeek]?.baseUrl || ''}
                onChange={e =>
                  handleApiKeyChange(
                    LLMProviderEnum.DeepSeek,
                    apiKeys[LLMProviderEnum.DeepSeek]?.apiKey || '',
                    e.target.value,
                  )
                }
                className="w-full p-2 rounded-md bg-gray-50 border border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-200 outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Updated Agent Models Section */}
      <div className="bg-white rounded-lg p-6 shadow-sm border border-blue-100 text-left">
        <h2 className="text-xl font-semibold mb-4 text-gray-800 text-left">Model Selection</h2>
        <div className="space-y-4">
          {[AgentNameEnum.Planner, AgentNameEnum.Navigator, AgentNameEnum.Validator].map(agentName => (
            <div key={agentName}>{renderModelSelect(agentName)}</div>
          ))}
        </div>
      </div>
    </section>
  );
};
