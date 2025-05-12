/**
 * Message handlers for MCP Host
 *
 * This file contains implementations of various message handlers
 * that process incoming messages from the Chrome extension.
 */

import { createLogger } from './logger';

/**
 * Common interface for all message handlers
 */
export interface MessageHandler {
  handle(data: any): Promise<any>;
}

/**
 * Configuration for the status handler
 */
export interface StatusHandlerConfig {
  startTime: number;
  version: string;
  runMode: string;
}

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

/**
 * Type definition for ping callback
 */
export type PingCallback = (timestamp: number) => void;

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

/**
 * Type definition for the cleanup function
 */
export type CleanupFunction = () => Promise<void>;

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
