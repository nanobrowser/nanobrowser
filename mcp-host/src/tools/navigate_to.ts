/**
 * Navigate to URL tool
 *
 * This tool allows navigating to a specified URL in the browser.
 */

import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { NativeMessaging } from '../messaging.js';
import { createLogger } from '../logger.js';

/**
 * Implementation of the navigate_to tool
 */
export class NavigateToTool {
  private logger = createLogger('navigate_to_tool');

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
    url: z.string(),
  };

  /**
   * Execute the navigate_to tool
   * @param args Tool arguments containing the URL
   * @param callback Browser action callback
   * @returns Promise resolving to the action result
   */
  public execute = async (args: { url: string }): Promise<CallToolResult> => {
    this.logger.info('execute args:', args);

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
      content: [
        {
          type: 'text',
          text: `navigate_to ${args.url} ok`,
        },
      ],
    };
  };
}
