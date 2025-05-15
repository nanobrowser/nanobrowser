/**
 * Type definitions for browser tools
 */

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
