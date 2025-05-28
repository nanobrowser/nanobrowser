import { useEffect, useState } from 'react';
import type { McpError } from '../errors/mcp-errors';
import { McpErrorCode } from '../errors/mcp-errors';

/**
 * MCP Host Status interface
 */
export interface McpHostStatus {
  isConnected: boolean;
  startTime: number | null;
  lastHeartbeat: number | null;
  version: string | null;
  uptime?: string;
  ssePort?: string;
  sseBaseURL?: string;
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
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<McpError | null>(null);

  // Fetch MCP Host status
  const refreshStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'getMcpHostStatus' });
      if (response && response.status) {
        setStatus(response.status);
      } else {
        setError({
          code: McpErrorCode.UNKNOWN,
          message: 'Failed to get MCP Host status',
        });
      }
    } catch (err) {
      setError({
        code: McpErrorCode.UNKNOWN,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
    }
  };

  // Start MCP Host
  const startMcpHost = async (options: McpHostOptions) => {
    setLoading(true);
    setError(null);

    try {
      // Send message to background script
      return new Promise<boolean>(resolve => {
        chrome.runtime.sendMessage({ type: 'startMcpHost', options }, response => {
          // Check if the connection succeeded
          if (response && response.success) {
            // Wait a bit for the host to start and refresh status
            setTimeout(() => {
              refreshStatus();
              setLoading(false);
            }, 1000);
            resolve(true);
          } else {
            // Check if the error is already a structured McpError
            if (response && response.error && typeof response.error === 'object' && 'code' in response.error) {
              // This is already a structured error from background
              console.error('Start MCP Host failed:', response.error);
              setError(response.error as McpError);
            } else {
              // Create a structured error from the string error
              const errorMessage =
                response && response.error
                  ? typeof response.error === 'string'
                    ? response.error
                    : 'Failed to start MCP Host'
                  : 'Failed to start MCP Host';

              // Create the appropriate error type
              let mcpError: McpError;

              if (
                typeof errorMessage === 'string' &&
                (errorMessage.includes('native messaging host not found') ||
                  errorMessage.includes('Specified native messaging host not found') ||
                  errorMessage.includes('Could not connect to native messaging host'))
              ) {
                mcpError = {
                  code: McpErrorCode.HOST_NOT_FOUND,
                  message: 'Native messaging host not found. Please ensure the MCP Host is properly installed.',
                  details: { originalError: errorMessage },
                };
                console.error('MCP Host installation error:', errorMessage);
              } else {
                mcpError = {
                  code: McpErrorCode.START_FAILED,
                  message: errorMessage,
                };
              }

              console.error('Start MCP Host failed:', mcpError);
              setError(mcpError);
            }

            setLoading(false);
            resolve(false);
          }
        });
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('Exception in startMcpHost:', errorMessage);
      setError({
        code: McpErrorCode.UNKNOWN,
        message: errorMessage,
      });
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
        setError({
          code: McpErrorCode.STOP_FAILED,
          message: 'Failed to stop MCP Host',
        });
        setLoading(false);
        return false;
      }
    } catch (err) {
      setError({
        code: McpErrorCode.UNKNOWN,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
      setLoading(false);
      return false;
    }
  };

  // Load initial status and set up message listener
  useEffect(() => {
    refreshStatus();

    // Listen for status updates from background
    const handleMessage = (message: any) => {
      if (message.type === 'mcpHostStatusUpdate') {
        console.debug('[useMcpHost] Received status update:', message.status);
        setStatus(message.status);
        setLoading(false);
      }
    };

    // Register message listener
    chrome.runtime.onMessage.addListener(handleMessage);

    // Clean up on component unmount
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
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
