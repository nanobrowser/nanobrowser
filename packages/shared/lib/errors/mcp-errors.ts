/**
 * MCP Error Code definitions
 * This module defines standard error codes for MCP-related operations.
 */

export enum McpErrorCode {
  // Connection errors
  HOST_NOT_FOUND = 'MCP_HOST_NOT_FOUND',
  CONNECTION_FAILED = 'MCP_CONNECTION_FAILED',
  TIMEOUT = 'MCP_TIMEOUT',

  // Operation errors
  START_FAILED = 'MCP_START_FAILED',
  STOP_FAILED = 'MCP_STOP_FAILED',

  // Other generic errors
  UNKNOWN = 'MCP_UNKNOWN_ERROR',
}

/**
 * Standard MCP Error structure
 */
export interface McpError {
  code: McpErrorCode;
  message: string;
  details?: unknown;
}

/**
 * Create a standardized MCP error object
 * @param code Error code from McpErrorCode enum
 * @param message Human-readable error message
 * @param details Optional additional details about the error
 * @returns Structured McpError object
 */
export function createMcpError(code: McpErrorCode, message: string, details?: unknown): McpError {
  return { code, message, details };
}
