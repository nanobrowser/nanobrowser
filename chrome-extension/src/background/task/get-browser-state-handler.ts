/**
 * Get Browser State Handler for MCP Host RPC Requests
 *
 * This file implements the get_browser_state RPC method handler for the browser extension.
 * It responds to requests from the MCP Host that need the current browser state.
 */

import type BrowserContext from '../browser/context';
import { createLogger } from '../log';
import type { RpcHandler, RpcRequest, RpcResponse } from '../mcp/host-manager';
import { DOMElementNode, DOMTextNode, domElementNodeToDict } from '../dom/views';

/**
 * Handler for the 'get_browser_state' RPC method
 *
 * This handler processes browser state requests from the MCP Host and returns
 * the current browser state information.
 */
export class GetBrowserStateHandler {
  private logger = createLogger('GetBrowserStateHandler');

  /**
   * Creates a new GetBrowserStateHandler instance
   *
   * @param browserContext The browser context for accessing browser state
   */
  constructor(private readonly browserContext: BrowserContext) {}

  /**
   * Handle a get_browser_state RPC request
   *
   * @param request RPC request
   * @returns Promise resolving to an RPC response with the browser state
   */
  /**
   * Converts a DOM element tree to a simplified format for the MCP host
   *
   * @param tree The DOM element tree to convert
   * @returns A simplified representation of the DOM tree
   */
  private domElementNodeToSimplifiedFormat(tree: DOMElementNode): any {
    // Extract interactive elements with highlight indices
    const interactiveElements = [];
    // Queue for breadth-first search
    const queue: DOMElementNode[] = [tree];

    while (queue.length > 0) {
      const node = queue.shift();
      if (!node) continue;

      // Add interactive elements with highlight indices
      if (node.isInteractive && node.highlightIndex !== null) {
        interactiveElements.push({
          index: node.highlightIndex,
          tagName: node.tagName,
          text: node.getAllTextTillNextClickableElement(),
          attributes: { ...node.attributes },
          isInViewport: node.isInViewport,
        });
      }

      // Add children to queue
      for (const child of node.children) {
        if (child instanceof DOMElementNode) {
          queue.push(child);
        }
      }
    }

    return {
      interactiveElements,
      // Include simplified tree structure using the existing utility
      fullTree: domElementNodeToDict(tree),
    };
  }

  public handleGetBrowserState: RpcHandler = async (request: RpcRequest): Promise<RpcResponse> => {
    this.logger.debug('Received get_browser_state request:', request);

    try {
      // Get the full browser state from browserContext
      const fullState = await this.browserContext.getState(true);

      // Extract and format the data for the MCP host BrowserState format
      // Format the browser state in a simplified structure for the MCP host
      const browserState = {
        activeTab: {
          id: fullState.tabId,
        },
        tabs: fullState.tabs.map(tab => ({
          id: tab.id,
          url: tab.url,
          title: tab.title,
          active: tab.id === fullState.tabId,
        })),
      };

      this.logger.debug('Returning browser state for MCP host');

      return {
        result: browserState,
      };
    } catch (error) {
      this.logger.error('Error getting browser state:', error);

      return {
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Unknown error retrieving browser state',
          data: { stack: error instanceof Error ? error.stack : undefined },
        },
      };
    }
  };
}
