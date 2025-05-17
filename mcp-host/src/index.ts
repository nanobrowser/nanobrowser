import { NativeMessaging } from './messaging.js';
import { createLogger } from './logger.js';
import { StatusHandler, PingHandler, ShutdownHandler, McpServerStatusHandler } from './message-handlers/index.js';
import { McpServerManager } from './mcp-server.js';
import { allTools } from './tools/index.js';
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

// Auto-start port (use PORT env var or default to 3000)
const mcpServerPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Create MCP server manager directly
const mcpServerManager = new McpServerManager({
  port: mcpServerPort,
  logLevel: 'info',
});

// Set the browser action callback
mcpServerManager.setBrowserActionCallback(browserActionCallback);

// Create MCP server status handler
const mcpServerStatusHandler = new McpServerStatusHandler(mcpServerManager);

// Create a cleanup function for the shutdown handler
const cleanup = async () => {
  logger.info('Performing cleanup before shutdown');

  // Shut down MCP server if it's running
  if (mcpServerManager.isServerRunning()) {
    logger.info('Shutting down MCP server');
    await mcpServerManager.shutdown();
  }
};
const shutdownHandler = new ShutdownHandler(cleanup);

// Register handlers
messaging.registerHandler('ping', data => pingHandler.handle(data));
messaging.registerHandler('getStatus', data => statusHandler.handle(data));
messaging.registerHandler('shutdown', data => shutdownHandler.handle(data));

// Only keep the status handler for MCP server
messaging.registerHandler('getMcpServerStatus', data => mcpServerStatusHandler.handle(data));

messaging.registerHandler('error', async (data: any): Promise<void> => {
  logger.error('mcp_host received error:', data);
});

messaging.registerRpcMethod('hello', async (req: RpcRequest): Promise<RpcResponse> => {
  return {
    id: req.id,
    result: 'world',
  };
});

// Register tools with the MCP server manager
for (const tool of allTools) {
  mcpServerManager.registerTool(tool);
}
logger.info(`Registered ${allTools.length} tools with MCP server`);

mcpServerManager.registerResource(new CurrentDomResource(messaging));
mcpServerManager.registerResource(new CurrentStateResource(messaging));
logger.info(`Registered resources with MCP server`);

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
