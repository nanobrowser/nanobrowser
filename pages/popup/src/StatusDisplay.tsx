import type { McpError, McpHostStatus } from '@src/types';
import React, { useEffect, useState } from 'react';

interface StatusDisplayProps {
  status: McpHostStatus;
  loading: boolean;
  error: McpError | null;
  onRefresh: () => void;
}

export const StatusDisplay: React.FC<StatusDisplayProps> = ({ status, loading, error, onRefresh }) => {
  // State to control error message visibility
  const [showError, setShowError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<McpError | null>(null);

  // Show error for a specified duration when it changes
  useEffect(() => {
    if (error) {
      setErrorMessage(error);
      setShowError(true);

      // Hide error after 8 seconds to give users more time to read
      const timer = setTimeout(() => {
        setShowError(false);
      }, 8000);

      return () => clearTimeout(timer);
    }

    return () => {};
  }, [error]);

  // Format timestamp to human-readable date
  const formatTimestamp = (timestamp: number | null) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleString();
  };

  // Calculate uptime if both startTime and lastHeartbeat are available
  const calculateUptime = () => {
    if (!status.startTime || !status.lastHeartbeat) return 'N/A';

    const uptime = status.lastHeartbeat - status.startTime;
    const seconds = Math.floor(uptime / 1000) % 60;
    const minutes = Math.floor(uptime / (1000 * 60)) % 60;
    const hours = Math.floor(uptime / (1000 * 60 * 60)) % 24;
    const days = Math.floor(uptime / (1000 * 60 * 60 * 24));

    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  };

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">MCP Host Status</h2>
        <button
          className="p-2 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          onClick={onRefresh}
          disabled={loading}>
          <svg xmlns="http://www.w3.org/2000/svg" className="size-5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Floating error message with backdrop */}
      {showError && errorMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          {/* Semi-transparent backdrop */}
          <div
            className="absolute inset-0 bg-black bg-opacity-30 backdrop-blur-sm"
            onClick={() => setShowError(false)}></div>

          {/* Error message container */}
          <div className="relative z-10 w-full max-w-md animate-fadeIn rounded-lg border-2 border-red-400 bg-red-100 px-5 py-4 text-red-700 shadow-lg">
            <div className="flex items-start justify-between">
              <p className="text-lg font-bold">{errorMessage.code}</p>
              <button
                onClick={() => setShowError(false)}
                className="ml-4 text-red-500 hover:text-red-700 focus:outline-none">
                <svg className="size-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"></path>
                </svg>
              </button>
            </div>
            <p className="mt-2">{errorMessage.message}</p>
            {errorMessage.details !== undefined && errorMessage.details !== null && (
              <div className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-red-50 p-2 text-xs">
                {typeof errorMessage.details === 'string'
                  ? errorMessage.details
                  : JSON.stringify(errorMessage.details, null, 2)}
              </div>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center p-4">
          <div className="size-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center">
            <span className="flex-1 text-gray-600 dark:text-gray-300">Connection Status:</span>
            <span className={`font-medium ${status.isConnected ? 'text-green-600' : 'text-red-600'}`}>
              {status.isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>

          <div className="flex items-center">
            <span className="flex-1 text-gray-600 dark:text-gray-300">Version:</span>
            <span className="font-medium text-gray-900 dark:text-white">{status.version || 'N/A'}</span>
          </div>

          {status.sseBaseURL && (
            <div className="flex items-center">
              <span className="flex-1 text-gray-600 dark:text-gray-300">SSE Endpoint:</span>
              <span
                className="max-w-48 truncate text-sm font-medium text-gray-900 dark:text-white"
                title={status.sseBaseURL}>
                {status.sseBaseURL}
              </span>
            </div>
          )}

          <div className="flex items-center">
            <span className="flex-1 text-gray-600 dark:text-gray-300">Start Time:</span>
            <span className="font-medium text-gray-900 dark:text-white">{formatTimestamp(status.startTime)}</span>
          </div>

          <div className="flex items-center">
            <span className="flex-1 text-gray-600 dark:text-gray-300">Last Heartbeat:</span>
            <span className="font-medium text-gray-900 dark:text-white">{formatTimestamp(status.lastHeartbeat)}</span>
          </div>

          <div className="flex items-center">
            <span className="flex-1 text-gray-600 dark:text-gray-300">Uptime:</span>
            <span className="font-medium text-gray-900 dark:text-white">{calculateUptime()}</span>
          </div>
        </div>
      )}
    </div>
  );
};
