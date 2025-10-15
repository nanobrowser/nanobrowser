/*
 * Changes:
 * - Added a searchable select component with filtering capability for model selection
 * - Implemented keyboard navigation and accessibility for the custom dropdown
 * - Added search functionality that filters models based on user input
 * - Added keyboard event handlers to close dropdowns with Escape key
 * - Styling for both light and dark mode themes
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import type { KeyboardEvent } from 'react';
import { Button } from '@extension/ui';
import {
  llmProviderStore,
  agentModelStore,
  speechToTextModelStore,
  AgentNameEnum,
  llmProviderModelNames,
  ProviderTypeEnum,
  getDefaultDisplayNameFromProviderId,
  getDefaultProviderConfig,
  getDefaultAgentModelParams,
  type ProviderConfig,
} from '@extension/storage';
import { t } from '@extension/i18n';

// Helper function to check if a model is an OpenAI reasoning model (O-series or GPT-5 models)
function isOpenAIReasoningModel(modelName: string): boolean {
  // Extract the model name without provider prefix if present
  let modelNameWithoutProvider = modelName;
  if (modelName.includes('>')) {
    // Handle "provider>model" format
    modelNameWithoutProvider = modelName.split('>')[1];
  }
  if (modelNameWithoutProvider.startsWith('openai/')) {
    modelNameWithoutProvider = modelNameWithoutProvider.substring(7);
  }
  return (
    modelNameWithoutProvider.startsWith('o') ||
    (modelNameWithoutProvider.startsWith('gpt-5') && !modelNameWithoutProvider.startsWith('gpt-5-chat'))
  );
}

function isAnthropicOpusModel(modelName: string): boolean {
  // Extract the model name without provider prefix if present
  let modelNameWithoutProvider = modelName;

  if (modelName.includes('>')) {
    // Handle "provider>model" format
    modelNameWithoutProvider = modelName.split('>')[1];
  }

  // Check if the model starts with 'claude-opus'
  return modelNameWithoutProvider.startsWith('claude-opus');
}

interface ModelSettingsProps {
  isDarkMode?: boolean; // Controls dark/light theme styling
}

export const ModelSettings = ({ isDarkMode = false }: ModelSettingsProps) => {
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({});
  const [modifiedProviders, setModifiedProviders] = useState<Set<string>>(new Set());
  const [providersFromStorage, setProvidersFromStorage] = useState<Set<string>>(new Set());
  const [selectedModels, setSelectedModels] = useState<Record<AgentNameEnum, string>>({
    [AgentNameEnum.Navigator]: '',
    [AgentNameEnum.Planner]: '',
  });
  const [modelParameters, setModelParameters] = useState<Record<AgentNameEnum, { temperature: number; topP: number }>>({
    [AgentNameEnum.Navigator]: { temperature: 0, topP: 0 },
    [AgentNameEnum.Planner]: { temperature: 0, topP: 0 },
  });

  // State for reasoning effort for O-series models
  const [reasoningEffort, setReasoningEffort] = useState<
    Record<AgentNameEnum, 'minimal' | 'low' | 'medium' | 'high' | undefined>
  >({
    [AgentNameEnum.Navigator]: undefined,
    [AgentNameEnum.Planner]: undefined,
  });
  const [newModelInputs, setNewModelInputs] = useState<Record<string, string>>({});
  const [isProviderSelectorOpen, setIsProviderSelectorOpen] = useState(false);
  const newlyAddedProviderRef = useRef<string | null>(null);
  const [nameErrors, setNameErrors] = useState<Record<string, string>>({});
  // Add state for tracking API key visibility
  const [visibleApiKeys, setVisibleApiKeys] = useState<Record<string, boolean>>({});
  // Create a non-async wrapper for use in render functions
  const [availableModels, setAvailableModels] = useState<
    Array<{ provider: string; providerName: string; model: string }>
  >([]);
  // State for model input handling

  const [selectedSpeechToTextModel, setSelectedSpeechToTextModel] = useState<string>('');

  useEffect(() => {
    const loadProviders = async () => {
      try {
        const allProviders = await llmProviderStore.getAllProviders();
        console.log('allProviders', allProviders);

        // Track which providers are from storage
        const fromStorage = new Set(Object.keys(allProviders));
        setProvidersFromStorage(fromStorage);

        // Only use providers from storage, don't add default ones
        setProviders(allProviders);
      } catch (error) {
        console.error('Error loading providers:', error);
        // Set empty providers on error
        setProviders({});
        // No providers from storage on error
        setProvidersFromStorage(new Set());
      }
    };

    loadProviders();
  }, []);

  // Load existing agent models and parameters on mount
  useEffect(() => {
    const loadAgentModels = async () => {
      try {
        const models: Record<AgentNameEnum, string> = {
          [AgentNameEnum.Planner]: '',
          [AgentNameEnum.Navigator]: '',
        };

        for (const agent of Object.values(AgentNameEnum)) {
          const config = await agentModelStore.getAgentModel(agent);
          if (config) {
            // Store in provider>model format
            models[agent] = `${config.provider}>${config.modelName}`;
            if (config.parameters?.temperature !== undefined || config.parameters?.topP !== undefined) {
              setModelParameters(prev => ({
                ...prev,
                [agent]: {
                  temperature: config.parameters?.temperature ?? prev[agent].temperature,
                  topP: config.parameters?.topP ?? prev[agent].topP,
                },
              }));
            }
            // Also load reasoningEffort if available
            if (config.reasoningEffort) {
              setReasoningEffort(prev => ({
                ...prev,
                [agent]: config.reasoningEffort as 'minimal' | 'low' | 'medium' | 'high',
              }));
            }
          }
        }
        setSelectedModels(models);
      } catch (error) {
        console.error('Error loading agent models:', error);
      }
    };

    loadAgentModels();
  }, []);

  useEffect(() => {
    const loadSpeechToTextModel = async () => {
      try {
        const config = await speechToTextModelStore.getSpeechToTextModel();
        if (config) {
          setSelectedSpeechToTextModel(`${config.provider}>${config.modelName}`);
        }
      } catch (error) {
        console.error('Error loading speech-to-text model:', error);
      }
    };

    loadSpeechToTextModel();
  }, []);

  // Auto-focus the input field when a new provider is added
  useEffect(() => {
    // Only focus if we have a newly added provider reference
    if (newlyAddedProviderRef.current && providers[newlyAddedProviderRef.current]) {
      const providerId = newlyAddedProviderRef.current;
      const config = providers[providerId];

      // For custom providers, focus on the name input
      if (config.type === ProviderTypeEnum.CustomOpenAI) {
        const nameInput = document.getElementById(`${providerId}-name`);
        if (nameInput) {
          nameInput.focus();
        }
      } else {
        // For default providers, focus on the API key input
        const apiKeyInput = document.getElementById(`${providerId}-api-key`);
        if (apiKeyInput) {
          apiKeyInput.focus();
        }
      }

      // Clear the ref after focusing
      newlyAddedProviderRef.current = null;
    }
  }, [providers]);

  // Add a click outside handler to close the dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (isProviderSelectorOpen && !target.closest('.provider-selector-container')) {
        setIsProviderSelectorOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isProviderSelectorOpen]);

  // Create a memoized version of getAvailableModels
  const getAvailableModelsCallback = useCallback(async () => {
    const models: Array<{ provider: string; providerName: string; model: string }> = [];

    try {
      // Load providers directly from storage
      const storedProviders = await llmProviderStore.getAllProviders();

      // Only use providers that are actually in storage
      for (const [provider, config] of Object.entries(storedProviders)) {
        if (config.type === ProviderTypeEnum.AzureOpenAI) {
          // Handle Azure providers specially - use deployment names as models
          const deploymentNames = config.azureDeploymentNames || [];

          models.push(
            ...deploymentNames.map(deployment => ({
              provider,
              providerName: config.name || provider,
              model: deployment,
            })),
          );
        } else {
          // Standard handling for non-Azure providers
          const providerModels =
            config.modelNames || llmProviderModelNames[provider as keyof typeof llmProviderModelNames] || [];
          models.push(
            ...providerModels.map(model => ({
              provider,
              providerName: config.name || provider,
              model,
            })),
          );
        }
      }
    } catch (error) {
      console.error('Error loading providers for model selection:', error);
    }

    return models;
  }, []);

  // Update available models whenever providers change
  useEffect(() => {
    const updateAvailableModels = async () => {
      const models = await getAvailableModelsCallback();
      setAvailableModels(models);
    };

    updateAvailableModels();
  }, [getAvailableModelsCallback]); // Only depends on the callback

  const handleApiKeyChange = (provider: string, apiKey: string, baseUrl?: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        apiKey: apiKey.trim(),
        baseUrl: baseUrl !== undefined ? baseUrl.trim() : prev[provider]?.baseUrl,
      },
    }));
  };

  // Add a toggle handler for API key visibility
  const toggleApiKeyVisibility = (provider: string) => {
    setVisibleApiKeys(prev => ({
      ...prev,
      [provider]: !prev[provider],
    }));
  };

  const handleNameChange = (provider: string, name: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => {
      const updated = {
        ...prev,
        [provider]: {
          ...prev[provider],
          name: name.trim(),
        },
      };
      return updated;
    });
  };

  const handleModelsChange = (provider: string, modelsString: string) => {
    setNewModelInputs(prev => ({
      ...prev,
      [provider]: modelsString,
    }));
  };

  const addModel = (provider: string, model: string) => {
    if (!model.trim()) return;

    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => {
      const providerData = prev[provider] || {};

      // Get current models - either from provider config or default models
      let currentModels = providerData.modelNames;
      if (currentModels === undefined) {
        currentModels = [...(llmProviderModelNames[provider as keyof typeof llmProviderModelNames] || [])];
      }

      // Don't add duplicates
      if (currentModels.includes(model.trim())) return prev;

      return {
        ...prev,
        [provider]: {
          ...providerData,
          modelNames: [...currentModels, model.trim()],
        },
      };
    });

    // Clear the input
    setNewModelInputs(prev => ({
      ...prev,
      [provider]: '',
    }));
  };

  const removeModel = (provider: string, modelToRemove: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));

    setProviders(prev => {
      const providerData = prev[provider] || {};

      // If modelNames doesn't exist in the provider data yet, we need to initialize it
      // with the default models from llmProviderModelNames first
      if (!providerData.modelNames) {
        const defaultModels = llmProviderModelNames[provider as keyof typeof llmProviderModelNames] || [];
        const filteredModels = defaultModels.filter(model => model !== modelToRemove);

        return {
          ...prev,
          [provider]: {
            ...providerData,
            modelNames: filteredModels,
          },
        };
      }

      // If modelNames already exists, just filter out the model to remove
      return {
        ...prev,
        [provider]: {
          ...providerData,
          modelNames: providerData.modelNames.filter(model => model !== modelToRemove),
        },
      };
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>, provider: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const value = newModelInputs[provider] || '';
      addModel(provider, value);
    }
  };

  const getButtonProps = (provider: string) => {
    const isInStorage = providersFromStorage.has(provider);
    const isModified = modifiedProviders.has(provider);

    // For deletion, we only care if it's in storage and not modified
    if (isInStorage && !isModified) {
      return {
        theme: isDarkMode ? 'dark' : 'light',
        variant: 'danger' as const,
        children: t('options_models_providers_btnDelete'),
        disabled: false,
      };
    }

    // For saving, we need to check if it has the required inputs
    let hasInput = false;
    const providerType = providers[provider]?.type;
    const config = providers[provider];

    if (providerType === ProviderTypeEnum.CustomOpenAI) {
      hasInput = Boolean(config?.baseUrl?.trim()); // Custom needs Base URL, name checked elsewhere
    } else if (providerType === ProviderTypeEnum.Ollama) {
      hasInput = Boolean(config?.baseUrl?.trim()); // Ollama needs Base URL
    } else if (providerType === ProviderTypeEnum.AzureOpenAI) {
      // Azure needs API Key, Endpoint, Deployment Names, and API Version
      hasInput =
        Boolean(config?.apiKey?.trim()) &&
        Boolean(config?.baseUrl?.trim()) &&
        Boolean(config?.azureDeploymentNames?.length) &&
        Boolean(config?.azureApiVersion?.trim());
    } else if (providerType === ProviderTypeEnum.OpenRouter) {
      // OpenRouter needs API Key and optionally Base URL (has default)
      hasInput = Boolean(config?.apiKey?.trim()) && Boolean(config?.baseUrl?.trim());
    } else if (providerType === ProviderTypeEnum.Llama) {
      // Llama needs API Key and Base URL
      hasInput = Boolean(config?.apiKey?.trim()) && Boolean(config?.baseUrl?.trim());
    } else {
      // Other built-in providers just need API Key
      hasInput = Boolean(config?.apiKey?.trim());
    }

    return {
      theme: isDarkMode ? 'dark' : 'light',
      variant: 'primary' as const,
      children: t('options_models_providers_btnSave'),
      disabled: !hasInput || !isModified,
    };
  };

  const handleSave = async (provider: string) => {
    try {
      // Check if name contains spaces for custom providers
      if (providers[provider].type === ProviderTypeEnum.CustomOpenAI && providers[provider].name?.includes(' ')) {
        setNameErrors(prev => ({
          ...prev,
          [provider]: t('options_models_providers_errors_spacesNotAllowed'),
        }));
        return;
      }

      // Check if base URL is required but missing for custom_openai, ollama, azure_openai or openrouter
      // Note: Groq and Cerebras do not require base URL as they use the default endpoint
      if (
        (providers[provider].type === ProviderTypeEnum.CustomOpenAI ||
          providers[provider].type === ProviderTypeEnum.Ollama ||
          providers[provider].type === ProviderTypeEnum.AzureOpenAI ||
          providers[provider].type === ProviderTypeEnum.OpenRouter ||
          providers[provider].type === ProviderTypeEnum.Llama) &&
        (!providers[provider].baseUrl || !providers[provider].baseUrl.trim())
      ) {
        alert(t('options_models_providers_errors_baseUrlRequired', getDefaultDisplayNameFromProviderId(provider)));
        return;
      }

      // Ensure modelNames is provided
      let modelNames = providers[provider].modelNames;
      if (!modelNames) {
        // Use default model names if not explicitly set
        modelNames = [...(llmProviderModelNames[provider as keyof typeof llmProviderModelNames] || [])];
      }

      // Prepare data for saving using the correctly typed config from state
      // We can directly pass the relevant parts of the state config
      // Create a copy to avoid modifying state directly if needed, though setProvider likely handles it
      const configToSave: Partial<ProviderConfig> = { ...providers[provider] }; // Use Partial to allow deleting modelNames

      // Explicitly set required fields that might be missing in partial state updates (though unlikely now)
      configToSave.apiKey = providers[provider].apiKey || '';
      configToSave.name = providers[provider].name || getDefaultDisplayNameFromProviderId(provider);
      configToSave.type = providers[provider].type;
      configToSave.createdAt = providers[provider].createdAt || Date.now();
      // baseUrl, azureDeploymentName, azureApiVersion should be correctly set by handlers

      if (providers[provider].type === ProviderTypeEnum.AzureOpenAI) {
        // Ensure modelNames is NOT included for Azure
        configToSave.modelNames = undefined;
      } else {
        // Ensure modelNames IS included for non-Azure
        // Use existing modelNames from state, or default if somehow missing
        configToSave.modelNames =
          providers[provider].modelNames || llmProviderModelNames[provider as keyof typeof llmProviderModelNames] || [];
      }

      // Pass the cleaned config to setProvider
      // Cast to ProviderConfig as we've ensured necessary fields based on type
      await llmProviderStore.setProvider(provider, configToSave as ProviderConfig);

      // Clear any name errors on successful save
      setNameErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[provider];
        return newErrors;
      });

      // Add to providersFromStorage since it's now saved
      setProvidersFromStorage(prev => new Set(prev).add(provider));

      setModifiedProviders(prev => {
        const next = new Set(prev);
        next.delete(provider);
        return next;
      });

      // Refresh available models
      const models = await getAvailableModelsCallback();
      setAvailableModels(models);
    } catch (error) {
      console.error('Error saving API key:', error);
    }
  };

  const handleDelete = async (provider: string) => {
    try {
      // Delete the provider from storage regardless of its API key value
      await llmProviderStore.removeProvider(provider);

      // Remove from providersFromStorage
      setProvidersFromStorage(prev => {
        const next = new Set(prev);
        next.delete(provider);
        return next;
      });

      // Remove from providers state
      setProviders(prev => {
        const next = { ...prev };
        delete next[provider];
        return next;
      });

      // Also remove from modifiedProviders if it's there
      setModifiedProviders(prev => {
        const next = new Set(prev);
        next.delete(provider);
        return next;
      });

      // Refresh available models
      const models = await getAvailableModelsCallback();
      setAvailableModels(models);
    } catch (error) {
      console.error('Error deleting provider:', error);
    }
  };

  const handleCancelProvider = (providerId: string) => {
    // Remove the provider from the state
    setProviders(prev => {
      const next = { ...prev };
      delete next[providerId];
      return next;
    });

    // Remove from modified providers
    setModifiedProviders(prev => {
      const next = new Set(prev);
      next.delete(providerId);
      return next;
    });
  };

  const handleModelChange = async (agentName: AgentNameEnum, modelValue: string) => {
    // modelValue will be in format "provider>model"
    const [provider, model] = modelValue.split('>');

    console.log(`[handleModelChange] Setting ${agentName} model: provider=${provider}, model=${model}`);

    // Set parameters based on provider type
    const newParameters = getDefaultAgentModelParams(provider, agentName);

    setModelParameters(prev => ({
      ...prev,
      [agentName]: newParameters,
    }));

    // Store both provider and model name in the format "provider>model"
    setSelectedModels(prev => ({
      ...prev,
      [agentName]: modelValue, // Store the full provider>model value
    }));

    try {
      if (model) {
        const providerConfig = providers[provider];

        // For Azure, verify the model is in the deployment names list
        if (providerConfig && providerConfig.type === ProviderTypeEnum.AzureOpenAI) {
          console.log(`[handleModelChange] Azure model selected: ${model}`);
        }

        // Reset reasoning effort if switching models
        if (isOpenAIReasoningModel(modelValue)) {
          // Set default reasoning effort based on agent type
          const defaultReasoningEffort = agentName === AgentNameEnum.Planner ? 'low' : 'minimal';
          setReasoningEffort(prev => ({
            ...prev,
            [agentName]: prev[agentName] || defaultReasoningEffort,
          }));
        } else {
          // Clear reasoning effort for non-O-series models
          setReasoningEffort(prev => ({
            ...prev,
            [agentName]: undefined,
          }));
        }

        // For Anthropic Opus models, only pass temperature, not topP
        const parametersToSave = isAnthropicOpusModel(modelValue)
          ? { temperature: newParameters.temperature }
          : newParameters;

        await agentModelStore.setAgentModel(agentName, {
          provider,
          modelName: model,
          parameters: parametersToSave,
          reasoningEffort: isOpenAIReasoningModel(modelValue)
            ? reasoningEffort[agentName] || (agentName === AgentNameEnum.Planner ? 'low' : 'minimal')
            : undefined,
        });
      } else {
        // Reset storage if no model is selected
        await agentModelStore.resetAgentModel(agentName);
      }
    } catch (error) {
      console.error('Error saving agent model:', error);
    }
  };

  const handleReasoningEffortChange = async (
    agentName: AgentNameEnum,
    value: 'minimal' | 'low' | 'medium' | 'high',
  ) => {
    setReasoningEffort(prev => ({
      ...prev,
      [agentName]: value,
    }));

    // Only update if we have a selected model
    if (selectedModels[agentName] && isOpenAIReasoningModel(selectedModels[agentName])) {
      try {
        // Extract provider and model from the "provider>model" format
        const [provider, modelName] = selectedModels[agentName].split('>');

        if (provider && modelName) {
          await agentModelStore.setAgentModel(agentName, {
            provider,
            modelName,
            parameters: modelParameters[agentName],
            reasoningEffort: value,
          });
        }
      } catch (error) {
        console.error('Error saving reasoning effort:', error);
      }
    }
  };

  const handleParameterChange = async (agentName: AgentNameEnum, paramName: 'temperature' | 'topP', value: number) => {
    const newParameters = {
      ...modelParameters[agentName],
      [paramName]: value,
    };

    setModelParameters(prev => ({
      ...prev,
      [agentName]: newParameters,
    }));

    // Only update if we have a selected model
    if (selectedModels[agentName]) {
      try {
        // Extract provider and model from the "provider>model" format
        const [provider, modelName] = selectedModels[agentName].split('>');

        if (provider && modelName) {
          // For Anthropic Opus models, only pass temperature, not topP
          const parametersToSave = isAnthropicOpusModel(selectedModels[agentName])
            ? { temperature: newParameters.temperature }
            : newParameters;

          await agentModelStore.setAgentModel(agentName, {
            provider,
            modelName,
            parameters: parametersToSave,
          });
        }
      } catch (error) {
        console.error('Error saving agent parameters:', error);
      }
    }
  };

  const handleSpeechToTextModelChange = async (modelValue: string) => {
    setSelectedSpeechToTextModel(modelValue);

    try {
      if (modelValue) {
        // Parse the "provider>model" format
        const [provider, modelName] = modelValue.split('>');

        // Save to proper storage
        await speechToTextModelStore.setSpeechToTextModel({
          provider,
          modelName,
        });
      } else {
        // Reset if no model selected
        await speechToTextModelStore.resetSpeechToTextModel();
      }
    } catch (error) {
      console.error('Error saving speech-to-text model:', error);
    }
  };

  const renderModelSelect = (agentName: AgentNameEnum) => (
    <div
      className={`rounded-lg border ${isDarkMode ? 'border-gray-700 bg-slate-800' : 'border-gray-200 bg-gray-50'} p-4`}>
      <h3 className={`mb-2 text-lg font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
        {agentName.charAt(0).toUpperCase() + agentName.slice(1)}
      </h3>
      <p className={`mb-4 text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
        {getAgentDescription(agentName)}
      </p>

      <div className="space-y-4">
        {/* Model Selection */}
        <div className="flex items-center">
          <label
            htmlFor={`${agentName}-model`}
            className={`w-24 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            {t('options_models_labels_model')}
          </label>
          <select
            id={`${agentName}-model`}
            className={`flex-1 rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
            disabled={availableModels.length === 0}
            value={selectedModels[agentName] || ''} // Use the stored provider>model value directly
            onChange={e => handleModelChange(agentName, e.target.value)}>
            <option key="default" value="">
              {t('options_models_chooseModel')}
            </option>
            {availableModels.map(({ provider, providerName, model }) => (
              <option key={`${provider}>${model}`} value={`${provider}>${model}`}>
                {`${providerName} > ${model}`}
              </option>
            ))}
          </select>
        </div>

        {/* Temperature Slider - Only show for non-reasoning models */}
        {selectedModels[agentName] && !isOpenAIReasoningModel(selectedModels[agentName]) && (
          <div className="flex items-center">
            <label
              htmlFor={`${agentName}-temperature`}
              className={`w-24 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {t('options_models_labels_temperature')}
            </label>
            <div className="flex flex-1 items-center space-x-2">
              <input
                id={`${agentName}-temperature`}
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={modelParameters[agentName].temperature}
                onChange={e => handleParameterChange(agentName, 'temperature', Number.parseFloat(e.target.value))}
                style={{
                  background: `linear-gradient(to right, ${isDarkMode ? '#3b82f6' : '#60a5fa'} 0%, ${isDarkMode ? '#3b82f6' : '#60a5fa'} ${(modelParameters[agentName].temperature / 2) * 100}%, ${isDarkMode ? '#475569' : '#cbd5e1'} ${(modelParameters[agentName].temperature / 2) * 100}%, ${isDarkMode ? '#475569' : '#cbd5e1'} 100%)`,
                }}
                className={`flex-1 ${isDarkMode ? 'accent-blue-500' : 'accent-blue-400'} h-1 appearance-none rounded-full`}
              />
              <div className="flex items-center space-x-2">
                <span className={`w-12 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {modelParameters[agentName].temperature.toFixed(2)}
                </span>
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.01"
                  value={modelParameters[agentName].temperature}
                  onChange={e => {
                    const value = Number.parseFloat(e.target.value);
                    if (!Number.isNaN(value) && value >= 0 && value <= 2) {
                      handleParameterChange(agentName, 'temperature', value);
                    }
                  }}
                  className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-800' : 'border-gray-300 bg-white text-gray-700 focus:border-blue-400 focus:ring-2 focus:ring-blue-200'} px-2 py-1 text-sm`}
                  aria-label={`${agentName} temperature number input`}
                />
              </div>
            </div>
          </div>
        )}

        {/* Top P Slider - Only show for non-reasoning models */}
        {selectedModels[agentName] &&
          !isOpenAIReasoningModel(selectedModels[agentName]) &&
          !isAnthropicOpusModel(selectedModels[agentName]) && (
            <div className="flex items-center">
              <label
                htmlFor={`${agentName}-topP`}
                className={`w-24 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_models_labels_topP')}
              </label>
              <div className="flex flex-1 items-center space-x-2">
                <input
                  id={`${agentName}-topP`}
                  type="range"
                  min="0"
                  max="1"
                  step="0.001"
                  value={modelParameters[agentName].topP}
                  onChange={e => handleParameterChange(agentName, 'topP', Number.parseFloat(e.target.value))}
                  style={{
                    background: `linear-gradient(to right, ${isDarkMode ? '#3b82f6' : '#60a5fa'} 0%, ${isDarkMode ? '#3b82f6' : '#60a5fa'} ${modelParameters[agentName].topP * 100}%, ${isDarkMode ? '#475569' : '#cbd5e1'} ${modelParameters[agentName].topP * 100}%, ${isDarkMode ? '#475569' : '#cbd5e1'} 100%)`,
                  }}
                  className={`flex-1 ${isDarkMode ? 'accent-blue-500' : 'accent-blue-400'} h-1 appearance-none rounded-full`}
                />
                <div className="flex items-center space-x-2">
                  <span className={`w-12 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    {modelParameters[agentName].topP.toFixed(3)}
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.001"
                    value={modelParameters[agentName].topP}
                    onChange={e => {
                      const value = Number.parseFloat(e.target.value);
                      if (!Number.isNaN(value) && value >= 0 && value <= 1) {
                        handleParameterChange(agentName, 'topP', value);
                      }
                    }}
                    className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-800' : 'border-gray-300 bg-white text-gray-700 focus:border-blue-400 focus:ring-2 focus:ring-blue-200'} px-2 py-1 text-sm`}
                    aria-label={`${agentName} top P number input`}
                  />
                </div>
              </div>
            </div>
          )}

        {/* Reasoning Effort Selector (only for O-series models) */}
        {selectedModels[agentName] && isOpenAIReasoningModel(selectedModels[agentName]) && (
          <div className="flex items-center">
            <label
              htmlFor={`${agentName}-reasoning-effort`}
              className={`w-24 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {t('options_models_labels_reasoning')}
            </label>
            <div className="flex flex-1 items-center space-x-2">
              <select
                id={`${agentName}-reasoning-effort`}
                value={reasoningEffort[agentName] || (agentName === AgentNameEnum.Planner ? 'low' : 'minimal')}
                onChange={e =>
                  handleReasoningEffortChange(agentName, e.target.value as 'minimal' | 'low' | 'medium' | 'high')
                }
                className={`flex-1 rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}>
                <option value="minimal">Minimal</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const getAgentDescription = (agentName: AgentNameEnum) => {
    switch (agentName) {
      case AgentNameEnum.Navigator:
        return t('options_models_agents_navigator');
      case AgentNameEnum.Planner:
        return t('options_models_agents_planner');
      default:
        return '';
    }
  };

  const getMaxCustomProviderNumber = () => {
    let maxNumber = 0;
    for (const providerId of Object.keys(providers)) {
      if (providerId.startsWith('custom_openai_')) {
        const match = providerId.match(/custom_openai_(\d+)/);
        if (match) {
          const number = Number.parseInt(match[1], 10);
          maxNumber = Math.max(maxNumber, number);
        }
      }
    }
    return maxNumber;
  };

  const addCustomProvider = () => {
    const nextNumber = getMaxCustomProviderNumber() + 1;
    const providerId = `custom_openai_${nextNumber}`;

    setProviders(prev => ({
      ...prev,
      [providerId]: {
        apiKey: '',
        name: `CustomProvider${nextNumber}`,
        type: ProviderTypeEnum.CustomOpenAI,
        baseUrl: '',
        modelNames: [],
        createdAt: Date.now(),
      },
    }));

    setModifiedProviders(prev => new Set(prev).add(providerId));

    // Set the newly added provider ref
    newlyAddedProviderRef.current = providerId;

    // Scroll to the newly added provider after render
    setTimeout(() => {
      const providerElement = document.getElementById(`provider-${providerId}`);
      if (providerElement) {
        providerElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  const addBuiltInProvider = (provider: string) => {
    // Get the default provider configuration
    const config = getDefaultProviderConfig(provider);

    // Add the provider to the state
    setProviders(prev => ({
      ...prev,
      [provider]: config,
    }));

    // Mark as modified so it shows up in the UI
    setModifiedProviders(prev => new Set(prev).add(provider));

    // Set the newly added provider ref
    newlyAddedProviderRef.current = provider;

    // Scroll to the newly added provider after render
    setTimeout(() => {
      const providerElement = document.getElementById(`provider-${provider}`);
      if (providerElement) {
        providerElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  // Sort providers to ensure newly added providers appear at the bottom
  const getSortedProviders = () => {
    // Filter providers to only include those from storage and newly added providers
    const filteredProviders = Object.entries(providers).filter(([providerId, config]) => {
      // ALSO filter out any provider missing a config or type, to satisfy TS
      if (!config || !config.type) {
        console.warn(`Filtering out provider ${providerId} with missing config or type.`);
        return false;
      }

      // Include if it's from storage
      if (providersFromStorage.has(providerId)) {
        return true;
      }

      // Include if it's a newly added provider (has been modified)
      if (modifiedProviders.has(providerId)) {
        return true;
      }

      // Exclude providers that aren't from storage and haven't been modified
      return false;
    });

    // Sort the filtered providers
    return filteredProviders.sort(([keyA, configA], [keyB, configB]) => {
      // Separate newly added providers from stored providers
      const isNewA = !providersFromStorage.has(keyA) && modifiedProviders.has(keyA);
      const isNewB = !providersFromStorage.has(keyB) && modifiedProviders.has(keyB);

      // If one is new and one is stored, new ones go to the end
      if (isNewA && !isNewB) return 1;
      if (!isNewA && isNewB) return -1;

      // If both are new or both are stored, sort by createdAt
      if (configA.createdAt && configB.createdAt) {
        return configA.createdAt - configB.createdAt; // Sort in ascending order (oldest first)
      }

      // If only one has createdAt, put the one without createdAt at the end
      if (configA.createdAt) return -1;
      if (configB.createdAt) return 1;

      // If neither has createdAt, sort by type and then name
      const isCustomA = configA.type === ProviderTypeEnum.CustomOpenAI;
      const isCustomB = configB.type === ProviderTypeEnum.CustomOpenAI;

      if (isCustomA && !isCustomB) {
        return 1; // Custom providers come after non-custom
      }

      if (!isCustomA && isCustomB) {
        return -1; // Non-custom providers come before custom
      }

      // Sort alphabetically by name within each group
      return (configA.name || keyA).localeCompare(configB.name || keyB);
    });
  };

  const handleProviderSelection = (providerType: string) => {
    // Close the dropdown immediately
    setIsProviderSelectorOpen(false);

    // Handle custom provider
    if (providerType === ProviderTypeEnum.CustomOpenAI) {
      addCustomProvider();
      return;
    }

    // Handle Azure OpenAI specially to allow multiple instances
    if (providerType === ProviderTypeEnum.AzureOpenAI) {
      addAzureProvider();
      return;
    }

    // Handle built-in supported providers
    addBuiltInProvider(providerType);
  };

  // New function to add Azure providers with unique IDs
  const addAzureProvider = () => {
    // Count existing Azure providers
    const azureProviders = Object.keys(providers).filter(
      key => key === ProviderTypeEnum.AzureOpenAI || key.startsWith(`${ProviderTypeEnum.AzureOpenAI}_`),
    );
    const nextNumber = azureProviders.length + 1;

    // Create unique ID
    const providerId =
      nextNumber === 1 ? ProviderTypeEnum.AzureOpenAI : `${ProviderTypeEnum.AzureOpenAI}_${nextNumber}`;

    // Create config with appropriate name
    const config = getDefaultProviderConfig(ProviderTypeEnum.AzureOpenAI);
    config.name = `Azure OpenAI ${nextNumber}`;

    // Add to providers
    setProviders(prev => ({
      ...prev,
      [providerId]: config,
    }));

    setModifiedProviders(prev => new Set(prev).add(providerId));
    newlyAddedProviderRef.current = providerId;

    // Scroll to the newly added provider after render
    setTimeout(() => {
      const providerElement = document.getElementById(`provider-${providerId}`);
      if (providerElement) {
        providerElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  // Add and remove Azure deployments
  const addAzureDeployment = (provider: string, deploymentName: string) => {
    if (!deploymentName.trim()) return;

    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => {
      const providerData = prev[provider] || {};

      // Initialize or use existing deploymentNames array
      const deploymentNames = providerData.azureDeploymentNames || [];

      // Don't add duplicates
      if (deploymentNames.includes(deploymentName.trim())) return prev;

      return {
        ...prev,
        [provider]: {
          ...providerData,
          azureDeploymentNames: [...deploymentNames, deploymentName.trim()],
        },
      };
    });

    // Clear the input
    setNewModelInputs(prev => ({
      ...prev,
      [provider]: '',
    }));
  };

  const removeAzureDeployment = (provider: string, deploymentToRemove: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));

    setProviders(prev => {
      const providerData = prev[provider] || {};

      // Get current deployments
      const deploymentNames = providerData.azureDeploymentNames || [];

      // Filter out the deployment to remove
      const filteredDeployments = deploymentNames.filter(name => name !== deploymentToRemove);

      return {
        ...prev,
        [provider]: {
          ...providerData,
          azureDeploymentNames: filteredDeployments,
        },
      };
    });
  };

  const handleAzureApiVersionChange = (provider: string, apiVersion: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        azureApiVersion: apiVersion.trim(),
      },
    }));
  };

  return (
    <section className="space-y-6">
      {/* LLM Providers Section */}
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-gray-50'} p-6 text-left shadow-sm`}>
        <h2 className={`mb-4 text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          {t('options_models_providers_header')}
        </h2>
        <div className="space-y-6">
          {getSortedProviders().length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              <p className="mb-4">{t('options_models_providers_notConfigured')}</p>
            </div>
          ) : (
            getSortedProviders().map(([providerId, providerConfig]) => {
              // Add type guard to satisfy TypeScript
              if (!providerConfig || !providerConfig.type) {
                console.warn(`Skipping rendering for providerId ${providerId} due to missing config or type`);
                return null; // Skip rendering this item if config/type is somehow missing
              }

              return (
                <div
                  key={providerId}
                  id={`provider-${providerId}`}
                  className={`space-y-4 ${modifiedProviders.has(providerId) && !providersFromStorage.has(providerId) ? `rounded-lg border p-4 ${isDarkMode ? 'border-blue-700 bg-slate-700' : 'border-blue-200 bg-blue-50/70'}` : ''}`}>
                  <div className="flex items-center justify-between">
                    <h3 className={`text-lg font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      {providerConfig.name || providerId}
                    </h3>
                    <div className="flex space-x-2">
                      {/* Show Cancel button for newly added providers */}
                      {modifiedProviders.has(providerId) && !providersFromStorage.has(providerId) && (
                        <Button variant="secondary" onClick={() => handleCancelProvider(providerId)}>
                          {t('options_models_providers_btnCancel')}
                        </Button>
                      )}
                      <Button
                        variant={getButtonProps(providerId).variant}
                        disabled={getButtonProps(providerId).disabled}
                        onClick={() =>
                          providersFromStorage.has(providerId) && !modifiedProviders.has(providerId)
                            ? handleDelete(providerId)
                            : handleSave(providerId)
                        }>
                        {getButtonProps(providerId).children}
                      </Button>
                    </div>
                  </div>

                  {/* Show message for newly added providers */}
                  {modifiedProviders.has(providerId) && !providersFromStorage.has(providerId) && (
                    <div className={`mb-2 text-sm ${isDarkMode ? 'text-teal-300' : 'text-teal-700'}`}>
                      <p>{t('options_models_providers_setupInstructions')}</p>
                    </div>
                  )}

                  <div className="space-y-3">
                    {/* Name input (only for custom_openai) - moved to top for prominence */}
                    {providerConfig.type === ProviderTypeEnum.CustomOpenAI && (
                      <div className="flex flex-col">
                        <div className="flex items-center">
                          <label
                            htmlFor={`${providerId}-name`}
                            className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            {t('options_models_providers_custom_name')}
                          </label>
                          <input
                            id={`${providerId}-name`}
                            type="text"
                            placeholder={t('options_models_providers_custom_name_placeholder')}
                            value={providerConfig.name || ''}
                            onChange={e => {
                              console.log('Name input changed:', e.target.value);
                              handleNameChange(providerId, e.target.value);
                            }}
                            className={`flex-1 rounded-md border p-2 text-sm ${
                              nameErrors[providerId]
                                ? isDarkMode
                                  ? 'border-red-700 bg-slate-700 text-gray-200 focus:border-red-600 focus:ring-2 focus:ring-red-900'
                                  : 'border-red-300 bg-gray-50 focus:border-red-400 focus:ring-2 focus:ring-red-200'
                                : isDarkMode
                                  ? 'border-blue-700 bg-slate-700 text-gray-200 focus:border-blue-600 focus:ring-2 focus:ring-blue-900'
                                  : 'border-blue-300 bg-gray-50 focus:border-blue-400 focus:ring-2 focus:ring-blue-200'
                            } outline-none`}
                          />
                        </div>
                        {nameErrors[providerId] ? (
                          <p className={`ml-20 mt-1 text-xs ${isDarkMode ? 'text-red-400' : 'text-red-500'}`}>
                            {nameErrors[providerId]}
                          </p>
                        ) : (
                          <p className={`ml-20 mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            {t('options_models_providers_custom_name_desc')}
                          </p>
                        )}
                      </div>
                    )}

                    {/* API Key input with label */}
                    <div className="flex items-center">
                      <label
                        htmlFor={`${providerId}-api-key`}
                        className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        {t('options_models_providers_apiKey')}
                        {/* Show asterisk only if required */}
                        {providerConfig.type !== ProviderTypeEnum.CustomOpenAI &&
                        providerConfig.type !== ProviderTypeEnum.Ollama
                          ? '*'
                          : ''}
                      </label>
                      <div className="relative flex-1">
                        <input
                          id={`${providerId}-api-key`}
                          type="password"
                          placeholder={
                            providerConfig.type === ProviderTypeEnum.CustomOpenAI
                              ? t('options_models_providers_apiKey_placeholder_optional')
                              : providerConfig.type === ProviderTypeEnum.Ollama
                                ? t('options_models_providers_apiKey_placeholder_ollama')
                                : t('options_models_providers_apiKey_placeholder_required')
                          }
                          value={providerConfig.apiKey || ''}
                          onChange={e => handleApiKeyChange(providerId, e.target.value, providerConfig.baseUrl)}
                          className={`w-full rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-800' : 'border-gray-300 bg-white text-gray-700 focus:border-blue-400 focus:ring-2 focus:ring-blue-200'} p-2 outline-none`}
                        />
                        {/* Show eye button only for newly added providers */}
                        {modifiedProviders.has(providerId) && !providersFromStorage.has(providerId) && (
                          <button
                            type="button"
                            className={`absolute right-2 top-1/2 -translate-y-1/2 ${
                              isDarkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700'
                            }`}
                            onClick={() => toggleApiKeyVisibility(providerId)}
                            aria-label={
                              visibleApiKeys[providerId]
                                ? t('options_models_providers_apiKey_hide')
                                : t('options_models_providers_apiKey_show')
                            }>
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="size-5"
                              aria-hidden="true">
                              <title>
                                {visibleApiKeys[providerId]
                                  ? t('options_models_providers_apiKey_hide')
                                  : t('options_models_providers_apiKey_show')}
                              </title>
                              {visibleApiKeys[providerId] ? (
                                <>
                                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                                  <circle cx="12" cy="12" r="3" />
                                  <line x1="2" y1="22" x2="22" y2="2" />
                                </>
                              ) : (
                                <>
                                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                                  <circle cx="12" cy="12" r="3" />
                                </>
                              )}
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Display API key for newly added providers only when visible */}
                    {modifiedProviders.has(providerId) &&
                      !providersFromStorage.has(providerId) &&
                      visibleApiKeys[providerId] &&
                      providerConfig.apiKey && (
                        <div className="ml-20 mt-1">
                          <p
                            className={`break-words font-mono text-sm ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
                            {providerConfig.apiKey}
                          </p>
                        </div>
                      )}

                    {/* Base URL input (for custom_openai, ollama, azure_openai, openrouter, and llama) */}
                    {(providerConfig.type === ProviderTypeEnum.CustomOpenAI ||
                      providerConfig.type === ProviderTypeEnum.Ollama ||
                      providerConfig.type === ProviderTypeEnum.AzureOpenAI ||
                      providerConfig.type === ProviderTypeEnum.OpenRouter ||
                      providerConfig.type === ProviderTypeEnum.Llama) && (
                      <div className="flex flex-col">
                        <div className="flex items-center">
                          <label
                            htmlFor={`${providerId}-base-url`}
                            className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            {/* Adjust Label based on provider */}
                            {providerConfig.type === ProviderTypeEnum.AzureOpenAI
                              ? t('options_models_providers_endpoint')
                              : t('options_models_providers_baseUrl')}
                            {/* Show asterisk only if required */}
                            {/* OpenRouter has a default, so not strictly required, but needed for save button */}
                            {providerConfig.type === ProviderTypeEnum.CustomOpenAI ||
                            providerConfig.type === ProviderTypeEnum.AzureOpenAI
                              ? '*'
                              : ''}
                          </label>
                          <input
                            id={`${providerId}-base-url`}
                            type="text"
                            placeholder={
                              providerConfig.type === ProviderTypeEnum.CustomOpenAI
                                ? t('options_models_providers_placeholders_baseUrl_custom')
                                : providerConfig.type === ProviderTypeEnum.AzureOpenAI
                                  ? t('options_models_providers_placeholders_baseUrl_azure')
                                  : providerConfig.type === ProviderTypeEnum.OpenRouter
                                    ? t('options_models_providers_placeholders_baseUrl_openrouter')
                                    : providerConfig.type === ProviderTypeEnum.Llama
                                      ? t('options_models_providers_placeholders_baseUrl_llama')
                                      : t('options_models_providers_placeholders_baseUrl_ollama')
                            }
                            value={providerConfig.baseUrl || ''}
                            onChange={e => handleApiKeyChange(providerId, providerConfig.apiKey || '', e.target.value)}
                            className={`flex-1 rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-800' : 'border-gray-300 bg-white text-gray-700 focus:border-blue-400 focus:ring-2 focus:ring-blue-200'} p-2 outline-none`}
                          />
                        </div>
                      </div>
                    )}

                    {/* Azure Deployment Name input as tags/chips like OpenRouter models */}
                    {(providerConfig.type as ProviderTypeEnum) === ProviderTypeEnum.AzureOpenAI && (
                      <div className="flex items-start">
                        <label
                          htmlFor={`${providerId}-azure-deployment`}
                          className={`w-20 pt-2 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          {t('options_models_providers_deployment')}*
                        </label>
                        <div className="flex-1 space-y-2">
                          <div
                            className={`flex min-h-[42px] flex-wrap items-center gap-2 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} p-2`}>
                            {/* Show azure deployments */}
                            {(providerConfig.azureDeploymentNames || []).length > 0
                              ? (providerConfig.azureDeploymentNames || []).map((deploymentName: string) => (
                                  <div
                                    key={deploymentName}
                                    className={`flex items-center rounded-full ${isDarkMode ? 'bg-blue-900 text-blue-100' : 'bg-blue-100 text-blue-800'} px-2 py-1 text-sm`}>
                                    <span>{deploymentName}</span>
                                    <button
                                      type="button"
                                      onClick={() => removeAzureDeployment(providerId, deploymentName)}
                                      className={`ml-1 font-bold ${isDarkMode ? 'text-blue-300 hover:text-blue-100' : 'text-blue-600 hover:text-blue-800'}`}
                                      aria-label={`Remove ${deploymentName}`}>
                                      ×
                                    </button>
                                  </div>
                                ))
                              : null}
                            <input
                              id={`${providerId}-azure-deployment-input`}
                              type="text"
                              placeholder={t('options_models_providers_placeholders_azureDeployment')}
                              value={newModelInputs[providerId] || ''}
                              onChange={e => handleModelsChange(providerId, e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  const value = newModelInputs[providerId] || '';
                                  if (value.trim()) {
                                    addAzureDeployment(providerId, value.trim());
                                    // Clear the input
                                    setNewModelInputs(prev => ({
                                      ...prev,
                                      [providerId]: '',
                                    }));
                                  }
                                }
                              }}
                              className={`min-w-[150px] flex-1 border-none text-sm ${isDarkMode ? 'bg-transparent text-gray-200' : 'bg-transparent text-gray-700'} p-1 outline-none`}
                            />
                          </div>
                          <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            {t('options_models_providers_deployment_desc')}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* NEW: Azure API Version input */}
                    {(providerConfig.type as ProviderTypeEnum) === ProviderTypeEnum.AzureOpenAI && (
                      <div className="flex items-center">
                        <label
                          htmlFor={`${providerId}-azure-version`}
                          className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          {t('options_models_providers_apiVersion')}*
                        </label>
                        <input
                          id={`${providerId}-azure-version`}
                          type="text"
                          placeholder={t('options_models_providers_placeholders_azureApiVersion')}
                          value={providerConfig.azureApiVersion || ''}
                          onChange={e => handleAzureApiVersionChange(providerId, e.target.value)}
                          className={`flex-1 rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-800' : 'border-gray-300 bg-white text-gray-700 focus:border-blue-400 focus:ring-2 focus:ring-blue-200'} p-2 outline-none`}
                        />
                      </div>
                    )}

                    {/* Models input section (for non-Azure providers) */}
                    {(providerConfig.type as ProviderTypeEnum) !== ProviderTypeEnum.AzureOpenAI && (
                      <div className="flex items-start">
                        <label
                          htmlFor={`${providerId}-models-label`}
                          className={`w-20 pt-2 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          {t('options_models_providers_models')}
                        </label>
                        <div className="flex-1 space-y-2">
                          {/* Conditional UI for OpenRouter */}
                          {(providerConfig.type as ProviderTypeEnum) === ProviderTypeEnum.OpenRouter ? (
                            <>
                              <div
                                className={`flex min-h-[42px] flex-wrap items-center gap-2 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} p-2`}>
                                {providerConfig.modelNames && providerConfig.modelNames.length > 0 ? (
                                  providerConfig.modelNames.map(model => (
                                    <div
                                      key={model}
                                      className={`flex items-center rounded-full ${isDarkMode ? 'bg-blue-900 text-blue-100' : 'bg-blue-100 text-blue-800'} px-2 py-1 text-sm`}>
                                      <span>{model}</span>
                                      <button
                                        type="button"
                                        onClick={() => removeModel(providerId, model)}
                                        className={`ml-1 font-bold ${isDarkMode ? 'text-blue-300 hover:text-blue-100' : 'text-blue-600 hover:text-blue-800'}`}
                                        aria-label={`Remove ${model}`}>
                                        ×
                                      </button>
                                    </div>
                                  ))
                                ) : (
                                  <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                    {t('options_models_providers_models_openrouter_empty')}
                                  </span>
                                )}
                                <input
                                  id={`${providerId}-models-input`}
                                  type="text"
                                  placeholder=""
                                  value={newModelInputs[providerId] || ''}
                                  onChange={e => handleModelsChange(providerId, e.target.value)}
                                  onKeyDown={e => handleKeyDown(e, providerId)}
                                  className={`min-w-[150px] flex-1 border-none text-sm ${isDarkMode ? 'bg-transparent text-gray-200' : 'bg-transparent text-gray-700'} p-1 outline-none`}
                                />
                              </div>
                              <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                {t('options_models_providers_models_instructions')}
                              </p>
                            </>
                          ) : (
                            /* Default Tag Input for other providers */
                            <>
                              <div
                                className={`flex min-h-[42px] flex-wrap items-center gap-2 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} p-2`}>
                                {(() => {
                                  const models =
                                    providerConfig.modelNames !== undefined
                                      ? providerConfig.modelNames
                                      : llmProviderModelNames[providerId as keyof typeof llmProviderModelNames] || [];
                                  return models.map(model => (
                                    <div
                                      key={model}
                                      className={`flex items-center rounded-full ${isDarkMode ? 'bg-blue-900 text-blue-100' : 'bg-blue-100 text-blue-800'} px-2 py-1 text-sm`}>
                                      <span>{model}</span>
                                      <button
                                        type="button"
                                        onClick={() => removeModel(providerId, model)}
                                        className={`ml-1 font-bold ${isDarkMode ? 'text-blue-300 hover:text-blue-100' : 'text-blue-600 hover:text-blue-800'}`}
                                        aria-label={`Remove ${model}`}>
                                        ×
                                      </button>
                                    </div>
                                  ));
                                })()}
                                <input
                                  id={`${providerId}-models-input`}
                                  type="text"
                                  placeholder=""
                                  value={newModelInputs[providerId] || ''}
                                  onChange={e => handleModelsChange(providerId, e.target.value)}
                                  onKeyDown={e => handleKeyDown(e, providerId)}
                                  className={`min-w-[150px] flex-1 border-none text-sm ${isDarkMode ? 'bg-transparent text-gray-200' : 'bg-transparent text-gray-700'} p-1 outline-none`}
                                />
                              </div>
                              <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                {t('options_models_providers_models_instructions')}
                              </p>
                            </>
                          )}
                          {/* === END: Conditional UI === */}
                        </div>
                      </div>
                    )}

                    {/* Ollama reminder at the bottom of the section */}
                    {providerConfig.type === ProviderTypeEnum.Ollama && (
                      <div
                        className={`mt-4 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700' : 'border-blue-100 bg-blue-50'} p-3`}>
                        <p className={`text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                          <strong>
                            {' '}
                            <code
                              className={`rounded italic ${isDarkMode ? 'bg-slate-600 px-1 py-0.5' : 'bg-blue-100 px-1 py-0.5'}`}>
                              OLLAMA_ORIGINS=chrome-extension://*
                            </code>{' '}
                          </strong>
                          {t('options_models_providers_ollama_reminder')}
                          <a
                            href="https://github.com/ollama/ollama/blob/main/docs/faq.md#how-can-i-allow-additional-web-origins-to-access-ollama"
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`ml-1 ${isDarkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-800'}`}>
                            {t('options_models_providers_ollama_learnMore')}
                          </a>
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Add divider except for the last item */}
                  {Object.keys(providers).indexOf(providerId) < Object.keys(providers).length - 1 && (
                    <div className={`mt-4 border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`} />
                  )}
                </div>
              );
            })
          )}

          {/* Add Provider button and dropdown */}
          <div className="provider-selector-container relative pt-4">
            <Button
              variant="secondary"
              onClick={() => setIsProviderSelectorOpen(prev => !prev)}
              className={`flex w-full items-center justify-center font-medium ${
                isDarkMode
                  ? 'border-blue-700 bg-blue-600 text-white hover:bg-blue-500'
                  : 'border-blue-200 bg-blue-100 text-blue-800 hover:bg-blue-200'
              }`}>
              <span className="mr-2 text-sm">+</span>{' '}
              <span className="text-sm">{t('options_models_addNewProvider')}</span>
            </Button>

            {isProviderSelectorOpen && (
              <div
                className={`absolute z-10 mt-2 w-full overflow-hidden rounded-md border ${
                  isDarkMode
                    ? 'border-blue-600 bg-slate-700 shadow-lg shadow-slate-900/50'
                    : 'border-blue-200 bg-white shadow-xl shadow-blue-100/50'
                }`}>
                <div className="py-1">
                  {/* Map through provider types to create buttons */}
                  {Object.values(ProviderTypeEnum)
                    // Allow Azure to appear multiple times, but filter out other already added providers
                    .filter(
                      type =>
                        type === ProviderTypeEnum.AzureOpenAI || // Always show Azure
                        (type !== ProviderTypeEnum.CustomOpenAI &&
                          !providersFromStorage.has(type) &&
                          !modifiedProviders.has(type)),
                    )
                    .map(type => (
                      <button
                        key={type}
                        type="button"
                        className={`flex w-full items-center px-4 py-3 text-left text-sm ${
                          isDarkMode
                            ? 'text-blue-200 hover:bg-blue-600/30 hover:text-white'
                            : 'text-blue-700 hover:bg-blue-100 hover:text-blue-800'
                        } transition-colors duration-150`}
                        onClick={() => handleProviderSelection(type)}>
                        <span className="font-medium">{getDefaultDisplayNameFromProviderId(type)}</span>
                      </button>
                    ))}

                  {/* Custom provider button (always shown) */}
                  <button
                    type="button"
                    className={`flex w-full items-center px-4 py-3 text-left text-sm ${
                      isDarkMode
                        ? 'text-blue-200 hover:bg-blue-600/30 hover:text-white'
                        : 'text-blue-700 hover:bg-blue-100 hover:text-blue-800'
                    } transition-colors duration-150`}
                    onClick={() => handleProviderSelection(ProviderTypeEnum.CustomOpenAI)}>
                    <span className="font-medium">{t('options_models_providers_openaiCompatible')}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Updated Agent Models Section */}
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-gray-50'} p-6 text-left shadow-sm`}>
        <h2 className={`mb-4 text-left text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          {t('options_models_selection_header')}
        </h2>
        <div className="space-y-4">
          {[AgentNameEnum.Planner, AgentNameEnum.Navigator].map(agentName => (
            <div key={agentName}>{renderModelSelect(agentName)}</div>
          ))}
        </div>
      </div>

      {/* Speech-to-Text Model Selection */}
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-gray-50'} p-6 text-left shadow-sm`}>
        <h2 className={`mb-4 text-left text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          {t('options_models_speechToText_header')}
        </h2>
        <p className={`mb-4 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          {t('options_models_stt_desc')}
        </p>

        <div
          className={`rounded-lg border ${isDarkMode ? 'border-gray-700 bg-slate-800' : 'border-gray-200 bg-gray-50'} p-4`}>
          <div className="flex items-center">
            <label
              htmlFor="speech-to-text-model"
              className={`w-24 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {t('options_models_labels_model')}
            </label>
            <select
              id="speech-to-text-model"
              className={`flex-1 rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
              value={selectedSpeechToTextModel}
              onChange={e => handleSpeechToTextModelChange(e.target.value)}>
              <option value="">{t('options_models_chooseModel')}</option>
              {/* Filter available models to show only Gemini models */}
              {availableModels
                .filter(({ provider }) => {
                  const providerConfig = providers[provider];
                  return providerConfig?.type === ProviderTypeEnum.Gemini;
                })
                .map(({ provider, providerName, model }) => (
                  <option key={`${provider}>${model}`} value={`${provider}>${model}`}>
                    {`${providerName} > ${model}`}
                  </option>
                ))}
            </select>
          </div>
        </div>
      </div>
    </section>
  );
};
