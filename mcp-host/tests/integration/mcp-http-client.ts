import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { URL } from 'url';
import { createLogger } from '../../src/logger';

/**
 * MCP HTTP client for testing the MCP HTTP server
 * Uses the official @modelcontextprotocol/sdk client internally
 * but maintains the same interface as the original MockMcpHttpClient
 */
export class McpHttpClient {
  private logger = createLogger('mcp-http-client');
  private baseUrl: string;
  private sessionId: string | null = null;
  private client: Client;
  private transport: StreamableHTTPClientTransport | SSEClientTransport | null = null;
  private notifications: any[] = [];
  private nextRequestId = 1;

  /**
   * Create a new MCP HTTP client
   * @param baseUrl The base URL of the MCP server
   */
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;

    // Try to connect using Streamable HTTP first
    this.client = new Client({
      name: 'mcp-test-client',
      version: '1.0.0',
    });
  }

  /**
   * Initialize a session with the MCP server
   */
  public async initialize(): Promise<void> {
    try {
      this.logger.info('initialize with baseURL:', this.baseUrl);

      this.transport = new StreamableHTTPClientTransport(new URL(this.baseUrl));

      // Connect and initialize
      await this.client.connect(this.transport);
      this.logger.info('Connected using Streamable HTTP transport');

      // Store session ID if available
      if (this.transport && 'sessionId' in this.transport) {
        this.sessionId = (this.transport as any).sessionId;
      }
    } catch (error) {
      // If that fails with a 4xx error, try the older SSE transport
      this.logger.error('Streamable HTTP connection failed, falling back to SSE transport', error);

      const sseTransport = new SSEClientTransport(new URL(this.baseUrl));
      await this.client.connect(sseTransport);
      this.logger.info('Connected using SSE transport');
    }
  }

  /**
   * List available resources
   */
  public async listResources(): Promise<any> {
    return await this.client.listResources();
  }

  /**
   * List available tools
   */
  public async listTools(): Promise<any> {
    return await this.client.listTools();
  }

  /**
   * Read a resource
   * @param uri The URI of the resource to read
   */
  public async readResource(uri: string): Promise<any> {
    return await this.client.readResource({
      uri: uri,
    });
  }

  /**
   * Call a tool
   * @param name The name of the tool to call
   * @param params The parameters to pass to the tool
   */
  public async callTool(name: string, params: any): Promise<any> {
    return await this.client.callTool({
      name,
      params,
    });
  }

  /**
   * Close the session
   */
  public async close(): Promise<void> {
    try {
      await this.client.close();
    } catch (error) {
      this.logger.error('Error closing SDK client:', error);
    }

    this.transport = null;
  }

  /**
   * Get the current session ID
   */
  public getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Get all received notifications
   */
  public getNotifications(): any[] {
    return [...this.notifications];
  }

  /**
   * Clear all notifications
   */
  public clearNotifications(): void {
    this.notifications = [];
  }

  /**
   * Get the next request ID
   */
  private getNextRequestId(): number {
    return this.nextRequestId++;
  }
}
