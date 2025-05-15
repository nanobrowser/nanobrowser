/**
 * Shutdown handler for MCP Host
 */

import { createLogger } from '../logger.js';
import { CleanupFunction, MessageHandler } from './types.js';

/**
 * Handler for shutdown requests
 * Performs cleanup and gracefully exits the process
 */
export class ShutdownHandler implements MessageHandler {
  private logger = createLogger('shutdown-handler');
  private cleanupFn: CleanupFunction;

  /**
   * @param cleanupFn Function to call for resource cleanup before shutdown
   */
  constructor(cleanupFn: CleanupFunction) {
    this.cleanupFn = cleanupFn;
  }

  /**
   * Handles a shutdown message
   * @param data Message payload (not used for shutdown requests)
   * @returns Promise resolving to success status
   */
  async handle(data: any): Promise<any> {
    this.logger.info('Handling shutdown request');

    try {
      // Perform cleanup
      await this.cleanupFn();

      // Schedule exit after response is sent
      setTimeout(() => {
        this.logger.info('Exiting process after successful shutdown');
        process.exit(0);
      }, 500);

      return { success: true };
    } catch (error) {
      this.logger.error('Error during shutdown cleanup:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
