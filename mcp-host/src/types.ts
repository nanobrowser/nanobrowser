/**
 * Consolidated type definitions for MCP Host
 */

// ==============================
// Message Handler Types
// ==============================

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
export interface Tool {
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
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };

  /**
   * Execute the tool with the provided arguments
   * @param args Tool arguments
   * @param callback Function to execute browser actions
   */
  execute(args: any, callback: ActionCallback | null): Promise<ActionResult>;
}
