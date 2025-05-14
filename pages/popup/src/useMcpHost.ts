import { useEffect, useState } from 'react';
import { McpHostOptions, McpHostStatus, McpServerConfig, McpServerStatus } from '@src/types';

/**
 * Custom hook to interact with MCP Host
 */
export function useMcpHost() {
  const [status, setStatus] = useState<McpHostStatus>({
    isConnected: false,
    startTime: null,
    lastHeartbeat: null,
    version: null,
    runMode: null,
  });
  const [serverStatus, setServerStatus] = useState<McpServerStatus>({
    isRunning: false,
    config: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch MCP Host status
  const refreshStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'getMcpHostStatus' });
      if (response && response.status) {
        setStatus(response.status);
      } else {
        setError('Failed to get MCP Host status');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  // Start MCP Host
  const startMcpHost = async (options: McpHostOptions) => {
    setLoading(true);
    setError(null);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'startMcpHost',
        options,
      });
      if (response && response.success) {
        // Wait a bit for the host to start and refresh status
        setTimeout(() => {
          refreshStatus();
        }, 1000);
        return true;
      } else {
        setError('Failed to start MCP Host');
        setLoading(false);
        return false;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
      return false;
    }
  };

  // Stop MCP Host
  const stopMcpHost = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'stopMcpHost',
      });
      if (response && response.success) {
        // Wait a bit for the host to stop and refresh status
        setTimeout(() => {
          refreshStatus();
        }, 1000);
        return true;
      } else {
        setError('Failed to stop MCP Host');
        setLoading(false);
        return false;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
      return false;
    }
  };

  // Fetch MCP Server status
  const refreshMcpServerStatus = async () => {
    if (!status.isConnected) {
      setServerStatus({
        isRunning: false,
        config: null,
      });
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({ type: 'getMcpServerStatus' });
      if (response && response.status) {
        setServerStatus(response.status);
      }
    } catch (err) {
      console.error('Failed to get MCP server status:', err);
    }
  };

  // Start MCP Server
  const startMcpServer = async (config: McpServerConfig) => {
    if (!status.isConnected) {
      setError('Cannot start MCP server: host not connected');
      return false;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'startMcpServer',
        config,
      });
      if (response && response.success) {
        // Wait a bit for the server to start and refresh status
        setTimeout(() => {
          refreshMcpServerStatus();
        }, 1000);
        return true;
      } else {
        setError('Failed to start MCP server');
        setLoading(false);
        return false;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
      return false;
    }
  };

  // Stop MCP Server
  const stopMcpServer = async () => {
    if (!status.isConnected) {
      setError('Cannot stop MCP server: host not connected');
      return false;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'stopMcpServer',
      });
      if (response && response.success) {
        // Wait a bit for the server to stop and refresh status
        setTimeout(() => {
          refreshMcpServerStatus();
        }, 1000);
        return true;
      } else {
        setError('Failed to stop MCP server');
        setLoading(false);
        return false;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
      return false;
    }
  };

  // Load initial status
  useEffect(() => {
    refreshStatus();
    refreshMcpServerStatus();

    // Set up a refresh interval
    const intervalId = setInterval(() => {
      refreshStatus();
      refreshMcpServerStatus();
    }, 5000);

    // Clean up on component unmount
    return () => {
      clearInterval(intervalId);
    };
  }, []);

  return {
    status,
    serverStatus,
    loading,
    error,
    refreshStatus,
    startMcpHost,
    stopMcpHost,
    refreshMcpServerStatus,
    startMcpServer,
    stopMcpServer,
  };
}
