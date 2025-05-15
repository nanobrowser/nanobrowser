/**
 * Navigate to URL tool
 *
 * This tool allows navigating to a specified URL in the browser.
 */

import { Tool, ActionCallback, ActionResult } from './types.js';

/**
 * Implementation of the navigate_to tool
 */
export class NavigateToTool implements Tool {
  /**
   * Tool name
   */
  public name = 'navigate_to';

  /**
   * Tool description
   */
  public description = 'Navigate to a specified URL';

  /**
   * Input schema for the tool
   */
  public inputSchema = {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to navigate to',
      },
    },
    required: ['url'],
  };

  /**
   * Execute the navigate_to tool
   * @param args Tool arguments containing the URL
   * @param callback Browser action callback
   * @returns Promise resolving to the action result
   */
  public async execute(args: { url: string }, callback: ActionCallback | null): Promise<ActionResult> {
    if (!callback) {
      throw new Error('Browser action callback not set');
    }

    if (!args.url) {
      throw new Error('URL is required for navigation');
    }

    // Call the browser action callback to perform the navigation
    return callback('navigate', { url: args.url });
  }
}

/**
 * Export a singleton instance of the navigate_to tool
 */
export const navigateToTool = new NavigateToTool();
