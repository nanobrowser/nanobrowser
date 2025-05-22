import React from 'react';
import { StatusDisplay } from '@src/StatusDisplay';
import { ControlPanel } from '@src/ControlPanel';
import { useMcpHost } from '@src/useMcpHost';

export const Popup: React.FC = () => {
  const { status, loading, error, refreshStatus, startMcpHost, stopMcpHost } = useMcpHost();

  return (
    <div className="p-4 max-w-md mx-auto">
      <header className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">MCP Host Control</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">Monitor and control the MCP Host process</p>
      </header>

      <StatusDisplay status={status} loading={loading} error={error} onRefresh={refreshStatus} />

      <ControlPanel
        isConnected={status.isConnected}
        onStartHost={startMcpHost}
        onStopHost={stopMcpHost}
        loading={loading}
      />

      <footer className="mt-6 text-center text-xs text-gray-500 dark:text-gray-400">
        <p>
          Version 0.1.0 |{' '}
          <a href="#" className="text-blue-600 dark:text-blue-400 hover:underline">
            Help
          </a>
        </p>
      </footer>
    </div>
  );
};
