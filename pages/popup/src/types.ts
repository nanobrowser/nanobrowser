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
