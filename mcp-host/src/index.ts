import { ActionResult } from './browser-tools';
import { McpServer } from './mcp-server';
import { NativeMessaging } from './messaging';

// Log startup information
console.error('Starting Nanobrowser MCP Native Messaging Host');
console.error(`Process ID: ${process.pid}`);
console.error(`Node.js version: ${process.version}`);
console.error(`Platform: ${process.platform}`);

// Initialize components
const messaging = new NativeMessaging();
const mcpServer = new McpServer();

// Register message handlers from extension to MCP server
messaging.registerHandler('setBrowserState', async data => {
  if (!data.state) {
    throw new Error('No state provided');
  }

  mcpServer.setBrowserState(data.state);
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

// Register action callback for the MCP server to send browser actions back to the extension
mcpServer.registerActionCallback(async (action: string, params: any): Promise<ActionResult> => {
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
});

// Handle exit signals
process.on('SIGINT', () => {
  console.error('Received SIGINT signal, exiting...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('Received SIGTERM signal, exiting...');
  process.exit(0);
});

// Notify that we're ready
console.error('Nanobrowser MCP Native Messaging Host is ready');
