/**
 * Navigate To Handler for MCP Host RPC Requests
 *
 * This file implements the navigate_to RPC method handler for the browser extension.
 * It receives navigation requests from the MCP Host and performs the URL navigation.
 */

import type BrowserContext from '../browser/context';
import { createLogger } from '../log';
import type { RpcHandler, RpcRequest, RpcResponse } from '../mcp/host-manager';

/**
 * Interface for navigate_to request parameters
 */
interface NavigateToParams {
  /**
   * The URL to navigate to
   */
  url: string;
  /**
   * Navigation timeout: 'auto' for intelligent detection or timeout in milliseconds (e.g. '5000')
   */
  timeout?: string;
}

/**
 * Handler for the 'navigate_to' RPC method
 *
 * This handler processes navigation requests from the MCP Host and performs
 * browser navigation to the specified URL with intelligent timeout handling.
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
   * Parse timeout parameter and return appropriate timeout value
   *
   * @param timeoutStr The timeout string parameter
   * @returns Timeout in milliseconds
   */
  private parseTimeout(timeoutStr: string = 'auto'): number {
    if (timeoutStr === 'auto') {
      // Auto mode: Use 30 seconds as a reasonable default for navigation
      return 30000;
    }

    // Try to parse as number (milliseconds)
    const parsedTimeout = parseInt(timeoutStr, 10);
    if (isNaN(parsedTimeout) || parsedTimeout < 1000 || parsedTimeout > 120000) {
      throw new Error('timeout must be between 1000 and 120000 milliseconds');
    }

    return parsedTimeout;
  }

  /**
   * Enhanced navigation with timeout and intelligent waiting
   *
   * @param url The URL to navigate to
   * @param timeoutMs Timeout in milliseconds
   */
  private async navigateWithTimeout(url: string, timeoutMs: number): Promise<void> {
    const page = await this.browserContext.getCurrentPage();

    if (!page) {
      // If no current page, create a new tab
      await this.browserContext.openTab(url);
      return;
    }

    // If page is attached (using Puppeteer), use Puppeteer navigation
    if (page.attached) {
      await page.navigateTo(url);
      return;
    }

    // Use Chrome tabs API with custom timeout
    const tabId = page.tabId;

    // Create a promise that implements the navigation with timeout
    const navigationPromise = new Promise<void>((resolve, reject) => {
      let hasResolved = false;

      // Set up timeout
      const timeoutId = setTimeout(() => {
        if (!hasResolved) {
          hasResolved = true;
          reject(new Error(`Navigation timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      // Track navigation completion
      let hasUrl = false;
      let hasTitle = false;
      let isComplete = false;

      const checkCompletion = () => {
        if (hasUrl && hasTitle && isComplete && !hasResolved) {
          hasResolved = true;
          clearTimeout(timeoutId);
          chrome.tabs.onUpdated.removeListener(onUpdatedHandler);
          resolve();
        }
      };

      const onUpdatedHandler = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (updatedTabId !== tabId || hasResolved) return;

        if (changeInfo.url) hasUrl = true;
        if (changeInfo.title) hasTitle = true;
        if (changeInfo.status === 'complete') isComplete = true;

        checkCompletion();
      };

      chrome.tabs.onUpdated.addListener(onUpdatedHandler);

      // Start navigation
      chrome.tabs
        .update(tabId, { url, active: true })
        .then(() => {
          // Check if already complete
          chrome.tabs
            .get(tabId)
            .then(tab => {
              if (hasResolved) return;

              if (tab.url) hasUrl = true;
              if (tab.title) hasTitle = true;
              if (tab.status === 'complete') isComplete = true;

              checkCompletion();
            })
            .catch(err => {
              if (!hasResolved) {
                hasResolved = true;
                clearTimeout(timeoutId);
                chrome.tabs.onUpdated.removeListener(onUpdatedHandler);
                reject(err);
              }
            });
        })
        .catch(err => {
          if (!hasResolved) {
            hasResolved = true;
            clearTimeout(timeoutId);
            chrome.tabs.onUpdated.removeListener(onUpdatedHandler);
            reject(err);
          }
        });
    });

    await navigationPromise;

    // Reattach the page after navigation completes
    const updatedTab = await chrome.tabs.get(tabId);
    const updatedPage = await (this.browserContext as any)._getOrCreatePage(updatedTab, true);
    await this.browserContext.attachPage(updatedPage);
    (this.browserContext as any)._currentTabId = tabId;
  }

  /**
   * Handle a navigate_to RPC request
   *
   * @param request RPC request containing the URL and optional timeout
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

      // Parse timeout parameter
      let timeoutMs: number;
      try {
        timeoutMs = this.parseTimeout(params.timeout);
      } catch (error) {
        return {
          error: {
            code: -32602,
            message: error instanceof Error ? error.message : 'Invalid timeout parameter',
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

      this.logger.info('Navigating to URL with timeout:', {
        url,
        timeout: params.timeout || 'auto',
        timeoutMs,
      });

      // Navigate to the URL with enhanced timeout handling
      await this.navigateWithTimeout(url, timeoutMs);

      return {
        result: {
          success: true,
          message: `Successfully navigated to ${url}`,
          url,
          strategy: params.timeout || 'auto',
          timeoutUsed: timeoutMs,
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
