/**
 * Navigate to URL tool
 *
 * This tool allows navigating to a specified URL in the browser.
 */

import { Tool, ActionResult } from '../types.js';
import { NativeMessaging } from '../messaging.js';

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
   * Private reference to the NativeMessaging instance
   */
  private messaging: NativeMessaging;

  /**
   * Constructor
   * @param messaging NativeMessaging instance for communication
   */
  constructor(messaging: NativeMessaging) {
    this.messaging = messaging;
  }

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
  public async execute(args: { url: string }): Promise<ActionResult> {
    if (!args.url) {
      throw new Error('URL is required for navigation');
    }

    const resp = await this.messaging.rpcRequest({
      method: 'navigate_to',
      params: {
        url: args.url,
      },
    });

    return {
      success: true,
      data: resp.result,
    };
  }
}
