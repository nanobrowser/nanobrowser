import { useEffect, useState } from 'react';
import { McpHostOptions, McpHostStatus } from '@src/types';

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

  // Load initial status
  useEffect(() => {
    refreshStatus();

    // Set up a refresh interval
    const intervalId = setInterval(refreshStatus, 5000);

    // Clean up on component unmount
    return () => {
      clearInterval(intervalId);
    };
  }, []);

  return {
    status,
    loading,
    error,
    refreshStatus,
    startMcpHost,
  };
}
