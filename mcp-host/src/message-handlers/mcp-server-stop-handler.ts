/**
 * MCP Server Stop handler for MCP Host
 */

import { createLogger } from '../logger.js';
import { McpServerManager } from '../mcp-server.js';
import { MessageHandler } from '../types.js';

/**
 * Handler for stopping the MCP server
 */
export class McpServerStopHandler implements MessageHandler {
  private logger = createLogger('mcp-server-stop-handler');

  /**
   * Creates an instance of the MCP server stop handler
   * @param mcpServerManager The MCP server manager instance
   */
  constructor(private mcpServerManager: McpServerManager) {
    this.logger.debug('Initialized MCP server stop handler');
  }

  /**
   * Handles a stop MCP server message
   * @param data Message payload (not used for stop requests)
   * @returns Promise resolving to success status
   */
  async handle(data: any): Promise<any> {
    this.logger.info('Handling MCP server stop request');

    try {
      if (!this.mcpServerManager.isServerRunning()) {
        this.logger.warn('MCP server not running');
        return {
          success: false,
          message: 'MCP server not running',
        };
      }

      // Stop the server
      const result = await this.mcpServerManager.shutdown();

      return {
        success: result,
        message: result ? 'MCP server stopped successfully' : 'Failed to stop MCP server',
      };
    } catch (error) {
      this.logger.error('Error stopping MCP server:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
