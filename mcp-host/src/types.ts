/**
 * Consolidated type definitions for MCP Host
 */

import { ZodRawShape } from 'zod';
import { type ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';

// ==============================
// RPC Types
// ==============================

/**
 * JSON-RPC like request structure
 */
export interface RpcRequest {
  /**
   * Unique identifier for the request
   */
  id?: string;

  /**
   * Method to be invoked
   */
  method: string;

  /**
   * Parameters for the method
   */
  params?: any;
}

/**
 * JSON-RPC like response structure
 */
export interface RpcResponse {
  /**
   * Identifier matching the request
   */
  id?: string;

  /**
   * Result of the method call (if successful)
   */
  result?: any;

  /**
   * Error information (if the call failed)
   */
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

/**
 * Options for RPC requests
 */
export interface RpcRequestOptions {
  /**
   * Timeout in milliseconds
   */
  timeout?: number;
}

/**
 * A function that handles an RPC request and returns a promise of RpcResponse
 */
export type RpcHandler = (request: RpcRequest) => Promise<RpcResponse>;

// ==============================
// Message Handler Types
// ==============================

/**
 * Common interface for all message handlers
 */
export type MessageHandler = (data: any) => Promise<void>;

/**
 * Configuration for the status handler
 */
export interface StatusHandlerConfig {
  startTime: number;
  version: string;
  runMode: string;
}

/**
 * Type definition for the cleanup function
 */
export type CleanupFunction = () => Promise<void>;

// ==============================
// Resource Types
// ==============================

/**
 * Browser state information
 */
export interface BrowserState {
  activeTab?: {
    id?: number;
    url?: string;
    title?: string;
    domState?: any;
  };
  tabs?: Array<{
    id?: number;
    url?: string;
    title?: string;
    active?: boolean;
  }>;
}

/**
 * Resource interface for MCP resources
 */
export interface Resource {
  uri: string;
  name: string;
  mimeType: string;
  description: string;
  read: () => Promise<{
    contents: Array<{
      uri: string;
      mimeType: string;
      text: string;
    }>;
  }>;
}

// ==============================
// Tool Types
// ==============================

/**
 * Result of executing a browser action
 */
export interface ActionResult {
  success: boolean;
  message?: string;
  data?: any;
}

/**
 * Callback function for executing browser actions
 */
export interface ActionCallback {
  (action: string, params: any): Promise<ActionResult>;
}

/**
 * Base interface for all tools
 */
export interface Tool<Args extends ZodRawShape> {
  /**
   * Name of the tool
   */
  name: string;

  /**
   * Description of what the tool does
   */
  description: string;

  /**
   * JSON Schema for tool input
   */
  inputSchema: Args;

  /**
   * Execute the tool with the provided arguments
   * @param args Tool arguments
   * @param callback Function to execute browser actions
   */
  execute: ToolCallback<Args>;
}
