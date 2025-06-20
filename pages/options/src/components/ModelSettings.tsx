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
  amplifyConfigStore,
  instanceIdStore,
  AgentNameEnum,
  llmProviderModelNames,
  ProviderTypeEnum,
  getDefaultDisplayNameFromProviderId,
  getDefaultProviderConfig,
  getDefaultAgentModelParams,
  type ProviderConfig,
  type SpeechToTextModelConfig,
  type AmplifyEventsConfig,
} from '@extension/storage';

// Helper function to check if a model is an O-series model
function isOpenAIOModel(modelName: string): boolean {
  if (modelName.startsWith('openai/')) {
    return modelName.startsWith('openai/o');
  }
  return modelName.startsWith('o');
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
    [AgentNameEnum.Validator]: '',
  });
  const [modelParameters, setModelParameters] = useState<Record<AgentNameEnum, { temperature: number; topP: number }>>({
    [AgentNameEnum.Navigator]: { temperature: 0, topP: 0 },
    [AgentNameEnum.Planner]: { temperature: 0, topP: 0 },
    [AgentNameEnum.Validator]: { temperature: 0, topP: 0 },
  });

  // State for reasoning effort for O-series models
  const [reasoningEffort, setReasoningEffort] = useState<Record<AgentNameEnum, 'low' | 'medium' | 'high' | undefined>>({
    [AgentNameEnum.Navigator]: undefined,
    [AgentNameEnum.Planner]: undefined,
    [AgentNameEnum.Validator]: undefined,
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

  // Amplify Events configuration state
  const [amplifyConfig, setAmplifyConfig] = useState<AmplifyEventsConfig>({
    enabled: false,
    endpoint: '',
    region: 'us-east-1',
    defaultAuthMode: 'apiKey',
    apiKey: '',
    channelNamespace: 'default',
  });
  const [instanceId, setInstanceId] = useState<string>('');
  const [isAmplifyConfigModified, setIsAmplifyConfigModified] = useState<boolean>(false);

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
          [AgentNameEnum.Validator]: '',
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
                [agent]: config.reasoningEffort as 'low' | 'medium' | 'high',
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

  // Load Amplify Events configuration
  useEffect(() => {
    const loadAmplifyConfig = async () => {
      try {
        const config = await amplifyConfigStore.getConfig();
        setAmplifyConfig(config);

        // Use the new await method to wait for the ID from the background script
        const instId = await instanceIdStore.awaitInstanceId();
        setInstanceId(instId);
      } catch (error) {
        console.error('Error loading Amplify configuration:', error);
      }
    };

    loadAmplifyConfig();

    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === 'local' && changes['instance-id']) {
        const newConfig = changes['instance-id'].newValue;
        if (newConfig && newConfig.instanceId) {
          setInstanceId(newConfig.instanceId);
        }
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
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
        children: 'Delete',
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
    } else if (providerType === ProviderTypeEnum.Bedrock) {
      hasInput =
        Boolean(config?.awsAccessKeyId?.trim()) &&
        Boolean(config?.awsSecretAccessKey?.trim()) &&
        Boolean(config?.awsRegion?.trim());
    } else if (providerType === ProviderTypeEnum.OpenRouter) {
      // OpenRouter needs API Key and optionally Base URL (has default)
      hasInput = Boolean(config?.apiKey?.trim()) && Boolean(config?.baseUrl?.trim());
    } else {
      // Other built-in providers just need API Key
      hasInput = Boolean(config?.apiKey?.trim());
    }

    return {
      theme: isDarkMode ? 'dark' : 'light',
      variant: 'primary' as const,
      children: 'Save',
      disabled: !hasInput || !isModified,
    };
  };

  const handleSave = async (provider: string) => {
    try {
      // Check if name contains spaces for custom providers
      if (providers[provider].type === ProviderTypeEnum.CustomOpenAI && providers[provider].name?.includes(' ')) {
        setNameErrors(prev => ({
          ...prev,
          [provider]: 'Spaces are not allowed in provider names. Please use underscores or other characters instead.',
        }));
        return;
      }

      // Check if base URL is required but missing for custom_openai, ollama, azure_openai or openrouter
      // Note: Groq and Cerebras do not require base URL as they use the default endpoint
      if (
        (providers[provider].type === ProviderTypeEnum.CustomOpenAI ||
          providers[provider].type === ProviderTypeEnum.Ollama ||
          providers[provider].type === ProviderTypeEnum.AzureOpenAI ||
          providers[provider].type === ProviderTypeEnum.OpenRouter) &&
        (!providers[provider].baseUrl || !providers[provider].baseUrl.trim())
      ) {
        alert(`Base URL is required for ${getDefaultDisplayNameFromProviderId(provider)}. Please enter it.`);
        return;
      }

      if (providers[provider].type === ProviderTypeEnum.Bedrock) {
        if (
          !providers[provider].awsAccessKeyId?.trim() ||
          !providers[provider].awsSecretAccessKey?.trim() ||
          !providers[provider].awsRegion?.trim()
        ) {
          alert(`AWS credentials and region are required for ${getDefaultDisplayNameFromProviderId(provider)}.`);
          return;
        }
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
        configToSave.modelNames =
          providers[provider].modelNames || llmProviderModelNames[provider as keyof typeof llmProviderModelNames] || [];
      }

      if (providers[provider].type === ProviderTypeEnum.Bedrock) {
        configToSave.awsAccessKeyId = providers[provider].awsAccessKeyId || '';
        configToSave.awsSecretAccessKey = providers[provider].awsSecretAccessKey || '';
        configToSave.awsSessionToken = providers[provider].awsSessionToken || '';
        configToSave.awsRegion = providers[provider].awsRegion || 'us-east-1';
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
        if (isOpenAIOModel(model)) {
          // Keep existing reasoning effort if already set for O-series models
          setReasoningEffort(prev => ({
            ...prev,
            [agentName]: prev[agentName] || 'medium', // Default to medium if not set
          }));
        } else {
          // Clear reasoning effort for non-O-series models
          setReasoningEffort(prev => ({
            ...prev,
            [agentName]: undefined,
          }));
        }

        await agentModelStore.setAgentModel(agentName, {
          provider,
          modelName: model,
          parameters: newParameters,
          reasoningEffort: isOpenAIOModel(model) ? reasoningEffort[agentName] || 'medium' : undefined,
        });
      } else {
        // Reset storage if no model is selected
        await agentModelStore.resetAgentModel(agentName);
      }
    } catch (error) {
      console.error('Error saving agent model:', error);
    }
  };

  const handleReasoningEffortChange = async (agentName: AgentNameEnum, value: 'low' | 'medium' | 'high') => {
    setReasoningEffort(prev => ({
      ...prev,
      [agentName]: value,
    }));

    // Only update if we have a selected model
    if (selectedModels[agentName] && isOpenAIOModel(selectedModels[agentName])) {
      try {
        // Find provider
        const provider = getProviderForModel(selectedModels[agentName]);

        if (provider) {
          await agentModelStore.setAgentModel(agentName, {
            provider,
            modelName: selectedModels[agentName],
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
        // Find provider
        let provider: string | undefined;
        for (const [providerKey, providerConfig] of Object.entries(providers)) {
          if (providerConfig.type === ProviderTypeEnum.AzureOpenAI) {
            // Check Azure deployment names
            const deploymentNames = providerConfig.azureDeploymentNames || [];
            if (deploymentNames.includes(selectedModels[agentName])) {
              provider = providerKey;
              break;
            }
          } else {
            // Check standard model names for non-Azure providers
            const modelNames =
              providerConfig.modelNames ||
              llmProviderModelNames[providerKey as keyof typeof llmProviderModelNames] ||
              [];
            if (modelNames.includes(selectedModels[agentName])) {
              provider = providerKey;
              break;
            }
          }
        }

        if (provider) {
          await agentModelStore.setAgentModel(agentName, {
            provider,
            modelName: selectedModels[agentName],
            parameters: newParameters,
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
            Model
          </label>
          <select
            id={`${agentName}-model`}
            className={`flex-1 rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
            disabled={availableModels.length === 0}
            value={selectedModels[agentName] || ''} // Use the stored provider>model value directly
            onChange={e => handleModelChange(agentName, e.target.value)}>
            <option key="default" value="">
              Choose model
            </option>
            {availableModels.map(({ provider, providerName, model }) => (
              <option key={`${provider}>${model}`} value={`${provider}>${model}`}>
                {`${providerName} > ${model}`}
              </option>
            ))}
          </select>
        </div>

        {/* Temperature Slider */}
        <div className="flex items-center">
          <label
            htmlFor={`${agentName}-temperature`}
            className={`w-24 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            Temperature
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

        {/* Top P Slider */}
        <div className="flex items-center">
          <label
            htmlFor={`${agentName}-topP`}
            className={`w-24 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            Top P
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

        {/* Reasoning Effort Selector (only for O-series models) */}
        {selectedModels[agentName] && isOpenAIOModel(selectedModels[agentName]) && (
          <div className="flex items-center">
            <label
              htmlFor={`${agentName}-reasoning-effort`}
              className={`w-24 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Reasoning
            </label>
            <div className="flex flex-1 items-center space-x-2">
              <select
                id={`${agentName}-reasoning-effort`}
                value={reasoningEffort[agentName] || 'medium'}
                onChange={e => handleReasoningEffortChange(agentName, e.target.value as 'low' | 'medium' | 'high')}
                className={`flex-1 rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}>
                <option value="low">Low (Faster)</option>
                <option value="medium">Medium (Balanced)</option>
                <option value="high">High (More thorough)</option>
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
        return 'Navigates websites and performs actions';
      case AgentNameEnum.Planner:
        return 'Develops and refines strategies to complete tasks';
      case AgentNameEnum.Validator:
        return 'Checks if tasks are completed successfully';
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

  const getProviderForModel = (modelName: string): string => {
    for (const [provider, config] of Object.entries(providers)) {
      // Check Azure deployment names
      if (config.type === ProviderTypeEnum.AzureOpenAI) {
        const deploymentNames = config.azureDeploymentNames || [];
        if (deploymentNames.includes(modelName)) {
          return provider;
        }
      } else {
        // Check regular model names for non-Azure providers
        const modelNames =
          config.modelNames || llmProviderModelNames[provider as keyof typeof llmProviderModelNames] || [];
        if (modelNames.includes(modelName)) {
          return provider;
        }
      }
    }
    return '';
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

  const handleBedrockFieldChange = (
    provider: string,
    field: 'awsAccessKeyId' | 'awsSecretAccessKey' | 'awsSessionToken' | 'awsRegion',
    value: string,
  ) => {
    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        [field]: value.trim(),
      },
    }));
  };

  // Amplify Events configuration handlers
  const handleAmplifyFieldChange = (field: keyof AmplifyEventsConfig, value: string | boolean) => {
    setIsAmplifyConfigModified(true);
    setAmplifyConfig(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleAmplifyConfigSave = async () => {
    try {
      await amplifyConfigStore.updateConfig(amplifyConfig);
      setIsAmplifyConfigModified(false);
      alert('Amplify Events configuration saved successfully!');
    } catch (error) {
      console.error('Failed to save Amplify configuration:', error);
      alert('Failed to save Amplify configuration. Please check your settings.');
    }
  };

  const handleAmplifyConfigTest = async () => {
    try {
      const isValid = await amplifyConfigStore.validateConfig();
      if (isValid) {
        alert('Amplify Events configuration is valid!');
      } else {
        alert('Amplify Events configuration is invalid. Please check all required fields.');
      }
    } catch (error) {
      console.error('Failed to test Amplify configuration:', error);
      alert('Failed to test Amplify configuration.');
    }
  };

  const handleAmplifyConfigReset = async () => {
    try {
      await amplifyConfigStore.resetToDefaults();
      const config = await amplifyConfigStore.getConfig();
      setAmplifyConfig(config);
      setIsAmplifyConfigModified(false);
      alert('Amplify Events configuration reset to defaults.');
    } catch (error) {
      console.error('Failed to reset Amplify configuration:', error);
      alert('Failed to reset Amplify configuration.');
    }
  };

  return (
    <section className="space-y-6">
      {/* LLM Providers Section */}
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-gray-50'} p-6 text-left shadow-sm`}>
        <h2 className={`mb-4 text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          LLM Providers
        </h2>
        <div className="space-y-6">
          {getSortedProviders().length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              <p className="mb-4">No providers configured yet. Add a provider to get started.</p>
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
                          Cancel
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
                      <p>This provider is newly added. Enter your API key and click Save to configure it.</p>
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
                            Name
                          </label>
                          <input
                            id={`${providerId}-name`}
                            type="text"
                            placeholder="Provider name"
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
                            Provider name (spaces are not allowed when saving)
                          </p>
                        )}
                      </div>
                    )}

                    {/* API Key input with label */}
                    {providerConfig.type !== ProviderTypeEnum.Bedrock && (
                      <div className="flex items-center">
                        <label
                          htmlFor={`${providerId}-api-key`}
                          className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          API Key
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
                                ? `${providerConfig.name || providerId} API key (optional)`
                                : providerConfig.type === ProviderTypeEnum.Ollama
                                  ? 'API Key (leave empty for Ollama)'
                                  : `${providerConfig.name || providerId} API key (required)`
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
                              aria-label={visibleApiKeys[providerId] ? 'Hide API key' : 'Show API key'}>
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
                                <title>{visibleApiKeys[providerId] ? 'Hide API key' : 'Show API key'}</title>
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
                    )}

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

                    {/* Base URL input (for custom_openai, ollama, azure_openai, and openrouter) */}
                    {(providerConfig.type === ProviderTypeEnum.CustomOpenAI ||
                      providerConfig.type === ProviderTypeEnum.Ollama ||
                      providerConfig.type === ProviderTypeEnum.AzureOpenAI ||
                      providerConfig.type === ProviderTypeEnum.OpenRouter) && (
                      <div className="flex flex-col">
                        <div className="flex items-center">
                          <label
                            htmlFor={`${providerId}-base-url`}
                            className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            {/* Adjust Label based on provider */}
                            {providerConfig.type === ProviderTypeEnum.AzureOpenAI ? 'Endpoint' : 'Base URL'}
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
                                ? 'Required OpenAI-compatible API endpoint'
                                : providerConfig.type === ProviderTypeEnum.AzureOpenAI
                                  ? // Updated Azure placeholder
                                    'https://YOUR_RESOURCE_NAME.openai.azure.com/'
                                  : providerConfig.type === ProviderTypeEnum.OpenRouter
                                    ? 'OpenRouter Base URL (optional, defaults to https://openrouter.ai/api/v1)'
                                    : 'Ollama base URL'
                            }
                            value={providerConfig.baseUrl || ''}
                            onChange={e => handleApiKeyChange(providerId, providerConfig.apiKey || '', e.target.value)}
                            className={`flex-1 rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-800' : 'border-gray-300 bg-white text-gray-700 focus:border-blue-400 focus:ring-2 focus:ring-blue-200'} p-2 outline-none`}
                          />
                        </div>
                      </div>
                    )}

                    {/* Bedrock credentials */}
                    {providerConfig.type === ProviderTypeEnum.Bedrock && (
                      <div className="space-y-2">
                        <div className="flex items-center">
                          <label
                            htmlFor={`${providerId}-aws-access-key`}
                            className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            Access Key*
                          </label>
                          <input
                            id={`${providerId}-aws-access-key`}
                            type="text"
                            placeholder="AWS Access Key ID"
                            value={providerConfig.awsAccessKeyId || ''}
                            onChange={e => handleBedrockFieldChange(providerId, 'awsAccessKeyId', e.target.value)}
                            className={`flex-1 rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} p-2 outline-none`}
                          />
                        </div>
                        <div className="flex items-center">
                          <label
                            htmlFor={`${providerId}-aws-secret-key`}
                            className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            Secret Key*
                          </label>
                          <input
                            id={`${providerId}-aws-secret-key`}
                            type="password"
                            placeholder="AWS Secret Access Key"
                            value={providerConfig.awsSecretAccessKey || ''}
                            onChange={e => handleBedrockFieldChange(providerId, 'awsSecretAccessKey', e.target.value)}
                            className={`flex-1 rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} p-2 outline-none`}
                          />
                        </div>
                        <div className="flex items-center">
                          <label
                            htmlFor={`${providerId}-aws-session-token`}
                            className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            Session
                          </label>
                          <input
                            id={`${providerId}-aws-session-token`}
                            type="text"
                            placeholder="AWS Session Token (optional)"
                            value={providerConfig.awsSessionToken || ''}
                            onChange={e => handleBedrockFieldChange(providerId, 'awsSessionToken', e.target.value)}
                            className={`flex-1 rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} p-2 outline-none`}
                          />
                        </div>
                        <div className="flex items-center">
                          <label
                            htmlFor={`${providerId}-aws-region`}
                            className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            Region*
                          </label>
                          <input
                            id={`${providerId}-aws-region`}
                            type="text"
                            placeholder="us-east-1"
                            value={providerConfig.awsRegion || ''}
                            onChange={e => handleBedrockFieldChange(providerId, 'awsRegion', e.target.value)}
                            className={`flex-1 rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} p-2 outline-none`}
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
                          Deployment*
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
                              placeholder="Enter Azure model name (e.g. gpt-4o, gpt-4o-mini)"
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
                            Type model name and press Enter or Space to set. Deployment name should match OpenAI model
                            name (e.g., gpt-4o) for best compatibility.
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
                          API Version*
                        </label>
                        <input
                          id={`${providerId}-azure-version`}
                          type="text"
                          placeholder="e.g., 2024-02-15-preview" // Common example
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
                          Models
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
                                    No models selected. Add model names manually if needed.
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
                                Type and Press Enter or Space to add.
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
                                Type and Press Enter or Space to add.
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
                          <strong>Remember:</strong> Add{' '}
                          <code
                            className={`rounded italic ${isDarkMode ? 'bg-slate-600 px-1 py-0.5' : 'bg-blue-100 px-1 py-0.5'}`}>
                            OLLAMA_ORIGINS=chrome-extension://*
                          </code>{' '}
                          environment variable for the Ollama server.
                          <a
                            href="https://github.com/ollama/ollama/issues/6489"
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`ml-1 ${isDarkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-800'}`}>
                            Learn more
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
              <span className="mr-2 text-sm">+</span> <span className="text-sm">Add New Provider</span>
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
                    <span className="font-medium">OpenAI-compatible API Provider</span>
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
          Model Selection
        </h2>
        <div className="space-y-4">
          {[AgentNameEnum.Planner, AgentNameEnum.Navigator, AgentNameEnum.Validator].map(agentName => (
            <div key={agentName}>{renderModelSelect(agentName)}</div>
          ))}
        </div>
      </div>

      {/* Speech-to-Text Model Selection */}
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-gray-50'} p-6 text-left shadow-sm`}>
        <h2 className={`mb-4 text-left text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          Speech-to-Text Model
        </h2>
        <p className={`mb-4 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          Configure the Gemini model used for converting speech to text when using the microphone feature.
        </p>

        <div
          className={`rounded-lg border ${isDarkMode ? 'border-gray-700 bg-slate-800' : 'border-gray-200 bg-gray-50'} p-4`}>
          <div className="flex items-center">
            <label
              htmlFor="speech-to-text-model"
              className={`w-24 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Model
            </label>
            <select
              id="speech-to-text-model"
              className={`flex-1 rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
              value={selectedSpeechToTextModel}
              onChange={e => handleSpeechToTextModelChange(e.target.value)}>
              <option value="">Choose Model</option>
              {/* Filter available models to show only Gemini models */}
              {availableModels
                .filter(({ provider, model }) => {
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

      {/* Amplify Events Configuration Section */}
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-gray-50'} p-6 text-left shadow-sm`}>
        <h2 className={`mb-4 text-left text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          AWS AppSync Events
        </h2>
        <p className={`mb-4 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          Configure real-time communication with AWS AppSync Events API. This enables remote control of the extension
          via AppSync.
        </p>

        {/* Instance ID Display */}
        <div
          className={`mb-4 rounded-lg border ${isDarkMode ? 'border-gray-700 bg-slate-800' : 'border-gray-200 bg-gray-50'} p-4`}>
          <div className="flex items-center">
            <label className={`w-24 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Instance ID
            </label>
            <input
              type="text"
              value={instanceId}
              readOnly
              className={`flex-1 rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-gray-100 text-gray-700'} px-3 py-2 cursor-not-allowed`}
              placeholder="Loading..."
            />
          </div>
          <p className={`mt-2 text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
            Unique identifier for this extension instance (read-only)
          </p>
        </div>

        {/* Enable/Disable Toggle */}
        <div
          className={`mb-4 rounded-lg border ${isDarkMode ? 'border-gray-700 bg-slate-800' : 'border-gray-200 bg-gray-50'} p-4`}>
          <div className="flex items-center">
            <label className={`w-24 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Enabled
            </label>
            <input
              type="checkbox"
              checked={amplifyConfig.enabled}
              onChange={e => handleAmplifyFieldChange('enabled', e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Configuration Fields */}
        {amplifyConfig.enabled && (
          <div className="space-y-4">
            {/* Endpoint */}
            <div
              className={`rounded-lg border ${isDarkMode ? 'border-gray-700 bg-slate-800' : 'border-gray-200 bg-gray-50'} p-4`}>
              <div className="flex items-center">
                <label className={`w-24 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Endpoint*
                </label>
                <input
                  type="text"
                  value={amplifyConfig.endpoint}
                  onChange={e => handleAmplifyFieldChange('endpoint', e.target.value)}
                  placeholder="https://xxxxx.appsync-api.us-east-1.amazonaws.com/event"
                  className={`flex-1 rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
                />
              </div>
            </div>

            {/* Region */}
            <div
              className={`rounded-lg border ${isDarkMode ? 'border-gray-700 bg-slate-800' : 'border-gray-200 bg-gray-50'} p-4`}>
              <div className="flex items-center">
                <label className={`w-24 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Region*
                </label>
                <input
                  type="text"
                  value={amplifyConfig.region}
                  onChange={e => handleAmplifyFieldChange('region', e.target.value)}
                  placeholder="us-east-1"
                  className={`flex-1 rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
                />
              </div>
            </div>

            {/* API Key */}
            <div
              className={`rounded-lg border ${isDarkMode ? 'border-gray-700 bg-slate-800' : 'border-gray-200 bg-gray-50'} p-4`}>
              <div className="flex items-center">
                <label className={`w-24 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  API Key*
                </label>
                <input
                  type="password"
                  value={amplifyConfig.apiKey}
                  onChange={e => handleAmplifyFieldChange('apiKey', e.target.value)}
                  placeholder="da2-xxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className={`flex-1 rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
                />
              </div>
            </div>

            {/* Channel Namespace */}
            <div
              className={`rounded-lg border ${isDarkMode ? 'border-gray-700 bg-slate-800' : 'border-gray-200 bg-gray-50'} p-4`}>
              <div className="flex items-center">
                <label className={`w-24 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Namespace
                </label>
                <input
                  type="text"
                  value={amplifyConfig.channelNamespace}
                  onChange={e => handleAmplifyFieldChange('channelNamespace', e.target.value)}
                  placeholder="default"
                  className={`flex-1 rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
                />
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-6 flex gap-3">
          <Button
            onClick={handleAmplifyConfigSave}
            disabled={!isAmplifyConfigModified}
            className={`px-4 py-2 text-sm font-medium rounded-md ${
              isAmplifyConfigModified
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}>
            Save Configuration
          </Button>

          <Button
            onClick={handleAmplifyConfigTest}
            disabled={!amplifyConfig.enabled}
            className={`px-4 py-2 text-sm font-medium rounded-md ${
              amplifyConfig.enabled
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}>
            Test Connection
          </Button>

          <Button
            onClick={handleAmplifyConfigReset}
            className="px-4 py-2 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700">
            Reset to Defaults
          </Button>
        </div>

        {/* Help Text */}
        <div className={`mt-4 text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
          <p>
            <strong>Note:</strong> The AppSync Events endpoint should be in the format:
            https://xxxxx.appsync-api.region.amazonaws.com/event
          </p>
          <p className="mt-1">
            Channel subscription will be created at: /{amplifyConfig.channelNamespace}/{instanceId}
          </p>
        </div>
      </div>
    </section>
  );
};
