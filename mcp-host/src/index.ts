import express from 'express';
import { ActionResult } from './browser-tools';
import { BrowserMcpServer } from './http-mcp-server';
import { McpServer } from './mcp-server';
import { NativeMessaging } from './messaging';

// Create Express app for Vite compatibility
const app = express();

// Log startup information
console.error('Starting Nanobrowser MCP Native Messaging Host');
console.error(`Process ID: ${process.pid}`);
console.error(`Node.js version: ${process.version}`);
console.error(`Platform: ${process.platform}`);

// Initialize components
const messaging = new NativeMessaging();
const mcpServer = new McpServer();

// Initialize the HTTP-based MCP server
const httpMcpServer = new BrowserMcpServer();

// Register message handlers from extension to MCP servers
messaging.registerHandler('setBrowserState', async data => {
  if (!data.state) {
    throw new Error('No state provided');
  }

  // Update both MCP servers
  mcpServer.setBrowserState(data.state);
  httpMcpServer.setBrowserState(data.state);

  return { success: true };
});

// Register message handlers for MCP server requests
messaging.registerHandler('listResources', async () => {
  const result = await mcpServer.handleListResources();
  return result;
});

messaging.registerHandler('readResource', async data => {
  if (!data.uri) {
    throw new Error('No URI provided');
  }

  const result = await mcpServer.handleReadResource(data.uri);
  return result;
});

messaging.registerHandler('listTools', async () => {
  const result = await mcpServer.handleListTools();
  return result;
});

messaging.registerHandler('callTool', async data => {
  if (!data.name || !data.arguments) {
    throw new Error('Tool name and arguments are required');
  }

  const result = await mcpServer.handleCallTool(data.name, data.arguments);
  return result;
});

// Shared action callback for both MCP servers to send browser actions back to the extension
const handleAction = async (action: string, params: any): Promise<ActionResult> => {
  try {
    // Send the action request to the extension
    messaging.sendMessage({
      type: 'executeAction',
      action,
      params,
    });

    // This is a simplified approach - in a real implementation we would wait for a response
    return {
      success: true,
      message: `Action ${action} requested`,
      data: { action, params },
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

// Register action callback for both MCP servers
mcpServer.registerActionCallback(handleAction);
httpMcpServer.registerActionCallback(handleAction);

// Start the HTTP MCP server
httpMcpServer.start().catch(error => {
  console.error('Failed to start HTTP MCP server:', error);
});

// Handle exit signals
process.on('SIGINT', async () => {
  console.error('Received SIGINT signal, exiting...');
  await httpMcpServer.stop().catch(error => {
    console.error('Error stopping HTTP MCP server:', error);
  });
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('Received SIGTERM signal, exiting...');
  await httpMcpServer.stop().catch(error => {
    console.error('Error stopping HTTP MCP server:', error);
  });
  process.exit(0);
});

// Notify that we're ready
console.error('Nanobrowser MCP Native Messaging Host is ready');

// Configure Express routes for Vite compatibility
app.get('/', (req: express.Request, res: express.Response) => {
  res.send('Nanobrowser MCP Host is running');
});

// Add health check endpoint
app.get('/health', (req: express.Request, res: express.Response) => {
  res.json({
    status: 'ok',
    version: '0.1.0',
    services: {
      mcpServer: 'running',
      httpMcpServer: 'running',
    },
  });
});

// Export the Express app for Vite
export default app;
