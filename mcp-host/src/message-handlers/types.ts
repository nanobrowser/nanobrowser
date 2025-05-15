/**
 * Common types for message handlers
 */

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
 * Type definition for ping callback
 */
export type PingCallback = (timestamp: number) => void;

/**
 * Type definition for the cleanup function
 */
export type CleanupFunction = () => Promise<void>;
