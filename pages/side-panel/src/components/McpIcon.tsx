import { useMcpHost } from '@extension/shared';
import React, { useCallback } from 'react';

// Custom animation styles for MCP states
const mcpAnimationStyles = `
  @keyframes mcp-heartbeat {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.05); }
  }
  
  @keyframes mcp-warning-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
  
  .mcp-heartbeat {
    animation: mcp-heartbeat 3s ease-in-out infinite;
  }
  
  .mcp-warning-pulse {
    animation: mcp-warning-pulse 2s ease-in-out infinite;
  }
`;

// Inject styles if not already present
if (typeof document !== 'undefined' && !document.getElementById('mcp-animations')) {
  const style = document.createElement('style');
  style.id = 'mcp-animations';
  style.textContent = mcpAnimationStyles;
  document.head.appendChild(style);
}

interface McpIconProps {
  className?: string;
}

export const McpIcon: React.FC<McpIconProps> = ({ className = '' }) => {
  const { status, loading, error, startMcpHost, stopMcpHost, refreshStatus } = useMcpHost();

  const handleClick = useCallback(async () => {
    if (loading) return;

    // Immediately trigger a status refresh for faster visual feedback
    refreshStatus();

    if (status.isConnected) {
      await stopMcpHost();
    } else {
      await startMcpHost({ runMode: 'stdio' });
    }

    // Trigger another refresh after the operation
    setTimeout(() => refreshStatus(), 100);
  }, [status.isConnected, loading, startMcpHost, stopMcpHost, refreshStatus]);

  // Calculate connection health based on heartbeat
  const getConnectionHealth = () => {
    if (!status.isConnected || !status.lastHeartbeat) return 'disconnected';

    const now = Date.now();
    const timeSinceHeartbeat = now - status.lastHeartbeat;

    if (timeSinceHeartbeat > 30000) return 'warning'; // 30 seconds
    if (timeSinceHeartbeat > 60000) return 'error'; // 1 minute
    return 'healthy';
  };

  // Get visual state for styling
  const getVisualState = () => {
    if (loading) return 'connecting';
    if (error) return 'error';
    if (!status.isConnected) return 'disconnected';

    const health = getConnectionHealth();
    return health;
  };

  const getIconColor = () => {
    const visualState = getVisualState();

    switch (visualState) {
      case 'connecting':
        return 'animate-pulse text-yellow-500';
      case 'healthy':
        return 'text-green-500 mcp-heartbeat';
      case 'warning':
        return 'text-orange-500 mcp-warning-pulse';
      case 'error':
        return 'text-red-500';
      case 'disconnected':
      default:
        return 'text-gray-400';
    }
  };

  // Get connection line styles based on state
  const getConnectionStyles = () => {
    const visualState = getVisualState();

    switch (visualState) {
      case 'connecting':
        return {
          strokeDasharray: '4 4',
          className: 'animate-pulse',
        };
      case 'healthy':
        return {
          strokeDasharray: 'none',
          className: '',
        };
      case 'warning':
        return {
          strokeDasharray: '2 2',
          className: 'animate-pulse',
        };
      case 'error':
        return {
          strokeDasharray: '6 2',
          className: '',
        };
      case 'disconnected':
      default:
        return {
          strokeDasharray: '8 4',
          className: 'opacity-50',
        };
    }
  };

  // Get detailed status text for tooltip
  const getDetailedStatus = () => {
    const visualState = getVisualState();

    if (loading) {
      return status.isConnected ? 'Stopping MCP Host...' : 'Starting MCP Host...';
    }

    switch (visualState) {
      case 'healthy': {
        const uptime = status.startTime ? Math.floor((Date.now() - status.startTime) / 1000) : 0;
        const lastHeartbeat = status.lastHeartbeat ? Math.floor((Date.now() - status.lastHeartbeat) / 1000) : 0;
        return `MCP Host Connected\nUptime: ${uptime}s\nLast heartbeat: ${lastHeartbeat}s ago\nMode: ${status.runMode || 'unknown'}`;
      }
      case 'warning': {
        const warningHeartbeat = status.lastHeartbeat ? Math.floor((Date.now() - status.lastHeartbeat) / 1000) : 0;
        return `MCP Host Warning\nHeartbeat delayed: ${warningHeartbeat}s ago\nMode: ${status.runMode || 'unknown'}`;
      }
      case 'error':
        return `MCP Host Error\n${error?.message || 'Connection failed'}\nClick to restart`;
      case 'disconnected':
      default:
        return 'MCP Host Disconnected\nClick to start connection';
    }
  };

  const getAriaLabel = () => {
    const visualState = getVisualState();

    if (loading) {
      return status.isConnected ? 'Stopping MCP Host...' : 'Starting MCP Host...';
    }

    switch (visualState) {
      case 'healthy':
        return 'MCP Host Connected and Healthy - Click to stop';
      case 'warning':
        return 'MCP Host Connected but Warning - Click to stop';
      case 'error':
        return 'MCP Host Connection Error - Click to restart';
      case 'disconnected':
      default:
        return 'MCP Host Disconnected - Click to start';
    }
  };

  const connectionStyles = getConnectionStyles();

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`rounded-md p-2 transition-colors duration-200 hover:bg-gray-100 dark:hover:bg-gray-700 ${
        loading ? 'cursor-not-allowed' : 'cursor-pointer'
      } ${className}`}
      aria-label={getAriaLabel()}
      title={getDetailedStatus()}>
      {/* MCP Icon - Protocol communication with bidirectional arrows */}
      <svg
        className={`size-5 transition-colors duration-200 ${getIconColor()}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg">
        {/* MCP Host - Central node */}
        <circle cx="12" cy="12" r="4" strokeWidth="2" />

        {/* Client nodes */}
        <circle cx="4" cy="7" r="2" />
        <circle cx="4" cy="17" r="2" />

        {/* Service node */}
        <circle cx="20" cy="12" r="2" />

        {/* Connection lines with dynamic styles */}
        <g className={connectionStyles.className}>
          {/* Upper client to host connection */}
          <line
            x1="6"
            y1="8.5"
            x2="8"
            y2="10.5"
            strokeDasharray={connectionStyles.strokeDasharray}
            strokeLinecap="round"
          />

          {/* Lower client to host connection */}
          <line
            x1="6"
            y1="15.5"
            x2="8"
            y2="13.5"
            strokeDasharray={connectionStyles.strokeDasharray}
            strokeLinecap="round"
          />

          {/* Host to service connection */}
          <line
            x1="16"
            y1="12"
            x2="18"
            y2="12"
            strokeDasharray={connectionStyles.strokeDasharray}
            strokeLinecap="round"
          />
        </g>

        {/* Bidirectional communication arrows */}
        {/* Upper client to host */}
        <path d="M6.5 8.5L7.5 9.5M7.5 9.5L6.5 10.5M7.5 9.5H9" strokeLinecap="round" />

        {/* Lower client to host */}
        <path d="M6.5 15.5L7.5 14.5M7.5 14.5L6.5 13.5M7.5 14.5H9" strokeLinecap="round" />

        {/* Host to service */}
        <path d="M15 11L16 12M16 12L15 13M16 12H18" strokeLinecap="round" />
      </svg>
    </button>
  );
};
