import { ragSettingsStore } from '@extension/storage/lib/settings/ragSettings';
import { createLogger } from '@src/background/log';

const logger = createLogger('RagService');

export async function fetchRagAugmentation(userInput: string): Promise<string | null> {
  try {
    const settings = await ragSettingsStore.getSettings();
    if (!settings.enabled) return null;
    if (!settings.endpoint || settings.endpoint.trim() === '') return null;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...settings.additionalHeaders,
    };

    if (settings.apiKey && settings.apiKeyHeaderName) {
      headers[settings.apiKeyHeaderName] = settings.apiKey;
    }

    const payload: Record<string, unknown> = {};
    // If queryParamName is provided and method is GET, we'll append it to URL
    if (settings.method === 'GET') {
      // Build URL with query param
      const url = new URL(settings.endpoint);
      if (settings.queryParamName) url.searchParams.set(settings.queryParamName, userInput);
      const resp = await fetch(url.toString(), { method: 'GET', headers });
      if (!resp.ok) throw new Error(`RAG request failed: ${resp.status} ${resp.statusText}`);
      const text = await resp.text();
      return text;
    }

    // For POST, send a JSON body with either query param name or 'query' key
    const bodyKey = settings.queryParamName || 'query';
    payload[bodyKey] = userInput;

    const resp = await fetch(settings.endpoint, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (!resp.ok) throw new Error(`RAG request failed: ${resp.status} ${resp.statusText}`);

    // Try to parse JSON or return text
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const json = await resp.json();
      // If the response has a 'text' or 'result' field, prefer that
      if (typeof json === 'string') return json;
      if (json.text) return String(json.text);
      if (json.result) return String(json.result);
      // fallback to stringify
      return JSON.stringify(json);
    }

    const text = await resp.text();
    return text;
  } catch (error) {
    logger.error('RAG fetch failed', error);
    return null;
  }
}
