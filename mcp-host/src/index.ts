import { NativeMessaging } from './messaging.js';
import { createLogger } from './logger.js';
import { McpServerManager } from './mcp-server.js';
import { NavigateToTool, RunTaskTool } from './tools/index.js';
import { CurrentDomResource, CurrentStateResource } from './resources/index.js';
import { RpcRequest, RpcResponse } from './types.js';

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

// Auto-start port (use PORT env var or default to 3000)
const mcpServerPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const mcpServerManager = new McpServerManager({
  port: mcpServerPort,
  logLevel: 'info',
});

// Initialize the native messaging handler
const messaging = new NativeMessaging();

// Register handlers
messaging.registerHandler('init', async () => {
  logger.info('mcp_host received init');
});

messaging.registerHandler('shutdown', async () => {
  logger.info('mcp_host received shutdown');

  // Shut down MCP server if it's running
  if (mcpServerManager.isServerRunning()) {
    logger.info('Shutting down MCP server');
    await mcpServerManager.shutdown();
  }
});

messaging.registerHandler('error', async (data: any): Promise<void> => {
  logger.error('mcp_host received error:', data);
});

messaging.registerRpcMethod('ping', async (req: RpcRequest): Promise<RpcResponse> => {
  logger.debug('received ping request:', req);

  return {
    result: {
      timestamp: Date.now(),
    },
  };
});

// Register resources with the MCP server manager
mcpServerManager.registerResource(new CurrentDomResource(messaging));
mcpServerManager.registerResource(new CurrentStateResource(messaging));
logger.info(`Registered resources with MCP server`);

// Initialize tools with the messaging instance
mcpServerManager.registerTool(new NavigateToTool(messaging));
mcpServerManager.registerTool(new RunTaskTool(messaging));
logger.info(`Registered tools with MCP server`);

// Auto-start MCP Server when MCP Host starts
logger.info(`Auto-starting MCP HTTP server on port ${mcpServerPort}`);
mcpServerManager
  .start()
  .then(result => {
    if (result) {
      logger.info(`MCP HTTP server auto-started successfully on port ${mcpServerPort}`);
    } else {
      logger.error('Failed to auto-start MCP HTTP server: Server already running');
    }
  })
  .catch((error: Error) => {
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

// Handle exit signals gracefully, ensuring MCP server shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT signal, shutting down');

  // First shut down the MCP server
  if (mcpServerManager.isServerRunning()) {
    logger.info('Shutting down MCP server before exit');
    await mcpServerManager.shutdown();
  }

  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM signal, shutting down');

  // First shut down the MCP server
  if (mcpServerManager.isServerRunning()) {
    logger.info('Shutting down MCP server before exit');
    await mcpServerManager.shutdown();
  }

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
