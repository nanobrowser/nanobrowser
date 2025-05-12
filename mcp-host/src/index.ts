import { NativeMessaging } from './messaging';
import { createLogger } from './logger';
import { StatusHandler, PingHandler, ShutdownHandler } from './message-handlers';

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

// Create a cleanup function for the shutdown handler
const cleanup = async () => {
  logger.info('Performing cleanup before shutdown');
  // Add any cleanup tasks here
};
const shutdownHandler = new ShutdownHandler(cleanup);

// Register handlers
messaging.registerHandler('ping', data => pingHandler.handle(data));
messaging.registerHandler('getStatus', data => statusHandler.handle(data));
messaging.registerHandler('shutdown', data => shutdownHandler.handle(data));

// MCP-related message handlers

// Browser state handler
messaging.registerHandler('setBrowserState', async data => {
  logger.debug('Received browser state update:', data.state ? Object.keys(data.state).join(', ') : 'empty');

  // In a full implementation, we would update the MCP server with this state
  // mcpServer.setBrowserState(data.state);

  return {
    success: true,
    message: 'Browser state received',
  };
});

// List resources handler
messaging.registerHandler('listResources', async () => {
  logger.debug('Received request to list resources');

  // For now, return a simple mock response
  return {
    resources: [
      {
        uri: 'browser://current/state',
        name: 'Current Browser State',
        mimeType: 'application/json',
        description: 'Complete state of the current active page and all tabs',
      },
      {
        uri: 'browser://current/dom',
        name: 'Current Page DOM',
        mimeType: 'application/json',
        description: 'DOM structure of the current page',
      },
    ],
  };
});

// Read resource handler
messaging.registerHandler('readResource', async data => {
  logger.debug(`Received request to read resource: ${data.uri}`);

  // For now, return a simple mock response
  return {
    contents: [
      {
        uri: data.uri,
        mimeType: 'application/json',
        text: JSON.stringify({ message: `Mock resource content for ${data.uri}` }),
      },
    ],
  };
});

// List tools handler
messaging.registerHandler('listTools', async () => {
  logger.debug('Received request to list tools');

  // Return a simple list of mock tools
  return {
    tools: [
      {
        name: 'navigate_to',
        description: 'Navigate to a specified URL',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to navigate to',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'click_element',
        description: 'Click on a specified element',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector of the element to click',
            },
          },
          required: ['selector'],
        },
      },
    ],
  };
});

// Call tool handler
messaging.registerHandler('callTool', async data => {
  logger.debug(`Received request to call tool: ${data.name} with args:`, data.arguments);

  // For now, return a mock success response
  return {
    success: true,
    message: `Mock execution of tool: ${data.name}`,
    result: {
      content: [
        {
          type: 'text',
          text: `Successfully executed ${data.name} with arguments: ${JSON.stringify(data.arguments)}`,
        },
      ],
    },
  };
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
