/**
 * Scroll Page Handler for MCP Host RPC Requests
 *
 * This file implements the scroll_page RPC method handler for the browser extension.
 * It responds to requests from the MCP Host that need to scroll the page in various ways.
 */

import BrowserContext from '../browser/context';
import { createLogger } from '../log';
import { RpcHandler, RpcRequest, RpcResponse } from '../mcp/host-manager';

/**
 * Handler for the 'scroll_page' RPC method
 *
 * This handler processes scroll requests from the MCP Host and performs
 * the appropriate scrolling action on the current page.
 */
export class ScrollPageHandler {
  private logger = createLogger('ScrollPageHandler');

  /**
   * Creates a new ScrollPageHandler instance
   *
   * @param browserContext The browser context for accessing page scrolling methods
   */
  constructor(private readonly browserContext: BrowserContext) {}

  /**
   * Handle a scroll_page RPC request
   *
   * @param request RPC request with scroll parameters
   * @returns Promise resolving to an RPC response confirming the scroll action
   */
  public handleScrollPage: RpcHandler = async (request: RpcRequest): Promise<RpcResponse> => {
    this.logger.debug('Received scroll_page request:', request);

    try {
      const { action, pixels, element_index } = request.params || {};

      if (!action) {
        return {
          error: {
            code: -32602,
            message: 'Missing required parameter: action',
          },
        };
      }

      // Validate action type
      const validActions = ['up', 'down', 'to_element', 'to_top', 'to_bottom'];
      if (!validActions.includes(action)) {
        return {
          error: {
            code: -32602,
            message: `Invalid action: ${action}. Valid actions are: ${validActions.join(', ')}`,
          },
        };
      }

      // Get current page
      const currentPage = await this.browserContext.getCurrentPage();
      if (!currentPage) {
        return {
          error: {
            code: -32000,
            message: 'No active page available',
          },
        };
      }

      let result: string;

      // Execute the appropriate scroll action
      switch (action) {
        case 'up':
          await this.scrollUp(currentPage, pixels);
          result = `Scrolled up ${pixels || 300} pixels`;
          break;

        case 'down':
          await this.scrollDown(currentPage, pixels);
          result = `Scrolled down ${pixels || 300} pixels`;
          break;

        case 'to_element':
          if (element_index === undefined || element_index === null) {
            return {
              error: {
                code: -32602,
                message: 'Missing required parameter: element_index for to_element action',
              },
            };
          }
          await this.scrollToElement(currentPage, element_index);
          result = `Scrolled to element at index ${element_index}`;
          break;

        case 'to_top':
          await this.scrollToTop(currentPage);
          result = 'Scrolled to top of page';
          break;

        case 'to_bottom':
          await this.scrollToBottom(currentPage);
          result = 'Scrolled to bottom of page';
          break;

        default:
          return {
            error: {
              code: -32602,
              message: `Unsupported scroll action: ${action}`,
            },
          };
      }

      this.logger.debug('Scroll action completed:', result);

      return {
        result: {
          success: true,
          message: result,
        },
      };
    } catch (error) {
      this.logger.error('Error performing scroll action:', error);

      return {
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Unknown error performing scroll action',
          data: { stack: error instanceof Error ? error.stack : undefined },
        },
      };
    }
  };

  /**
   * Scroll up by the specified number of pixels
   *
   * @param page The page instance to scroll
   * @param pixels Number of pixels to scroll (default: 300)
   */
  private async scrollUp(page: any, pixels?: number): Promise<void> {
    const scrollAmount = pixels || 300;
    await page.scrollUp(scrollAmount);

    // Wait for scroll to complete
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  /**
   * Scroll down by the specified number of pixels
   *
   * @param page The page instance to scroll
   * @param pixels Number of pixels to scroll (default: 300)
   */
  private async scrollDown(page: any, pixels?: number): Promise<void> {
    const scrollAmount = pixels || 300;
    await page.scrollDown(scrollAmount);

    // Wait for scroll to complete
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  /**
   * Scroll to a specific element by its index
   *
   * @param page The page instance to scroll
   * @param elementIndex The index of the element to scroll to
   */
  private async scrollToElement(page: any, elementIndex: number): Promise<void> {
    // Get the DOM element by index
    const domElement = page.getDomElementByIndex(elementIndex);
    if (!domElement) {
      throw new Error(`Element with index ${elementIndex} not found`);
    }

    // Locate the element and scroll it into view
    const elementHandle = await page.locateElement(domElement);
    if (!elementHandle) {
      throw new Error(`Element with index ${elementIndex} could not be located on the page`);
    }

    // Scroll the element into view
    await elementHandle.evaluate((el: Element) => {
      el.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'center',
      });
    });

    // Wait for scroll to complete
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  /**
   * Scroll to the top of the page
   *
   * @param page The page instance to scroll
   */
  private async scrollToTop(page: any): Promise<void> {
    if (page._puppeteerPage) {
      await page._puppeteerPage.evaluate(() => {
        window.scrollTo({
          top: 0,
          left: 0,
          behavior: 'smooth',
        });
      });
    }

    // Wait for scroll to complete
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  /**
   * Scroll to the bottom of the page
   *
   * @param page The page instance to scroll
   */
  private async scrollToBottom(page: any): Promise<void> {
    if (page._puppeteerPage) {
      await page._puppeteerPage.evaluate(() => {
        window.scrollTo({
          top: document.body.scrollHeight,
          left: 0,
          behavior: 'smooth',
        });
      });
    }

    // Wait for scroll to complete
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
