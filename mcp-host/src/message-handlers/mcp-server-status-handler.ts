/**
 * MCP Server Status handler for MCP Host
 */

import { createLogger } from '../logger.js';
import { McpServerManager } from '../mcp-server.js';
import { MessageHandler } from '../types.js';

/**
 * Handler for getting the MCP server status
 */
export class McpServerStatusHandler implements MessageHandler {
  private logger = createLogger('mcp-server-status-handler');

  /**
   * Creates an instance of the MCP server status handler
   * @param mcpServerManager The MCP server manager instance
   */
  constructor(private mcpServerManager: McpServerManager) {
    this.logger.debug('Initialized MCP server status handler');
  }

  /**
   * Handles a get MCP server status message
   * @param data Message payload (not used for status requests)
   * @returns Promise resolving to status data
   */
  async handle(data: any): Promise<any> {
    this.logger.debug('Handling MCP server status request');

    const isRunning = this.mcpServerManager.isServerRunning();

    return {
      isRunning,
      config: {
        port: this.mcpServerManager['config']?.port,
        logLevel: this.mcpServerManager['config']?.logLevel,
      },
    };
  }
}
