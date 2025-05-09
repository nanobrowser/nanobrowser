import BrowserContext from '../browser/context';
import { createLogger } from '../log';
import { mcpClient } from './client';

const logger = createLogger('mcp-service');

/**
 * MCP Service
 * Connects the browser context with the MCP native client
 */
export class McpService {
  private browserContext: BrowserContext;
  private updateStateInterval: ReturnType<typeof setInterval> | null = null;
  private isUpdateRunning: boolean = false;

  constructor(browserContext: BrowserContext) {
    this.browserContext = browserContext;
    this.setupActionHandler();
  }

  /**
   * Initialize the MCP service
   */
  public async initialize(): Promise<boolean> {
    try {
      // Try to connect to the native host
      const connected = await mcpClient.connect();
      if (!connected) {
        logger.error('Failed to initialize MCP service: could not connect to native host');
        return false;
      }

      // Start state update interval
      this.startStateUpdates();

      logger.info('MCP service initialized successfully');
      return true;
    } catch (error) {
      logger.error(`Failed to initialize MCP service: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Start sending periodic state updates to the MCP host
   */
  private startStateUpdates(): void {
    if (this.updateStateInterval) {
      clearInterval(this.updateStateInterval);
    }

    // Send state immediately
    this.sendStateUpdate().catch(error => {
      logger.error(`Error sending initial state update: ${error instanceof Error ? error.message : String(error)}`);
    });

    // Set interval for regular updates (every 2 seconds)
    this.updateStateInterval = setInterval(() => {
      if (!this.isUpdateRunning) {
        this.sendStateUpdate().catch(error => {
          logger.error(`Error sending state update: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    }, 2000);
  }

  /**
   * Stop state updates
   */
  public stopStateUpdates(): void {
    if (this.updateStateInterval) {
      clearInterval(this.updateStateInterval);
      this.updateStateInterval = null;
    }
  }

  /**
   * Close the MCP service
   */
  public async close(): Promise<void> {
    this.stopStateUpdates();
    mcpClient.disconnect();
  }

  /**
   * Send browser state update to the MCP host
   */
  private async sendStateUpdate(): Promise<void> {
    try {
      this.isUpdateRunning = true;

      // Get current tab
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab || !activeTab.id) {
        // No active tab, can't send update
        this.isUpdateRunning = false;
        return;
      }

      // Get browser state
      let state;
      try {
        state = await this.browserContext.getState();
      } catch (error) {
        logger.error(`Failed to get browser state: ${error instanceof Error ? error.message : String(error)}`);
        this.isUpdateRunning = false;
        return;
      }

      // Get all tabs
      const tabs = await chrome.tabs.query({});
      const tabInfos = tabs.map(tab => ({
        id: tab.id,
        url: tab.url,
        title: tab.title,
        active: tab.active,
      }));

      // Extract DOM state
      const elementTree = state.elementTree ? state.elementTree : null;

      // Create state object
      const browserState = {
        activeTab: {
          id: activeTab.id,
          url: activeTab.url,
          title: activeTab.title,
          domState: elementTree,
        },
        tabs: tabInfos,
        screenshot: state.screenshot,
      };

      // Send to MCP host
      await mcpClient.setBrowserState(browserState);
      logger.debug('Sent browser state update to MCP host');
    } catch (error) {
      logger.error(`Error in sendStateUpdate: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.isUpdateRunning = false;
    }
  }

  /**
   * Find elements in the DOM tree that match a CSS selector (simplified version)
   * In a real implementation, we would use a proper CSS selector parser
   */
  private findElementsBySelector(elementTree: any, selector: string): any[] {
    const matchingElements: any[] = [];

    // Simple selector parsing (this is a very basic implementation)
    // In a real implementation, you would use a CSS selector parser library
    let tagName = '';
    let id = '';
    let className = '';

    // Parse ID selector (#id)
    const idMatch = selector.match(/#([a-zA-Z0-9_-]+)/);
    if (idMatch) {
      id = idMatch[1];
    }

    // Parse class selector (.class)
    const classMatch = selector.match(/\.([a-zA-Z0-9_-]+)/);
    if (classMatch) {
      className = classMatch[1];
    }

    // Parse tag selector (tag)
    const tagMatch = selector.match(/^[a-zA-Z0-9_-]+/);
    if (tagMatch) {
      tagName = tagMatch[0];
    }

    // Recursive function to find elements in the tree
    const findElements = (node: any) => {
      if (!node) return;

      // Check if this node matches the selector
      let matches = true;

      if (tagName && node.tagName && node.tagName.toLowerCase() !== tagName.toLowerCase()) {
        matches = false;
      }

      if (id && node.attributes && node.attributes.id !== id) {
        matches = false;
      }

      if (className && node.attributes && node.attributes.class) {
        const classes = node.attributes.class.split(' ');
        if (!classes.includes(className)) {
          matches = false;
        }
      }

      if (matches) {
        matchingElements.push(node);
      }

      // Check children
      if (node.children) {
        for (const child of node.children) {
          findElements(child);
        }
      }
    };

    findElements(elementTree);
    return matchingElements;
  }

  /**
   * Set up action handler for executing browser operations
   */
  private setupActionHandler(): void {
    mcpClient.registerHandler('executeAction', async message => {
      try {
        if (!message.action || !message.params) {
          logger.error('Invalid action request: missing action or params');
          return;
        }

        logger.info(`Executing action: ${message.action}`, message.params);

        // Execute the action based on type
        switch (message.action) {
          case 'navigate': {
            if (!message.params.url) {
              logger.error('Invalid navigate action: missing URL');
              return;
            }

            try {
              const page = await this.browserContext.getCurrentPage();
              await page.navigateTo(message.params.url);
              logger.info(`Navigated to: ${message.params.url}`);
            } catch (error) {
              logger.error(`Failed to navigate: ${error instanceof Error ? error.message : String(error)}`);
            }
            break;
          }

          case 'click': {
            if (!message.params.selector) {
              logger.error('Invalid click action: missing selector');
              return;
            }

            try {
              const page = await this.browserContext.getCurrentPage();
              // We need to find elements by selector in the DOM state
              const state = await this.browserContext.getState();
              const elementTree = state.elementTree;

              if (!elementTree) {
                logger.error('No element tree available');
                return;
              }

              // Find elements that match the selector (this is simplified)
              // In a real implementation, we would parse the selector and find matching elements
              // For now, look for elements with matching tag/id/class as a basic example
              const selector = message.params.selector;
              const matchingElements = this.findElementsBySelector(elementTree, selector);

              if (matchingElements.length === 0) {
                logger.error(`No elements found for selector: ${selector}`);
                return;
              }

              // Click the first matching element
              await page.clickElementNode(false, matchingElements[0]);
              logger.info(`Clicked element with selector: ${message.params.selector}`);
            } catch (error) {
              logger.error(`Failed to click element: ${error instanceof Error ? error.message : String(error)}`);
            }
            break;
          }

          default:
            logger.error(`Unknown action: ${message.action}`);
        }
      } catch (error) {
        logger.error(`Error handling action: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }
}

// Create the MCP service singleton instance
let mcpService: McpService | null = null;

export function initializeMcpService(browserContext: BrowserContext): Promise<boolean> {
  if (mcpService) {
    return Promise.resolve(true);
  }

  mcpService = new McpService(browserContext);
  return mcpService.initialize();
}

export function getMcpService(): McpService | null {
  return mcpService;
}

export function closeMcpService(): Promise<void> {
  if (mcpService) {
    return mcpService.close();
  }
  return Promise.resolve();
}
