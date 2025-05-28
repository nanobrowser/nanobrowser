/**
 * Get DOM State Handler for MCP Host RPC Requests
 *
 * This file implements the get_dom_state RPC method handler for the browser extension.
 * It responds to requests from the MCP Host that need the current DOM state in a human-readable format.
 */

import type BrowserContext from '../browser/context';
import { createLogger } from '../log';
import type { RpcHandler, RpcRequest, RpcResponse } from '../mcp/host-manager';
import { DOMElementNode } from '../dom/views';

/**
 * Handler for the 'get_dom_state' RPC method
 *
 * This handler processes DOM state requests from the MCP Host and returns
 * a user-friendly representation of the DOM state.
 */
export class GetDomStateHandler {
  private logger = createLogger('GetDomStateHandler');

  /**
   * Creates a new GetDomStateHandler instance
   *
   * @param browserContext The browser context for accessing DOM state
   */
  constructor(private readonly browserContext: BrowserContext) {}

  /**
   * Handle a get_dom_state RPC request
   *
   * @param request RPC request
   * @returns Promise resolving to an RPC response with the formatted DOM state
   */
  public handleGetDomState: RpcHandler = async (request: RpcRequest): Promise<RpcResponse> => {
    this.logger.debug('Received get_dom_state request:', request);

    try {
      // Get the browser state with vision enabled for better DOM coverage
      const browserState = await this.browserContext.getState(true);

      if (!browserState.elementTree) {
        return {
          error: {
            code: -32000,
            message: 'DOM state not available',
          },
        };
      }

      // Use the same method as Agent to generate human-readable DOM representation
      const interactiveElementsText = browserState.elementTree.clickableElementsToString([
        'role',
        'aria-label',
        'placeholder',
        'name',
        'type',
        'href',
      ]);

      // Add page position markers
      const hasContentAbove = (browserState.pixelsAbove || 0) > 0;
      const hasContentBelow = (browserState.pixelsBelow || 0) > 0;

      let formattedDomText = '';
      if (interactiveElementsText !== '') {
        if (hasContentAbove) {
          formattedDomText = `... ${browserState.pixelsAbove} pixels above - scroll up to see more ...\n${interactiveElementsText}`;
        } else {
          formattedDomText = `[Start of page]\n${interactiveElementsText}`;
        }

        if (hasContentBelow) {
          formattedDomText = `${formattedDomText}\n... ${browserState.pixelsBelow} pixels below - scroll down to see more ...`;
        } else {
          formattedDomText = `${formattedDomText}\n[End of page]\n`;
        }
      } else {
        formattedDomText = 'empty page';
      }

      // Extract interactive elements for easier operation
      const interactiveElements = this.extractInteractiveElements(browserState.elementTree);

      // Build structured DOM state response
      const domState = {
        // Human-readable DOM representation
        formattedDom: formattedDomText,

        // Structured element information
        interactiveElements,

        // Page metadata
        meta: {
          url: browserState.url,
          title: browserState.title,
          tabId: browserState.tabId,
          pixelsAbove: browserState.pixelsAbove,
          pixelsBelow: browserState.pixelsBelow,
        },
      };

      this.logger.debug('Returning formatted DOM state for MCP host');

      return {
        result: domState,
      };
    } catch (error) {
      this.logger.error('Error getting DOM state:', error);

      return {
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Unknown error retrieving DOM state',
          data: { stack: error instanceof Error ? error.stack : undefined },
        },
      };
    }
  };

  /**
   * Extract interactive elements from the DOM tree
   *
   * @param tree The DOM element tree
   * @returns Array of interactive elements with metadata
   */
  private extractInteractiveElements(tree: DOMElementNode): any[] {
    const interactiveElements: any[] = [];

    // Use breadth-first search to traverse the DOM tree
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
          selector: node.getEnhancedCssSelector(),
          isNew: node.isNew,
        });
      }

      // Add children to queue
      for (const child of node.children) {
        if (child instanceof DOMElementNode) {
          queue.push(child);
        }
      }
    }

    return interactiveElements;
  }
}
