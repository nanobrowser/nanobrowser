import { useMcpHost } from '@extension/shared';
import React, { useCallback, useState } from 'react';

interface McpIconProps {
  className?: string;
}

export const McpIcon: React.FC<McpIconProps> = ({ className = '' }) => {
  const { status, loading, startMcpHost, stopMcpHost } = useMcpHost();
  const [showTooltip, setShowTooltip] = useState(false);

  const handleClick = useCallback(async () => {
    if (loading) return;

    if (status.isConnected) {
      await stopMcpHost();
    } else {
      await startMcpHost({ runMode: 'stdio' });
    }
  }, [status.isConnected, loading, startMcpHost, stopMcpHost]);

  const getIconColor = () => {
    if (loading) return 'text-yellow-500 animate-pulse'; // Yellow pulse animation when loading
    return status.isConnected ? 'text-green-500' : 'text-gray-400'; // Green when connected, gray when disconnected
  };

  const getTooltipText = () => {
    if (loading) {
      return status.isConnected ? 'Stopping MCP Host...' : 'Starting MCP Host...';
    }
    return status.isConnected ? 'MCP Host Connected - Click to stop' : 'MCP Host Disconnected - Click to start';
  };

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        disabled={loading}
        className={`p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200 ${
          loading ? 'cursor-not-allowed' : 'cursor-pointer'
        } ${className}`}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        title={getTooltipText()}
        aria-label={getTooltipText()}>
        {/* MCP Icon - Simple geometric shapes representing protocol connection */}
        <svg
          className={`w-5 h-5 transition-colors duration-200 ${getIconColor()}`}
          fill="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg">
          {/* Three connected circles representing MCP connectivity */}
          <circle cx="6" cy="12" r="2.5" opacity="0.8" />
          <circle cx="12" cy="6" r="2.5" opacity="0.6" />
          <circle cx="18" cy="12" r="2.5" opacity="0.8" />

          {/* Connection lines */}
          <line x1="8.2" y1="10.2" x2="10.2" y2="8.2" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
          <line x1="13.8" y1="8.2" x2="15.8" y2="10.2" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
        </svg>
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute bottom-full right-0 mb-2 px-3 py-2 text-xs bg-gray-900 dark:bg-gray-700 text-white rounded-md whitespace-nowrap z-50 shadow-lg">
          {getTooltipText()}
          {/* Small arrow */}
          <div className="absolute top-full right-4 border-4 border-transparent border-t-gray-900 dark:border-t-gray-700"></div>
        </div>
      )}
    </div>
  );
};
