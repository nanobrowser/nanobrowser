import axios, { AxiosInstance } from 'axios';
import { EventSourcePolyfill } from 'event-source-polyfill';

/**
 * Mock MCP HTTP client for testing the MCP HTTP server
 * Implements the client side of the Streamable HTTP protocol
 */
export class MockMcpHttpClient {
  private baseUrl: string;
  private httpClient: AxiosInstance;
  private sessionId: string | null = null;
  private eventSource: EventSourcePolyfill | null = null;
  private notifications: any[] = [];
  private nextRequestId = 1;

  /**
   * Create a new mock MCP HTTP client
   * @param baseUrl The base URL of the MCP server
   */
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.httpClient = axios.create({
      baseURL: baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Initialize a session with the MCP server
   */
  public async initialize(): Promise<any> {
    const response = await this.httpClient.post('/mcp', {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        capabilities: {
          version: '0.1.0',
          protocols: ['streamable-http'],
        },
      },
      id: this.getNextRequestId(),
    });

    // Store the session ID for future requests
    if (response.headers['mcp-session-id']) {
      this.sessionId = response.headers['mcp-session-id'];

      // Set up server-sent events listener
      this.setupEventSource();
    }

    return response.data;
  }

  /**
   * List available resources
   */
  public async listResources(): Promise<any> {
    if (!this.sessionId) {
      throw new Error('Session not initialized');
    }

    const response = await this.httpClient.post(
      '/mcp',
      {
        jsonrpc: '2.0',
        method: 'listResources',
        params: {},
        id: this.getNextRequestId(),
      },
      {
        headers: {
          'mcp-session-id': this.sessionId,
        },
      },
    );

    return response.data;
  }

  /**
   * Read a resource
   * @param uri The URI of the resource to read
   */
  public async readResource(uri: string): Promise<any> {
    if (!this.sessionId) {
      throw new Error('Session not initialized');
    }

    const response = await this.httpClient.post(
      '/mcp',
      {
        jsonrpc: '2.0',
        method: 'readResource',
        params: {
          uri,
        },
        id: this.getNextRequestId(),
      },
      {
        headers: {
          'mcp-session-id': this.sessionId,
        },
      },
    );

    return response.data;
  }

  /**
   * Call a tool
   * @param name The name of the tool to call
   * @param params The parameters to pass to the tool
   */
  public async callTool(name: string, params: any): Promise<any> {
    if (!this.sessionId) {
      throw new Error('Session not initialized');
    }

    const response = await this.httpClient.post(
      '/mcp',
      {
        jsonrpc: '2.0',
        method: 'callTool',
        params: {
          name,
          parameters: params,
        },
        id: this.getNextRequestId(),
      },
      {
        headers: {
          'mcp-session-id': this.sessionId,
        },
      },
    );

    return response.data;
  }

  /**
   * Close the session
   */
  public async close(): Promise<void> {
    if (!this.sessionId) {
      return;
    }

    // Close the event source
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Send a DELETE request to terminate the session
    try {
      await this.httpClient.delete('/mcp', {
        headers: {
          'mcp-session-id': this.sessionId,
        },
      });
    } catch (error) {
      console.error('Error closing session:', error);
    }

    this.sessionId = null;
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

  /**
   * Set up server-sent events listener
   */
  private setupEventSource(): void {
    if (!this.sessionId) {
      return;
    }

    // Close existing event source if any
    if (this.eventSource) {
      this.eventSource.close();
    }

    // Create a new event source
    this.eventSource = new EventSourcePolyfill(`${this.baseUrl}/mcp`, {
      headers: {
        'mcp-session-id': this.sessionId,
      },
    });

    // Listen for messages
    this.eventSource.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        this.notifications.push(data);
      } catch (error) {
        console.error('Error parsing SSE message:', error);
      }
    };

    // Handle errors
    this.eventSource.onerror = error => {
      console.error('SSE error:', error);
    };
  }
}
