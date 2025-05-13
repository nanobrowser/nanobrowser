import React, { useState } from 'react';
import { McpHostOptions } from '@src/types';

interface ControlPanelProps {
  isConnected: boolean;
  onStartHost: (options: McpHostOptions) => Promise<boolean>;
  loading: boolean;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({ isConnected, onStartHost, loading }) => {
  const [runMode, setRunMode] = useState<string>('stdio');
  const [port, setPort] = useState<string>('');
  const [logLevel, setLogLevel] = useState<string>('info');

  const handleStartClick = async () => {
    const options: McpHostOptions = {
      runMode,
      logLevel,
    };

    // Add port if specified and it's a valid number
    if (port && !isNaN(Number(port))) {
      options.port = Number(port);
    }

    await onStartHost(options);
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm mt-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">MCP Host Control</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Run Mode</label>
          <select
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            value={runMode}
            onChange={e => setRunMode(e.target.value)}
            disabled={isConnected || loading}>
            <option value="stdio">Standard IO</option>
            <option value="http">HTTP</option>
          </select>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            How the MCP Host should communicate with the extension
          </p>
        </div>

        {runMode === 'http' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Port</label>
            <input
              type="number"
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              value={port}
              onChange={e => setPort(e.target.value)}
              placeholder="8000"
              disabled={isConnected || loading}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Port for HTTP server (default: 8000)</p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Log Level</label>
          <select
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            value={logLevel}
            onChange={e => setLogLevel(e.target.value)}
            disabled={isConnected || loading}>
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
          </select>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Verbosity of log messages</p>
        </div>

        <div className="flex justify-end">
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleStartClick}
            disabled={isConnected || loading}>
            {loading ? (
              <span className="flex items-center">
                <svg
                  className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Starting...
              </span>
            ) : isConnected ? (
              'Connected'
            ) : (
              'Start MCP Host'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
