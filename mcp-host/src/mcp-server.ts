import { BrowserResources } from './browser-resources';
import { ActionResult, BrowserTools } from './browser-tools';

// This is a simplified mock version of the MCP SDK Server since we don't have the actual SDK
export class McpServer {
  private browserResources: BrowserResources;
  private browserTools: BrowserTools;
  private callbacks: Map<string, Function> = new Map();

  constructor() {
    this.browserResources = new BrowserResources();
    this.browserTools = new BrowserTools();

    // Set up browser action callback to forward actions to extension
    this.browserTools.setBrowserActionCallback(async (action, params) => {
      // This will be implemented to send messages to the extension
      console.error(`Executing browser action: ${action}`, params);
      const result = await this.executeAction(action, params);
      return result;
    });
  }

  public setBrowserState(state: any) {
    this.browserResources.updateState(state);
  }

  private async executeAction(action: string, params: any): Promise<ActionResult> {
    // This would normally send a message to the extension
    const callback = this.callbacks.get('actionRequested');
    if (callback) {
      return callback(action, params) as Promise<ActionResult>;
    }

    return {
      success: false,
      message: 'No action handler registered',
    };
  }

  public registerActionCallback(callback: (action: string, params: any) => Promise<ActionResult>) {
    this.callbacks.set('actionRequested', callback);
  }

  // Handle MCP protocol request for listing resources
  public async handleListResources() {
    return {
      resources: this.browserResources.listResources(),
    };
  }

  // Handle MCP protocol request for reading a resource
  public async handleReadResource(uri: string) {
    try {
      return await this.browserResources.readResource(uri);
    } catch (error) {
      console.error('Error reading resource:', error);
      throw error;
    }
  }

  // Handle MCP protocol request for listing tools
  public async handleListTools() {
    return {
      tools: this.browserTools.listTools(),
    };
  }

  // Handle MCP protocol request for calling a tool
  public async handleCallTool(name: string, args: any) {
    try {
      return await this.browserTools.callTool(name, args);
    } catch (error) {
      console.error('Error calling tool:', error);
      throw error;
    }
  }
}
