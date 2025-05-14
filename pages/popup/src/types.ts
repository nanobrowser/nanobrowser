/**
 * MCP Host Status interface
 */
export interface McpHostStatus {
  isConnected: boolean;
  startTime: number | null;
  lastHeartbeat: number | null;
  version: string | null;
  runMode: string | null;
}

/**
 * MCP Host Configuration options
 */
export interface McpHostOptions {
  runMode: string;
  port?: number;
  logLevel?: string;
}

/**
 * MCP Server Status interface
 */
export interface McpServerStatus {
  isRunning: boolean;
  config: {
    port: number | null;
    logLevel: string | null;
  } | null;
}

/**
 * MCP Server Configuration options
 */
export interface McpServerConfig {
  port: number;
  logLevel: string;
}
