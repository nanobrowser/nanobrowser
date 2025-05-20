import { useEffect, useState } from 'react';

/**
 * MCP Host Status interface
 */
export interface McpHostStatus {
  isConnected: boolean;
  startTime: number | null;
  lastHeartbeat: number | null;
  version: string | null;
  runMode: string | null;
}

/**
 * MCP Host Configuration options
 */
export interface McpHostOptions {
  runMode: string;
  port?: number;
  logLevel?: string;
}

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
        // Extract detailed error from response if available
        const errorMessage = response && response.error ? response.error : 'Failed to start MCP Host';

        console.error('Start MCP Host failed:', errorMessage);
        setError(errorMessage);
        setLoading(false);
        return false;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('Exception in startMcpHost:', errorMessage);
      setError(errorMessage);
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

  // Load initial status
  useEffect(() => {
    refreshStatus();

    // Set up a refresh interval
    const intervalId = setInterval(() => {
      refreshStatus();
    }, 5000);

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
    stopMcpHost,
  };
}
