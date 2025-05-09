import { createLogger } from '../log';

const logger = createLogger('mcp-client');

export interface NativeMessage {
  type: string;
  [key: string]: any;
}

export interface ActionResult {
  success: boolean;
  message?: string;
  data?: any;
}

/**
 * MCP Native Messaging Client
 * Manages communication with the Native Messaging Host
 */
export class McpNativeClient {
  private port: chrome.runtime.Port | null = null;
  private nativeHostName: string = 'nanobrowser.mcp.host';
  private connected: boolean = false;
  private messageHandlers: Map<string, (message: any) => void> = new Map();
  private responsePromises: Map<string, { resolve: (data: any) => void; reject: (error: Error) => void }> = new Map();
  private requestId: number = 0;

  constructor() {
    this.setupMessageHandlers();
  }

  /**
   * Connect to the Native Messaging Host
   */
  public async connect(): Promise<boolean> {
    if (this.connected) {
      return true;
    }

    try {
      logger.info(`Connecting to native host: ${this.nativeHostName}`);
      this.port = chrome.runtime.connectNative(this.nativeHostName);

      // Set up message listeners
      this.port.onMessage.addListener(this.handleNativeMessage.bind(this));

      // Set up disconnect handler
      this.port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        logger.error(`Native host disconnected: ${error?.message || 'Unknown error'}`);
        this.connected = false;
        this.port = null;

        // Reject all pending promises
        for (const [, { reject }] of this.responsePromises) {
          reject(new Error('Native host disconnected'));
        }
        this.responsePromises.clear();
      });

      this.connected = true;
      logger.info(`Connected to native host: ${this.nativeHostName}`);
      return true;
    } catch (error) {
      logger.error(`Failed to connect to native host: ${error instanceof Error ? error.message : String(error)}`);
      this.connected = false;
      this.port = null;
      return false;
    }
  }

  /**
   * Disconnect from the Native Messaging Host
   */
  public disconnect(): void {
    if (this.port) {
      this.port.disconnect();
      this.port = null;
      this.connected = false;
      logger.info('Disconnected from native host');
    }
  }

  /**
   * Send a message to the Native Messaging Host
   */
  public async sendMessage(message: NativeMessage): Promise<any> {
    if (!this.connected) {
      const connected = await this.connect();
      if (!connected) {
        throw new Error('Failed to connect to native host');
      }
    }

    if (!this.port) {
      throw new Error('Native host connection not established');
    }

    const id = this.getNextRequestId();
    const messageWithId = { ...message, id };

    return new Promise((resolve, reject) => {
      // Store the promise handlers
      this.responsePromises.set(id, { resolve, reject });

      // Send the message
      try {
        this.port!.postMessage(messageWithId);
        logger.debug(`Sent message to native host: ${JSON.stringify(messageWithId)}`);
      } catch (error) {
        this.responsePromises.delete(id);
        reject(error);
      }

      // Set a timeout to prevent hanging
      setTimeout(() => {
        if (this.responsePromises.has(id)) {
          this.responsePromises.delete(id);
          reject(new Error(`Request timed out: ${messageWithId.type}`));
        }
      }, 30000); // 30 second timeout
    });
  }

  /**
   * Register a handler for a specific message type
   */
  public registerHandler(type: string, handler: (message: any) => void): void {
    this.messageHandlers.set(type, handler);
  }

  /**
   * Handle a message from the Native Messaging Host
   */
  private handleNativeMessage(message: any): void {
    logger.debug(`Received message from native host: ${JSON.stringify(message)}`);

    // Check if it's a response to a request
    if (message.id && this.responsePromises.has(message.id)) {
      const { resolve, reject } = this.responsePromises.get(message.id)!;
      this.responsePromises.delete(message.id);

      if (message.type === 'error') {
        reject(new Error(message.error || 'Unknown error'));
      } else {
        resolve(message);
      }
      return;
    }

    // Check if it's a message for a registered handler
    if (message.type && this.messageHandlers.has(message.type)) {
      const handler = this.messageHandlers.get(message.type)!;
      try {
        handler(message);
      } catch (error) {
        logger.error(
          `Error in message handler for ${message.type}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Set up message handlers
   */
  private setupMessageHandlers(): void {
    // Action request handler
    this.registerHandler('executeAction', message => {
      // This will be dispatched to the browser context
      logger.info(`Received action request: ${JSON.stringify(message)}`);
      // Implementation will be added later
    });
  }

  /**
   * Get the next request ID
   */
  private getNextRequestId(): string {
    return `req_${++this.requestId}`;
  }

  /**
   * Set browser state in the MCP host
   */
  public async setBrowserState(state: any): Promise<ActionResult> {
    try {
      const response = await this.sendMessage({
        type: 'setBrowserState',
        state,
      });

      return {
        success: true,
        message: 'Browser state updated',
        data: response,
      };
    } catch (error) {
      logger.error(`Failed to set browser state: ${error instanceof Error ? error.message : String(error)}`);
      return {
        success: false,
        message: `Failed to set browser state: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * List MCP resources
   */
  public async listResources(): Promise<any> {
    try {
      const response = await this.sendMessage({
        type: 'listResources',
      });
      return response;
    } catch (error) {
      logger.error(`Failed to list resources: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Read MCP resource
   */
  public async readResource(uri: string): Promise<any> {
    try {
      const response = await this.sendMessage({
        type: 'readResource',
        uri,
      });
      return response;
    } catch (error) {
      logger.error(`Failed to read resource '${uri}': ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * List MCP tools
   */
  public async listTools(): Promise<any> {
    try {
      const response = await this.sendMessage({
        type: 'listTools',
      });
      return response;
    } catch (error) {
      logger.error(`Failed to list tools: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Call MCP tool
   */
  public async callTool(name: string, args: any): Promise<any> {
    try {
      const response = await this.sendMessage({
        type: 'callTool',
        name,
        arguments: args,
      });
      return response;
    } catch (error) {
      logger.error(`Failed to call tool '${name}': ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}

// Create a singleton instance
export const mcpClient = new McpNativeClient();
