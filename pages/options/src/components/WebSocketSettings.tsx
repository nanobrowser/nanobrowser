import { useState, useEffect } from 'react';
import { type WebSocketConfig, websocketStore, DEFAULT_WEBSOCKET_SETTINGS } from '@extension/storage';
import { FiCheck, FiX, FiAlertCircle, FiWifi } from 'react-icons/fi';

interface WebSocketSettingsProps {
  isDarkMode?: boolean;
}

export const WebSocketSettings = ({ isDarkMode = false }: WebSocketSettingsProps) => {
  const [settings, setSettings] = useState<WebSocketConfig>(DEFAULT_WEBSOCKET_SETTINGS);
  const [urlError, setUrlError] = useState<string>('');
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [testMessage, setTestMessage] = useState<string>('');

  useEffect(() => {
    // Load initial settings
    websocketStore.getSettings().then(setSettings);
  }, []);

  const validateUrl = (url: string): boolean => {
    if (!url.trim()) {
      setUrlError('Server URL is required');
      return false;
    }

    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      setUrlError('URL must start with ws:// or wss://');
      return false;
    }

    // Validate URL format using regex
    const urlPattern = /^wss?:\/\/([^:/\s]+):?(\d+)?(\/.*)?$/;
    if (!urlPattern.test(url)) {
      setUrlError('Invalid URL format');
      return false;
    }

    // Validate port if present
    const match = url.match(urlPattern);
    if (match && match[2]) {
      const port = parseInt(match[2], 10);
      if (port < 1 || port > 65535) {
        setUrlError('Port must be between 1 and 65535');
        return false;
      }
    }

    setUrlError('');
    return true;
  };

  const updateSetting = async <K extends keyof WebSocketConfig>(key: K, value: WebSocketConfig[K]) => {
    // Validate URL before updating
    if (key === 'serverUrl' && typeof value === 'string') {
      if (!validateUrl(value)) {
        // Still update local state to show the error
        setSettings(prevSettings => ({ ...prevSettings, [key]: value }));
        return;
      }
    }

    // Optimistically update the local state for responsiveness
    setSettings(prevSettings => ({ ...prevSettings, [key]: value }));

    try {
      // Call the store to update the setting
      await websocketStore.updateSettings({ [key]: value } as Partial<WebSocketConfig>);

      // Fetch the latest settings from the store to ensure UI consistency
      const latestSettings = await websocketStore.getSettings();
      setSettings(latestSettings);
    } catch (error) {
      console.error('Failed to update WebSocket setting:', error);
      // Revert to previous settings on error
      const latestSettings = await websocketStore.getSettings();
      setSettings(latestSettings);
    }
  };

  const testConnection = async () => {
    if (!validateUrl(settings.serverUrl)) {
      return;
    }

    setTestingConnection(true);
    setTestResult(null);
    setTestMessage('');

    try {
      // Create a test WebSocket connection
      const ws = new WebSocket(settings.serverUrl);

      const timeout = setTimeout(() => {
        ws.close();
        setTestingConnection(false);
        setTestResult('error');
        setTestMessage('Connection timeout');
      }, settings.connectionTimeout);

      ws.onopen = () => {
        clearTimeout(timeout);
        ws.close();
        setTestingConnection(false);
        setTestResult('success');
        setTestMessage('Connection successful');
        // Clear result after 3 seconds
        setTimeout(() => {
          setTestResult(null);
          setTestMessage('');
        }, 3000);
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        setTestingConnection(false);
        setTestResult('error');
        setTestMessage('Connection failed');
        // Clear result after 3 seconds
        setTimeout(() => {
          setTestResult(null);
          setTestMessage('');
        }, 3000);
      };
    } catch (error) {
      setTestingConnection(false);
      setTestResult('error');
      setTestMessage(error instanceof Error ? error.message : 'Connection failed');
      // Clear result after 3 seconds
      setTimeout(() => {
        setTestResult(null);
        setTestMessage('');
      }, 3000);
    }
  };

  return (
    <section className="space-y-6">
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-white'} p-6 text-left shadow-sm`}>
        <div className="mb-4 flex items-center space-x-2">
          <FiWifi className={`size-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`} />
          <h2 className={`text-left text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
            WebSocket Settings
          </h2>
        </div>

        <p className={`mb-6 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          Configure WebSocket connection for external control and task delegation. When enabled, the extension can
          receive and execute tasks from a WebSocket server.
        </p>

        <div className="space-y-4">
          {/* Enable WebSocket Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Enable WebSocket
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Allow external control via WebSocket connection
              </p>
            </div>
            <div className="relative inline-flex cursor-pointer items-center">
              <input
                id="enabled"
                type="checkbox"
                checked={settings.enabled}
                onChange={e => updateSetting('enabled', e.target.checked)}
                className="peer sr-only"
              />
              <label
                htmlFor="enabled"
                className={`peer h-6 w-11 rounded-full ${isDarkMode ? 'bg-slate-600' : 'bg-gray-200'} after:absolute after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300`}>
                <span className="sr-only">Enable WebSocket</span>
              </label>
            </div>
          </div>

          {/* Server URL Input */}
          <div className="space-y-2">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Server URL
                </h3>
                <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  WebSocket server address (ws:// or wss://)
                </p>
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor="serverUrl" className="sr-only">
                Server URL
              </label>
              <input
                id="serverUrl"
                type="text"
                value={settings.serverUrl}
                onChange={e => updateSetting('serverUrl', e.target.value)}
                onBlur={() => validateUrl(settings.serverUrl)}
                placeholder="ws://localhost:8080"
                className={`w-full rounded-md border ${
                  urlError
                    ? 'border-red-500 focus:ring-red-500'
                    : isDarkMode
                      ? 'border-slate-600 bg-slate-700 text-gray-200'
                      : 'border-gray-300 bg-white text-gray-700'
                } px-3 py-2 focus:outline-none focus:ring-2 ${!urlError && 'focus:ring-blue-500'}`}
              />
              {urlError && (
                <div className="flex items-center space-x-1 text-sm text-red-500">
                  <FiAlertCircle className="size-4" />
                  <span>{urlError}</span>
                </div>
              )}
            </div>
          </div>

          {/* Connection Timeout Input */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Connection Timeout
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Timeout for connection attempts (1000-30000ms)
              </p>
            </div>
            <label htmlFor="connectionTimeout" className="sr-only">
              Connection Timeout
            </label>
            <input
              id="connectionTimeout"
              type="number"
              min={1000}
              max={30000}
              step={1000}
              value={settings.connectionTimeout}
              onChange={e => updateSetting('connectionTimeout', Number.parseInt(e.target.value, 10))}
              className={`w-24 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
            />
          </div>

          {/* Test Connection Button */}
          <div className="border-t pt-4 ${isDarkMode ? 'border-slate-700' : 'border-gray-200'}">
            <div className="flex items-center justify-between">
              <div>
                <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Test Connection
                </h3>
                <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Verify WebSocket server connectivity
                </p>
              </div>
              <div className="flex items-center space-x-3">
                {testResult && (
                  <div
                    className={`flex items-center space-x-1 text-sm ${testResult === 'success' ? 'text-green-500' : 'text-red-500'}`}>
                    {testResult === 'success' ? <FiCheck className="size-4" /> : <FiX className="size-4" />}
                    <span>{testMessage}</span>
                  </div>
                )}
                <button
                  onClick={testConnection}
                  disabled={testingConnection || !!urlError || !settings.serverUrl}
                  className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                    testingConnection || !!urlError || !settings.serverUrl
                      ? 'cursor-not-allowed bg-gray-400 text-gray-200'
                      : isDarkMode
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-blue-500 text-white hover:bg-blue-600'
                  }`}>
                  {testingConnection ? 'Testing...' : 'Test Connection'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Connection Status Info */}
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-white'} p-6 shadow-sm`}>
        <h3 className={`mb-2 text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          Connection Status
        </h3>
        <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          {settings.enabled ? (
            <>
              WebSocket is <span className="font-semibold text-blue-500">enabled</span>. The extension will attempt to
              connect to <span className="font-mono text-sm">{settings.serverUrl}</span> when the background service
              starts.
            </>
          ) : (
            <>
              WebSocket is <span className="font-semibold text-gray-500">disabled</span>. Enable it to allow external
              control.
            </>
          )}
        </p>
      </div>

      {/* Security Warning */}
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-yellow-800 bg-yellow-900/20' : 'border-yellow-200 bg-yellow-50'} p-6 shadow-sm`}>
        <div className="flex items-start space-x-3">
          <FiAlertCircle className={`mt-0.5 size-5 shrink-0 ${isDarkMode ? 'text-yellow-400' : 'text-yellow-600'}`} />
          <div>
            <h3 className={`mb-2 text-base font-semibold ${isDarkMode ? 'text-yellow-400' : 'text-yellow-800'}`}>
              Security Notice
            </h3>
            <p className={`text-sm ${isDarkMode ? 'text-yellow-300' : 'text-yellow-700'}`}>
              Only connect to trusted WebSocket servers. Malicious servers could potentially execute unauthorized
              actions in your browser. Always use secure connections (wss://) when possible, especially over public
              networks.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
