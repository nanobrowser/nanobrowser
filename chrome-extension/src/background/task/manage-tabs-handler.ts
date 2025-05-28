/**
 * Manage Tabs Handler for MCP Host RPC Requests
 *
 * This file implements the manage_tabs RPC method handler for the browser extension.
 * It receives tab management requests from the MCP Host and performs tab operations
 * like switching, opening, and closing tabs.
 */

import type BrowserContext from '../browser/context';
import { createLogger } from '../log';
import type { RpcHandler, RpcRequest, RpcResponse } from '../mcp/host-manager';

/**
 * Interface for manage_tabs request parameters
 */
interface ManageTabsParams {
  /**
   * The tab operation to perform
   */
  action: 'switch' | 'open' | 'close';
  /**
   * Target tab ID (required for switch and close actions)
   */
  tab_id?: string;
  /**
   * URL to open (required for open action)
   */
  url?: string;
  /**
   * Open tab in background without switching focus (for open action)
   */
  background?: boolean;
}

/**
 * Handler for the 'manage_tabs' RPC method
 *
 * This handler processes tab management requests from the MCP Host and performs
 * browser tab operations including switching between tabs, opening new tabs,
 * and closing existing tabs.
 */
export class ManageTabsHandler {
  private logger = createLogger('ManageTabsHandler');

  /**
   * Creates a new ManageTabsHandler instance
   *
   * @param browserContext The browser context for tab management
   */
  constructor(private readonly browserContext: BrowserContext) {}

  /**
   * Handle switching to a specific tab
   *
   * @param tabId The ID of the tab to switch to
   */
  private async handleSwitchTab(tabId: string): Promise<any> {
    const tabIdNum = parseInt(tabId, 10);
    if (isNaN(tabIdNum)) {
      throw new Error(`Invalid tab ID: ${tabId}. Must be a valid number.`);
    }

    this.logger.info('Switching to tab', { tabId: tabIdNum });

    // Check if tab exists
    try {
      await chrome.tabs.get(tabIdNum);
    } catch (error) {
      throw new Error(`Tab with ID ${tabId} not found`);
    }

    // Switch to the tab using BrowserContext
    await this.browserContext.switchTab(tabIdNum);

    return {
      success: true,
      message: `Successfully switched to tab ${tabId}`,
      tab_id: tabId,
    };
  }

  /**
   * Handle opening a new tab
   *
   * @param url The URL to open
   * @param background Whether to open in background
   */
  private async handleOpenTab(url: string, background: boolean = false): Promise<any> {
    this.logger.info('Opening new tab', { url, background });

    // Validate URL format
    let normalizedUrl = url;
    try {
      // Make sure the URL has a protocol
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        normalizedUrl = 'https://' + url;
      }
      // Check if the URL is valid
      new URL(normalizedUrl);
    } catch (error) {
      throw new Error(`Invalid URL: ${url}`);
    }

    let newTab: chrome.tabs.Tab;

    if (background) {
      // Open tab in background without switching focus
      newTab = await chrome.tabs.create({
        url: normalizedUrl,
        active: false,
      });

      // Wait for the tab to load
      await this.waitForTabToLoad(newTab.id!);
    } else {
      // Use BrowserContext's openTab method which handles focusing and attachment
      const page = await this.browserContext.openTab(normalizedUrl);
      newTab = await chrome.tabs.get(page.tabId);
    }

    return {
      success: true,
      message: `Successfully opened new tab with URL: ${normalizedUrl}`,
      new_tab_id: newTab.id!.toString(),
      url: normalizedUrl,
      background,
    };
  }

  /**
   * Handle closing a specific tab
   *
   * @param tabId The ID of the tab to close
   */
  private async handleCloseTab(tabId: string): Promise<any> {
    const tabIdNum = parseInt(tabId, 10);
    if (isNaN(tabIdNum)) {
      throw new Error(`Invalid tab ID: ${tabId}. Must be a valid number.`);
    }

    this.logger.info('Closing tab', { tabId: tabIdNum });

    // Check if tab exists
    try {
      await chrome.tabs.get(tabIdNum);
    } catch (error) {
      throw new Error(`Tab with ID ${tabId} not found`);
    }

    // Close the tab using BrowserContext
    await this.browserContext.closeTab(tabIdNum);

    return {
      success: true,
      message: `Successfully closed tab ${tabId}`,
      tab_id: tabId,
    };
  }

  /**
   * Wait for a tab to finish loading
   *
   * @param tabId The ID of the tab to wait for
   * @param timeoutMs Timeout in milliseconds
   */
  private async waitForTabToLoad(tabId: number, timeoutMs: number = 30000): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let hasUrl = false;
      let hasTitle = false;
      let isComplete = false;

      const timeoutId = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdatedHandler);
        reject(new Error(`Tab loading timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const checkCompletion = () => {
        if (hasUrl && hasTitle && isComplete) {
          clearTimeout(timeoutId);
          chrome.tabs.onUpdated.removeListener(onUpdatedHandler);
          resolve();
        }
      };

      const onUpdatedHandler = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (updatedTabId !== tabId) return;

        if (changeInfo.url) hasUrl = true;
        if (changeInfo.title) hasTitle = true;
        if (changeInfo.status === 'complete') isComplete = true;

        checkCompletion();
      };

      chrome.tabs.onUpdated.addListener(onUpdatedHandler);

      // Check current state
      chrome.tabs
        .get(tabId)
        .then(tab => {
          if (tab.url) hasUrl = true;
          if (tab.title) hasTitle = true;
          if (tab.status === 'complete') isComplete = true;

          checkCompletion();
        })
        .catch(err => {
          clearTimeout(timeoutId);
          chrome.tabs.onUpdated.removeListener(onUpdatedHandler);
          reject(err);
        });
    });
  }

  /**
   * Handle a manage_tabs RPC request
   *
   * @param request RPC request containing the tab management parameters
   * @returns Promise resolving to an RPC response with the operation result
   */
  public handleManageTabs: RpcHandler = async (request: RpcRequest): Promise<RpcResponse> => {
    this.logger.debug('Received manage_tabs request:', request);

    try {
      const params = request.params as ManageTabsParams;

      if (!params || !params.action) {
        return {
          error: {
            code: -32602,
            message: 'Invalid params: action is required',
          },
        };
      }

      let result: any;

      switch (params.action) {
        case 'switch':
          if (!params.tab_id) {
            return {
              error: {
                code: -32602,
                message: 'Invalid params: tab_id is required for switch action',
              },
            };
          }
          result = await this.handleSwitchTab(params.tab_id);
          break;

        case 'open':
          if (!params.url) {
            return {
              error: {
                code: -32602,
                message: 'Invalid params: url is required for open action',
              },
            };
          }
          result = await this.handleOpenTab(params.url, params.background || false);
          break;

        case 'close':
          if (!params.tab_id) {
            return {
              error: {
                code: -32602,
                message: 'Invalid params: tab_id is required for close action',
              },
            };
          }
          result = await this.handleCloseTab(params.tab_id);
          break;

        default:
          return {
            error: {
              code: -32602,
              message: `Invalid action: ${params.action}. Must be one of: switch, open, close`,
            },
          };
      }

      return {
        result,
      };
    } catch (error) {
      this.logger.error('Error managing tabs:', error);

      return {
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Unknown error during tab management',
          data: { stack: error instanceof Error ? error.stack : undefined },
        },
      };
    }
  };
}
