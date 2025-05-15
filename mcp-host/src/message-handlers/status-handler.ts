/**
 * Status handler for MCP Host
 */

import { createLogger } from '../logger.js';
import { MessageHandler, StatusHandlerConfig } from '../types.js';

/**
 * Handler for status requests
 * Responds with the current status of the MCP Host
 */
export class StatusHandler implements MessageHandler {
  private logger = createLogger('status-handler');
  private config: StatusHandlerConfig;

  constructor(config: StatusHandlerConfig) {
    this.config = config;
  }

  /**
   * Handles a getStatus message
   * @param data Message payload (not used for status requests)
   * @returns Promise resolving to status data
   */
  async handle(data: any): Promise<any> {
    this.logger.debug('Handling status request');

    return {
      data: {
        isConnected: true,
        startTime: this.config.startTime,
        version: this.config.version,
        runMode: this.config.runMode,
      },
    };
  }
}
