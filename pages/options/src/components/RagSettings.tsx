import React, { useEffect, useState } from 'react';
import { ragSettingsStore, type RAGSettingsConfig } from '@extension/storage/lib/settings/ragSettings';
import { Button } from '@extension/ui';
import { t } from '@extension/i18n';

// untyped translator wrapper for new keys not present in generated types
const tr = (key: string) => (t as unknown as (k: string) => string)(key);

const DEFAULT_RAG: RAGSettingsConfig = {
  enabled: false,
  endpoint: '',
  apiKey: '',
  apiKeyHeaderName: 'Authorization',
  queryParamName: 'query',
  method: 'POST',
};

export const RagSettings = ({ isDarkMode = false }: { isDarkMode?: boolean }) => {
  const [settings, setSettings] = useState<RAGSettingsConfig>(DEFAULT_RAG);
  const [loading, setLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string>('');

  useEffect(() => {
    const load = async () => {
      try {
        const s = await ragSettingsStore.getSettings();
        setSettings({ ...DEFAULT_RAG, ...s });
      } catch (error) {
        console.error('Failed to load RAG settings:', error);
      }
    };
    void load();

    const unsub = ragSettingsStore.subscribe(load);
    return () => {
      try {
        unsub();
      } catch (e) {
        console.warn('unsubscribe ragSettingsStore failed', e);
      }
    };
  }, []);

  const handleSave = async () => {
    setLoading(true);
    setSaveMessage('');
    try {
      await ragSettingsStore.updateSettings(settings);
      setSaveMessage('✅ RAG settings saved successfully');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      console.error('Failed to save RAG settings:', error);
      setSaveMessage('❌ Failed to save settings');
      setTimeout(() => setSaveMessage(''), 3000);
    } finally {
      setLoading(false);
    }
  };

  const updateSetting = (key: keyof RAGSettingsConfig, value: string | boolean) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const containerClass = `rounded-lg border p-6 ${
    isDarkMode ? 'border-slate-700 bg-slate-800 text-gray-100' : 'border-gray-200 bg-gray-50 text-gray-900'
  }`;

  const inputClass = `mt-1 block w-full rounded-md border px-3 py-2 text-sm ${
    isDarkMode
      ? 'border-slate-600 bg-slate-700 text-gray-100 placeholder-gray-400 focus:border-blue-400 focus:ring-blue-400'
      : 'border-gray-300 bg-white text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:ring-blue-500'
  } focus:outline-none focus:ring-1`;

  const selectClass = `mt-1 block w-full rounded-md border px-3 py-2 text-sm ${
    isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-100' : 'border-gray-300 bg-white text-gray-900'
  } focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500`;

  return (
    <section className="space-y-6">
      <div className={containerClass}>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">
            {tr('options_rag_header') ?? 'RAG (Retrieval-Augmented Generation)'}
          </h2>
          {saveMessage && (
            <span className={`text-sm ${saveMessage.includes('✅') ? 'text-green-600' : 'text-red-600'}`}>
              {saveMessage}
            </span>
          )}
        </div>

        <div className="mt-6 space-y-6">
          {/* Enable RAG */}
          <div>
            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                checked={Boolean(settings.enabled)}
                onChange={e => updateSetting('enabled', e.target.checked)}
                className="size-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium">{tr('options_rag_enable') ?? 'Enable RAG'}</span>
            </label>
            <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Enable retrieval-augmented generation to enhance responses with external knowledge
            </p>
          </div>

          {/* RAG Endpoint */}
          <div>
            <label className="mb-1 block text-sm font-medium">{tr('options_rag_endpoint') ?? 'RAG Endpoint'}</label>
            <input
              type="url"
              value={settings.endpoint || ''}
              onChange={e => updateSetting('endpoint', e.target.value)}
              placeholder="https://your-rag-service.com/api/search"
              className={inputClass}
            />
            <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              The URL endpoint for your RAG service that will receive search queries
            </p>
          </div>

          {/* Query Parameter Name */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              {tr('options_rag_query_param') ?? 'Query Parameter Name'}
            </label>
            <input
              type="text"
              value={settings.queryParamName || 'query'}
              onChange={e => updateSetting('queryParamName', e.target.value)}
              placeholder="query"
              className={inputClass}
            />
            <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              The parameter name that will contain the user&apos;s search query in the request
            </p>
          </div>

          {/* API Key Header Name */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              {tr('options_rag_header_name') ?? 'API Key Header Name'}
            </label>
            <input
              type="text"
              value={settings.apiKeyHeaderName || 'Authorization'}
              onChange={e => updateSetting('apiKeyHeaderName', e.target.value)}
              placeholder="Authorization"
              className={inputClass}
            />
            <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              The HTTP header name for authentication (e.g., &quot;Authorization&quot;, &quot;X-API-Key&quot;)
            </p>
          </div>

          {/* API Token */}
          <div>
            <label className="mb-1 block text-sm font-medium">{tr('options_rag_api_key') ?? 'API Token'}</label>
            <input
              type="password"
              value={settings.apiKey || ''}
              onChange={e => updateSetting('apiKey', e.target.value)}
              placeholder="Bearer your-api-token-here"
              className={inputClass}
            />
            <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              API token for authenticating with your RAG service (include &quot;Bearer &quot; prefix if needed)
            </p>
          </div>

          {/* HTTP Method */}
          <div>
            <label className="mb-1 block text-sm font-medium">{tr('options_rag_method') ?? 'HTTP Method'}</label>
            <select
              value={settings.method || 'POST'}
              onChange={e => updateSetting('method', e.target.value as 'GET' | 'POST')}
              className={selectClass}
              title="Select HTTP method for RAG requests">
              <option value="GET">GET</option>
              <option value="POST">POST</option>
            </select>
            <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              HTTP method to use when making requests to your RAG endpoint
            </p>
          </div>

          {/* Custom System Message for RAG / Planner */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              {tr('options_rag_custom_system_message') ?? 'Custom System Message'}
            </label>
            <textarea
              value={(settings.customSystemMessage as string) || ''}
              onChange={e => updateSetting('customSystemMessage', e.target.value)}
              placeholder="An optional system-level message that will be included with planner prompts and used to influence RAG retrieval."
              className={`${inputClass} h-28 resize-y`}
            />
            <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              This message will be sent as a system message to the planner and included when performing RAG retrievals
              to bias the results.
            </p>
          </div>

          {/* Save Button */}
          <div className="flex justify-end pt-4">
            <Button
              onClick={handleSave}
              disabled={loading}
              className={`rounded-md px-6 py-2 text-sm font-medium transition-colors ${
                loading
                  ? 'cursor-not-allowed bg-gray-400'
                  : 'bg-blue-600 hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2'
              } text-white`}>
              {loading ? 'Saving...' : 'Save RAG Settings'}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default RagSettings;
