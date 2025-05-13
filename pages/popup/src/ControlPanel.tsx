import React from 'react';
import { McpHostOptions } from '@src/types';

interface ControlPanelProps {
  isConnected: boolean;
  onStartHost: (options: McpHostOptions) => Promise<boolean>;
  onStopHost?: () => Promise<boolean>;
  loading: boolean;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({ isConnected, onStartHost, onStopHost, loading }) => {
  const handleStartClick = async () => {
    // Use default parameters
    const options: McpHostOptions = {
      runMode: 'stdio',
      logLevel: 'info',
    };

    await onStartHost(options);
  };

  const handleStopClick = async () => {
    if (onStopHost) {
      await onStopHost();
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm mt-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">MCP Host Control</h2>

      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Manage the MCP Host process to enable advanced browser functionality
        </p>

        <div className="flex justify-center space-x-2 mt-6">
          {!isConnected && (
            <button
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleStartClick}
              disabled={loading}>
              {loading ? (
                <span className="flex items-center">
                  <svg
                    className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Starting...
                </span>
              ) : (
                'Start MCP Host'
              )}
            </button>
          )}

          {isConnected && onStopHost && (
            <button
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleStopClick}
              disabled={loading}>
              {loading ? (
                <span className="flex items-center">
                  <svg
                    className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Stopping...
                </span>
              ) : (
                'Stop MCP Host'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
