/**
 * Click Element Handler for MCP Host RPC Requests
 *
 * This file implements the click_element RPC method handler for the browser extension.
 * It responds to requests from the MCP Host that need to click interactive elements on pages.
 */

import BrowserContext from '../browser/context';
import { createLogger } from '../log';
import { RpcHandler, RpcRequest, RpcResponse } from '../mcp/host-manager';

/**
 * Handler for the 'click_element' RPC method
 *
 * This handler processes click requests from the MCP Host and performs
 * clicks on interactive elements identified by their index.
 */
export class ClickElementHandler {
  private logger = createLogger('ClickElementHandler');

  /**
   * Creates a new ClickElementHandler instance
   *
   * @param browserContext The browser context for accessing page interaction methods
   */
  constructor(private readonly browserContext: BrowserContext) {}

  /**
   * Handle a click_element RPC request
   *
   * @param request RPC request with click parameters
   * @returns Promise resolving to an RPC response confirming the click action
   */
  public handleClickElement: RpcHandler = async (request: RpcRequest): Promise<RpcResponse> => {
    this.logger.debug('Received click_element request:', request);

    try {
      const { element_index, wait_after } = request.params || {};

      // Validate element_index parameter
      if (element_index === undefined || element_index === null) {
        return {
          error: {
            code: -32602,
            message: 'Missing required parameter: element_index',
          },
        };
      }

      if (typeof element_index !== 'number' || element_index < 0) {
        return {
          error: {
            code: -32602,
            message: 'element_index must be a non-negative number',
          },
        };
      }

      // Validate wait_after parameter if provided
      const waitAfter = wait_after || 1;
      if (typeof waitAfter !== 'number' || waitAfter < 0 || waitAfter > 30) {
        return {
          error: {
            code: -32602,
            message: 'wait_after must be a number between 0 and 30 seconds',
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

      // Store current URL for comparison
      const beforeUrl = await this.getCurrentUrl(currentPage);

      // Perform the click operation
      const clickResult = await this.clickElement(currentPage, element_index);

      // Wait for the specified time after clicking
      await new Promise(resolve => setTimeout(resolve, waitAfter * 1000));

      // Check if page changed after click
      const afterUrl = await this.getCurrentUrl(currentPage);
      const pageChanged = beforeUrl !== afterUrl;

      const result = {
        success: true,
        message: `Successfully clicked element at index ${element_index}`,
        element_index,
        page_changed: pageChanged,
        element_info: clickResult.elementInfo,
        before_url: beforeUrl,
        after_url: afterUrl,
      };

      this.logger.debug('Click element completed:', result);

      return {
        result,
      };
    } catch (error) {
      this.logger.error('Error clicking element:', error);

      let errorCode = 'CLICK_FAILED';
      let errorMessage = 'Failed to click element';

      if (error instanceof Error) {
        errorMessage = error.message;

        // Classify error types
        if (error.message.includes('not found')) {
          errorCode = 'ELEMENT_NOT_FOUND';
        } else if (error.message.includes('not clickable')) {
          errorCode = 'ELEMENT_NOT_CLICKABLE';
        } else if (error.message.includes('timeout')) {
          errorCode = 'CLICK_TIMEOUT';
        } else if (error.message.includes('detached')) {
          errorCode = 'ELEMENT_DETACHED';
        }
      }

      return {
        error: {
          code: -32603,
          message: errorMessage,
          data: {
            error_code: errorCode,
            stack: error instanceof Error ? error.stack : undefined,
          },
        },
      };
    }
  };

  /**
   * Click an element by its index
   *
   * @param page The page instance to interact with
   * @param elementIndex The index of the element to click
   * @returns Promise resolving to click result with element information
   */
  private async clickElement(
    page: any,
    elementIndex: number,
  ): Promise<{
    elementInfo: any;
  }> {
    // Get the DOM element by index
    const domElement = page.getDomElementByIndex(elementIndex);
    if (!domElement) {
      throw new Error(`Element with index ${elementIndex} not found in DOM state`);
    }

    // Extract element information for response
    const elementInfo = {
      tag_name: domElement.tagName,
      text: domElement.text || domElement.value || '',
      type: domElement.type,
      role: domElement.role,
      aria_label: domElement.ariaLabel,
      class: domElement.class,
      id: domElement.id,
    };

    // Locate the element on the page
    const elementHandle = await page.locateElement(domElement);
    if (!elementHandle) {
      throw new Error(`Element with index ${elementIndex} could not be located on the page`);
    }

    // Check if element is visible and clickable
    const isVisible = await elementHandle.evaluate((el: Element) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        style.opacity !== '0'
      );
    });

    if (!isVisible) {
      throw new Error(`Element with index ${elementIndex} is not visible or clickable`);
    }

    // Scroll element into view if needed
    await elementHandle.evaluate((el: Element) => {
      el.scrollIntoView({
        behavior: 'instant',
        block: 'center',
        inline: 'center',
      });
    });

    // Wait a moment for scroll to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // Perform the click
    try {
      await elementHandle.click();
      this.logger.debug(`Successfully clicked element at index ${elementIndex}`, elementInfo);
    } catch (clickError) {
      // If normal click fails, try JavaScript click as fallback
      this.logger.error(`Normal click failed for element ${elementIndex}, trying JavaScript click`, clickError);

      await elementHandle.evaluate((el: HTMLElement) => {
        el.click();
      });

      this.logger.debug(`JavaScript click succeeded for element at index ${elementIndex}`, elementInfo);
    }

    return {
      elementInfo,
    };
  }

  /**
   * Get the current URL of the page
   *
   * @param page The page instance
   * @returns Promise resolving to the current URL
   */
  private async getCurrentUrl(page: any): Promise<string> {
    try {
      if (page._puppeteerPage) {
        return await page._puppeteerPage.url();
      }
      return 'unknown';
    } catch (error) {
      this.logger.error('Failed to get current URL:', error);
      return 'unknown';
    }
  }
}
