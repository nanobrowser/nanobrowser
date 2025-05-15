/**
 * Click element tool
 *
 * This tool allows clicking on an element in the browser.
 */

import { Tool, ActionCallback, ActionResult } from './types.js';

/**
 * Implementation of the click_element tool
 */
export class ClickElementTool implements Tool {
  /**
   * Tool name
   */
  public name = 'click_element';

  /**
   * Tool description
   */
  public description = 'Click on a specified element';

  /**
   * Input schema for the tool
   */
  public inputSchema = {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector of the element to click',
      },
    },
    required: ['selector'],
  };

  /**
   * Execute the click_element tool
   * @param args Tool arguments containing the element selector
   * @param callback Browser action callback
   * @returns Promise resolving to the action result
   */
  public async execute(args: { selector: string }, callback: ActionCallback | null): Promise<ActionResult> {
    if (!callback) {
      throw new Error('Browser action callback not set');
    }

    if (!args.selector) {
      throw new Error('Element selector is required for clicking');
    }

    // Call the browser action callback to perform the click operation
    return callback('click', { selector: args.selector });
  }
}

/**
 * Export a singleton instance of the click_element tool
 */
export const clickElementTool = new ClickElementTool();
