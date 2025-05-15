/**
 * Add numbers tool
 *
 * This is a simple tool for testing purposes that adds two numbers together.
 */

import { Tool, ActionCallback, ActionResult } from './types.js';

/**
 * Implementation of the add tool
 */
export class AddTool implements Tool {
  /**
   * Tool name
   */
  public name = 'add';

  /**
   * Tool description
   */
  public description = 'Add two numbers together for testing purposes';

  /**
   * Input schema for the tool
   */
  public inputSchema = {
    type: 'object',
    properties: {
      a: {
        type: 'number',
        description: 'First number to add',
      },
      b: {
        type: 'number',
        description: 'Second number to add',
      },
    },
    required: ['a', 'b'],
  };

  /**
   * Execute the add tool
   * @param args Tool arguments containing the numbers to add
   * @param callback Browser action callback (not used for this tool)
   * @returns Promise resolving to the action result
   */
  public async execute(args: { a: number; b: number }, callback: ActionCallback | null): Promise<ActionResult> {
    if (typeof args.a !== 'number' || typeof args.b !== 'number') {
      throw new Error('Both "a" and "b" must be numbers');
    }

    // Calculate the sum
    const sum = args.a + args.b;

    // Return the result
    return {
      success: true,
      message: `The sum of ${args.a} and ${args.b} is ${sum}`,
      data: { result: sum },
    };
  }
}

/**
 * Export a singleton instance of the add tool
 */
export const addTool = new AddTool();
