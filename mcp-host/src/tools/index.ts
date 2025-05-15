/**
 * Browser tools module
 *
 * This module exports all available tools for browser interaction.
 */

import { Tool, ActionCallback, ActionResult } from '../types.js';
import { navigateToTool } from './navigate_to.js';
import { clickElementTool } from './click_element.js';
import { addTool } from './add.js';

// Export all tool-related types
export { Tool, ActionCallback, ActionResult } from '../types.js';

// Export individual tools
export { navigateToTool } from './navigate_to.js';
export { clickElementTool } from './click_element.js';
export { addTool } from './add.js';

/**
 * Array of all available tools
 */
export const allTools = [navigateToTool, clickElementTool, addTool];

/**
 * Map of tool names to tool instances for quick lookup
 */
export const toolMap: Record<string, Tool> = {
  [navigateToTool.name]: navigateToTool,
  [clickElementTool.name]: clickElementTool,
  [addTool.name]: addTool,
};

/**
 * Execute a tool by name with the provided arguments
 * @param name Name of the tool to execute
 * @param args Arguments to pass to the tool
 * @param callback Browser action callback
 * @returns Promise resolving to the action result
 * @throws Error if the tool is not found
 */
export async function executeTool(name: string, args: any, callback: ActionCallback | null): Promise<ActionResult> {
  const tool = toolMap[name];

  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  return tool.execute(args, callback);
}
