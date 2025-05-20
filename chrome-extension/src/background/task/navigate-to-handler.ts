/**
 * Navigate To Handler for MCP Host RPC Requests
 *
 * This file implements the navigate_to RPC method handler for the browser extension.
 * It receives navigation requests from the MCP Host and performs the URL navigation.
 */

import BrowserContext from '../browser/context';
import { createLogger } from '../log';
import { RpcHandler, RpcRequest, RpcResponse } from '../mcp/host-manager';

/**
 * Interface for navigate_to request parameters
 */
interface NavigateToParams {
  /**
   * The URL to navigate to
   */
  url: string;
}

/**
 * Handler for the 'navigate_to' RPC method
 *
 * This handler processes navigation requests from the MCP Host and performs
 * browser navigation to the specified URL.
 */
export class NavigateToHandler {
  private logger = createLogger('NavigateToHandler');

  /**
   * Creates a new NavigateToHandler instance
   *
   * @param browserContext The browser context for tab and page navigation
   */
  constructor(private readonly browserContext: BrowserContext) {}

  /**
   * Handle a navigate_to RPC request
   *
   * @param request RPC request containing the URL to navigate to
   * @returns Promise resolving to an RPC response with the navigation result
   */
  public handleNavigateTo: RpcHandler = async (request: RpcRequest): Promise<RpcResponse> => {
    this.logger.debug('Received navigate_to request:', request);

    try {
      const params = request.params as NavigateToParams;

      if (!params || !params.url) {
        return {
          error: {
            code: -32602,
            message: 'Invalid params: url is required',
          },
        };
      }

      // Validate URL format
      let url = params.url;
      try {
        // Make sure the URL has a protocol
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = 'https://' + url;
        }
        // Check if the URL is valid
        new URL(url);
      } catch (error) {
        return {
          error: {
            code: -32602,
            message: `Invalid URL: ${params.url}`,
          },
        };
      }

      this.logger.info('Navigating to URL:', url);

      // Navigate to the URL using the browser context
      await this.browserContext.navigateTo(url);

      return {
        result: {
          success: true,
          message: `Successfully navigated to ${url}`,
          url,
        },
      };
    } catch (error) {
      this.logger.error('Error navigating to URL:', error);

      return {
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Unknown error during navigation',
          data: { stack: error instanceof Error ? error.stack : undefined },
        },
      };
    }
  };
}
