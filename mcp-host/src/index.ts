import { NativeMessaging } from './messaging.js';
import { createLogger } from './logger.js';
import {
  StatusHandler,
  PingHandler,
  ShutdownHandler,
  McpServerStartHandler,
  McpServerStopHandler,
  McpServerStatusHandler,
} from './message-handlers.js';

// Create a logger instance for the main module
const logger = createLogger('main');

// Define version and basic information
const HOST_INFO = {
  name: 'nanobrowser-mcp-host',
  version: '0.1.0',
  runMode: process.env.RUN_MODE || 'stdio',
};

// Initialize status tracking
const hostStatus = {
  isConnected: true,
  startTime: Date.now(),
  lastPing: Date.now(),
  ...HOST_INFO,
};

logger.info(`Starting MCP Host in ${hostStatus.runMode} mode`);

// Initialize the native messaging handler
const messaging = new NativeMessaging();

// Create handler instances
const statusHandler = new StatusHandler({
  startTime: hostStatus.startTime,
  version: hostStatus.version,
  runMode: hostStatus.runMode,
});

const pingHandler = new PingHandler();

// Update last ping time whenever we receive a ping
pingHandler.onPing = timestamp => {
  hostStatus.lastPing = timestamp;
};

// Define a browser action callback for MCP server
const browserActionCallback = async (action: string, params: any) => {
  logger.debug(`Received browser action: ${action}`, params);
  // In a full implementation, we would send these actions to the Chrome extension
  // For now, just return a success response
  return {
    success: true,
    message: `Browser action ${action} handled`,
    data: params,
  };
};

// Create MCP server handlers
const mcpServerStartHandler = new McpServerStartHandler(browserActionCallback);
const mcpServerStopHandler = new McpServerStopHandler(() => mcpServerStartHandler.getMcpServerManager());
const mcpServerStatusHandler = new McpServerStatusHandler(() => mcpServerStartHandler.getMcpServerManager());

// Create a cleanup function for the shutdown handler
const cleanup = async () => {
  logger.info('Performing cleanup before shutdown');

  // Shut down MCP server if it's running
  const mcpServerManager = mcpServerStartHandler.getMcpServerManager();
  if (mcpServerManager && mcpServerManager.isServerRunning()) {
    logger.info('Shutting down MCP server');
    await mcpServerManager.shutdown();
  }
};
const shutdownHandler = new ShutdownHandler(cleanup);

// Register handlers
messaging.registerHandler('ping', data => pingHandler.handle(data));
messaging.registerHandler('getStatus', data => statusHandler.handle(data));
messaging.registerHandler('shutdown', data => shutdownHandler.handle(data));

// MCP server handlers
messaging.registerHandler('startMcpServer', data => mcpServerStartHandler.handle(data));
messaging.registerHandler('stopMcpServer', data => mcpServerStopHandler.handle(data));
messaging.registerHandler('getMcpServerStatus', data => mcpServerStatusHandler.handle(data));

// MCP-related message handlers

// Browser state handler
messaging.registerHandler('setBrowserState', async data => {
  logger.debug('Received browser state update:', data.state ? Object.keys(data.state).join(', ') : 'empty');

  // Update the MCP server with the browser state
  const mcpServerManager = mcpServerStartHandler.getMcpServerManager();
  if (mcpServerManager) {
    mcpServerManager.setBrowserState(data.state);
  }

  return {
    success: true,
    message: 'Browser state received',
  };
});

// Auto-start MCP Server when MCP Host starts
// This sets up the server with default configuration (port: 3000, logLevel: 'info')
// Use the PORT environment variable or default to 3000
const autoStartPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
logger.info(`Auto-starting MCP HTTP server on port ${autoStartPort}`);
mcpServerStartHandler
  .handle({
    port: autoStartPort,
    logLevel: 'info',
  })
  .then(result => {
    if (result.success) {
      logger.info(`MCP HTTP server auto-started successfully on port ${autoStartPort}`);
    } else {
      logger.error('Failed to auto-start MCP HTTP server:', result.error || 'Unknown error');
    }
  })
  .catch(error => {
    logger.error('Exception during MCP HTTP server auto-start:', error);
  });

// Send initial ready message to let the extension know we're available
messaging.sendMessage({
  type: 'status',
  data: {
    isConnected: true,
    startTime: hostStatus.startTime,
    version: hostStatus.version,
    runMode: hostStatus.runMode,
  },
});

// Handle exit signals gracefully
process.on('SIGINT', () => {
  logger.info('Received SIGINT signal, shutting down');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM signal, shutting down');
  process.exit(0);
});

// Error handling for uncaught exceptions
process.on('uncaughtException', error => {
  logger.error('Uncaught exception:', error);
  messaging.sendMessage({
    type: 'error',
    error: error.message,
    stack: error.stack,
  });
});

logger.info('MCP Host started successfully');
