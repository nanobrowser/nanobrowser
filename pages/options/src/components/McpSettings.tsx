import React, { useCallback, useState, useEffect } from 'react';
import { useMcpHost, McpErrorCode } from '@extension/shared';

interface McpSettingsProps {
  isDarkMode: boolean;
}

export const McpSettings: React.FC<McpSettingsProps> = ({ isDarkMode }) => {
  const { status, loading, error, startMcpHost, stopMcpHost } = useMcpHost();

  const handleStartClick = useCallback(async () => {
    // Use default parameters
    await startMcpHost({
      runMode: 'stdio',
    });
  }, [startMcpHost]);

  const handleStopClick = useCallback(async () => {
    await stopMcpHost();
  }, [stopMcpHost]);

  // Format time for display
  const formatTime = (timestamp: number | null) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleString();
  };

  // SEE protocol endpoint
  const seeEndpoint = 'http://localhost:7890/mcp';

  // State to track copy operation and installation guide dismiss
  const [copyStatus, setCopyStatus] = useState(false);
  const [installGuideVisible, setInstallGuideVisible] = useState(false);

  // Copy SEE endpoint to clipboard with feedback
  const copyEndpoint = () => {
    navigator.clipboard.writeText(seeEndpoint);
    setCopyStatus(true);
    setTimeout(() => {
      setCopyStatus(false);
    }, 2000); // Reset after 2 seconds
  };

  // Initialize installation guide visibility from localStorage on component mount
  // and only show the installation guide when explicitly triggered
  useEffect(() => {
    // On initial load, check if we previously detected an error
    const errorWasDetected = localStorage.getItem('mcpHostErrorDetected') === 'true';
    if (errorWasDetected) {
      setInstallGuideVisible(true);
    }
  }, []);

  // Only set visibility to true when HOST_NOT_FOUND error is detected
  // Never auto-hide (only manual dismiss or connection success)
  useEffect(() => {
    // If we detect the specific error, show the installation guide and persist state
    if (error?.code === McpErrorCode.HOST_NOT_FOUND) {
      setInstallGuideVisible(true);
      localStorage.setItem('mcpHostErrorDetected', 'true');
    }

    // Only auto-clear on successful connection
    if (status.isConnected) {
      setInstallGuideVisible(false);
      localStorage.removeItem('mcpHostErrorDetected');
    }
  }, [error?.code, status.isConnected]);

  // Only way to manually dismiss the guide
  const dismissInstallGuide = useCallback(() => {
    setInstallGuideVisible(false);
    localStorage.removeItem('mcpHostErrorDetected');
  }, []);

  return (
    <div className={`${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
      <h1 className="mb-6 text-2xl font-bold">MCP Host Settings</h1>

      {/* Status Section */}
      <div className={`mb-8 rounded-lg ${isDarkMode ? 'bg-slate-700/50' : 'bg-white/50'} p-6 backdrop-blur-sm`}>
        <h2 className="mb-4 text-xl font-semibold">Status</h2>

        <div className="mb-6 grid grid-cols-[120px_1fr] gap-y-3">
          <div className="font-medium">Connection:</div>
          <div className="flex items-center">
            <span
              className={`mr-2 inline-block h-3 w-3 rounded-full ${
                status.isConnected ? 'bg-green-500' : 'bg-red-500'
              }`}></span>
            <span>{status.isConnected ? 'Connected' : 'Disconnected'}</span>
          </div>

          <div className="font-medium">Version:</div>
          <div>{status.version || 'N/A'}</div>

          <div className="font-medium">Start Time:</div>
          <div>{formatTime(status.startTime)}</div>

          <div className="font-medium">Last Heartbeat:</div>
          <div>{formatTime(status.lastHeartbeat)}</div>

          <div className="font-medium">Run Mode:</div>
          <div>{status.runMode || 'N/A'}</div>
        </div>

        <div className="flex justify-center space-x-4">
          {!status.isConnected ? (
            <button
              onClick={handleStartClick}
              disabled={loading}
              className={`flex items-center rounded-md px-4 py-2 font-medium text-white 
                ${loading ? 'cursor-not-allowed bg-blue-400' : 'bg-blue-600 hover:bg-blue-700'}`}>
              {loading ? (
                <>
                  <svg
                    className="mr-2 h-4 w-4 animate-spin"
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
                </>
              ) : (
                'Start MCP Host'
              )}
            </button>
          ) : (
            <button
              onClick={handleStopClick}
              disabled={loading}
              className={`flex items-center rounded-md px-4 py-2 font-medium text-white 
                ${loading ? 'cursor-not-allowed bg-red-400' : 'bg-red-600 hover:bg-red-700'}`}>
              {loading ? (
                <>
                  <svg
                    className="mr-2 h-4 w-4 animate-spin"
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
                </>
              ) : (
                'Stop MCP Host'
              )}
            </button>
          )}
        </div>

        {/* Error display */}
        {error && (
          <div className="mt-4 rounded-md overflow-hidden">
            <div className={`p-4 ${isDarkMode ? 'bg-red-900/50 text-red-300' : 'bg-red-50 text-red-700'}`}>
              <p className="font-medium">Error: {error.message}</p>
              {error.code && <p className="text-sm opacity-75">Error code: {error.code}</p>}
            </div>
          </div>
        )}

        {/* Installation guide - shown regardless of current error state when installGuideVisible is true */}
        {installGuideVisible && (
          <div className="mt-4 rounded-md overflow-hidden">
            <div
              className={`p-4 border-t relative ${isDarkMode ? 'bg-amber-900/30 border-amber-800 text-amber-200' : 'bg-amber-50 border-amber-100 text-amber-800'}`}>
              {/* Add close button */}
              <button
                onClick={dismissInstallGuide}
                className={`absolute top-2 right-2 p-1 rounded-full ${isDarkMode ? 'bg-amber-800 hover:bg-amber-700 text-amber-200' : 'bg-amber-200 hover:bg-amber-300 text-amber-800'}`}
                aria-label="Close installation guide">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              <h3 className="font-semibold mb-2">MCP Host Installation Required</h3>
              <p className="mb-3">
                This error indicates that you need to install the MCP Host. Please follow these steps:
              </p>
              <ol className="list-decimal ml-5 space-y-2 mb-3">
                <li className="pl-1">Open your terminal</li>
                <li className="pl-1">
                  Clone the MCP Host repository:
                  <div className="mt-1">
                    <code
                      className={`block px-2 py-1 rounded text-sm font-mono ${isDarkMode ? 'bg-slate-800' : 'bg-gray-100'}`}>
                      git clone https://github.com/nanobrowser/nanobrowser-mcp-host.git
                    </code>
                  </div>
                </li>
                <li className="pl-1">
                  Navigate to the cloned directory:
                  <div className="mt-1">
                    <code
                      className={`block px-2 py-1 rounded text-sm font-mono ${isDarkMode ? 'bg-slate-800' : 'bg-gray-100'}`}>
                      cd nanobrowser-mcp-host
                    </code>
                  </div>
                </li>
                <li className="pl-1">
                  Run the installation script:
                  <div className="mt-1">
                    <code
                      className={`block px-2 py-1 rounded text-sm font-mono ${isDarkMode ? 'bg-slate-800' : 'bg-gray-100'}`}>
                      ./install.sh
                    </code>
                  </div>
                </li>
                <li className="pl-1">
                  After installation is complete, return to this page and click "Start MCP Host" again
                </li>
              </ol>
              <p className="text-sm">
                For complete installation instructions, refer to the
                <a
                  href="https://github.com/nanobrowser/nanobrowser-mcp-host"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`ml-1 underline ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                  MCP Host GitHub repository
                </a>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* SEE Protocol Information */}
      <div className={`mb-8 rounded-lg ${isDarkMode ? 'bg-slate-700/50' : 'bg-white/50'} p-6 backdrop-blur-sm`}>
        <h2 className="mb-4 text-xl font-semibold">SEE Protocol Endpoint</h2>
        <p className="mb-3">
          When the MCP Host is running, it exposes browser capabilities via the Model Context Protocol (MCP) Surface
          Extension Environments (SEE) protocol at:
        </p>

        <div className="mb-4 flex items-center">
          <code
            className={`mr-2 rounded px-3 py-2 font-mono text-sm 
              ${isDarkMode ? 'bg-slate-800 text-blue-400' : 'bg-blue-50 text-blue-700'} flex-1`}>
            {seeEndpoint}
          </code>
          <button
            onClick={copyEndpoint}
            className={`ml-2 rounded-md px-3 py-2 transition-colors duration-200
              ${
                copyStatus
                  ? isDarkMode
                    ? 'bg-green-700 hover:bg-green-600'
                    : 'bg-green-500 hover:bg-green-400 text-white'
                  : isDarkMode
                    ? 'bg-slate-600 hover:bg-slate-500'
                    : 'bg-blue-100 hover:bg-blue-200'
              }`}
            title="Copy to clipboard">
            {copyStatus ? 'Copied!' : 'Copy'}
          </button>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400">
          You can connect external AI systems to this endpoint using the MCP protocol to interact with browser
          capabilities.
        </p>
      </div>

      {/* Documentation Section */}
      <div className={`rounded-lg ${isDarkMode ? 'bg-slate-700/50' : 'bg-white/50'} p-6 backdrop-blur-sm`}>
        <h2 className="mb-4 text-xl font-semibold">Documentation</h2>
        <p className="mb-3">
          The MCP Host allows external AI systems to access browser capabilities through standardized interfaces using
          the Model Context Protocol.
        </p>

        <p className="mb-4">
          For detailed documentation and advanced configuration options, visit the MCP Host repository:
        </p>

        <a
          href="https://github.com/nanobrowser/nanobrowser-mcp-host"
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-block rounded-md px-4 py-2 font-medium 
            ${isDarkMode ? 'bg-blue-700 text-white hover:bg-blue-600' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
          MCP Host GitHub Repository
        </a>

        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          Note: Advanced configuration options like Run Mode and Log Level can be set during MCP Host installation.
        </p>
      </div>
    </div>
  );
};
