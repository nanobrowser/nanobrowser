/**
 * Ping handler for MCP Host
 */

import { createLogger } from '../logger.js';
import { MessageHandler, PingCallback } from './types.js';

/**
 * Handler for ping (heartbeat) requests
 * Responds with the current timestamp
 */
export class PingHandler implements MessageHandler {
  private logger = createLogger('ping-handler');
  /**
   * Optional callback to be called when a ping is received
   * This can be used to track the last ping time
   */
  public onPing?: PingCallback;

  /**
   * Handles a ping message
   * @param data Message payload (not used for ping requests)
   * @returns Promise resolving to timestamp data
   */
  async handle(data: any): Promise<any> {
    this.logger.debug('Handling ping request');

    const timestamp = Date.now();

    // Call the callback if it's registered
    if (this.onPing) {
      this.onPing(timestamp);
    }

    return {
      timestamp,
    };
  }
}
