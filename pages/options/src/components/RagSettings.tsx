import React, { useEffect, useState } from 'react';
import { ragSettingsStore, type RagSettingsConfig } from '@extension/storage/lib/settings/ragSettings';

export const RagSettings: React.FC = () => {
  const [settings, setSettings] = useState<RagSettingsConfig | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const s = await ragSettingsStore.getSettings();
        setSettings(s);
      } catch (e) {
        console.error('Failed to load RAG settings', e);
      }
    };
    load();
    const unsub = ragSettingsStore.subscribe(load);
    return () => unsub();
  }, []);

  if (!settings) return <div>Loading...</div>;

  const update = async (patch: Partial<RagSettingsConfig>) => {
    try {
      await ragSettingsStore.updateSettings(patch);
      setSettings({ ...settings, ...patch });
    } catch (e) {
      console.error('Failed to update RAG settings', e);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold">RAG settings</h2>
      <div className="mt-4 space-y-4">
        <label className="block">
          <span>Enabled</span>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={e => update({ enabled: e.target.checked })}
            className="ml-2"
          />
        </label>

        <label className="block">
          <span>Endpoint</span>
          <input
            value={settings.endpoint}
            onChange={e => update({ endpoint: e.target.value })}
            className="mt-1 block w-full rounded border p-2"
            placeholder="https://example.com/rag"
          />
        </label>

        <label className="block">
          <span>API Key</span>
          <input
            value={settings.apiKey || ''}
            onChange={e => update({ apiKey: e.target.value })}
            className="mt-1 block w-full rounded border p-2"
            placeholder="API Key (optional)"
          />
        </label>

        <label className="block">
          <span>API Key Header Name</span>
          <input
            value={settings.apiKeyHeaderName || ''}
            onChange={e => update({ apiKeyHeaderName: e.target.value })}
            className="mt-1 block w-full rounded border p-2"
            placeholder="Authorization"
          />
        </label>

        <label className="block">
          <span>Query Param Name</span>
          <input
            value={settings.queryParamName || ''}
            onChange={e => update({ queryParamName: e.target.value })}
            className="mt-1 block w-full rounded border p-2"
            placeholder="q"
          />
        </label>

        <label className="block">
          <span>Method</span>
          <select
            value={settings.method}
            onChange={e => update({ method: e.target.value as 'GET' | 'POST' })}
            className="mt-1 block rounded border p-2">
            <option value="POST">POST</option>
            <option value="GET">GET</option>
          </select>
        </label>
      </div>
    </div>
  );
};

export default RagSettings;
