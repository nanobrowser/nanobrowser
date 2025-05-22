import React from 'react';
import { McpHostStatus } from '@src/types';

interface StatusDisplayProps {
  status: McpHostStatus;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export const StatusDisplay: React.FC<StatusDisplayProps> = ({ status, loading, error, onRefresh }) => {
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
    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">MCP Host Status</h2>
        <button
          className="p-2 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          onClick={onRefresh}
          disabled={loading}>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4" role="alert">
          <p>{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center items-center p-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
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

          <div className="flex items-center">
            <span className="flex-1 text-gray-600 dark:text-gray-300">Run Mode:</span>
            <span className="font-medium text-gray-900 dark:text-white">{status.runMode || 'N/A'}</span>
          </div>

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
