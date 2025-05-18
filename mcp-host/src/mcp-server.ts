import { ZodRawShape } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import { createLogger } from './logger.js';
import { type Resource, type Tool } from './types.js';

/**
 * Configuration for the MCP server
 */
export interface McpServerConfig {
  port: number;
  logLevel: string;
}

/**
 * Manages the MCP server and HTTP transport
 */
export class McpServerManager {
  private logger;
  private httpServer: any = null;
  private mcpServer: McpServer;
  private config: McpServerConfig;
  private registeredResources: Resource[] = [];
  private isRunning: boolean = false;

  /**
   * Creates a new MCP server manager
   * @param config The server configuration
   */
  constructor(config: McpServerConfig) {
    this.config = config;
    this.logger = createLogger('mcp-server');

    // Create MCP server instance
    this.mcpServer = new McpServer(
      {
        name: 'nanobrowser-mcp',
        version: '1.0.0',
      },
      { capabilities: { logging: {} } },
    );

    this.logger.info('MCP server manager initialized');
  }

  /**
   * Registers a resource with the MCP server
   * @param resource The resource to register
   */
  public registerResource(resource: Resource) {
    this.logger.info(`Registering resource: ${resource.uri}`);

    // Store the resource for listing
    this.registeredResources.push(resource);

    // Register the resource with the MCP server
    this.mcpServer.resource(resource.name, resource.uri, async () => {
      try {
        return await resource.read();
      } catch (error) {
        this.logger.error(`Error reading resource ${resource.uri}:`, error);
        throw error;
      }
    });

    this.logger.debug(`Resource registered: ${resource.uri}`);
  }

  /**
   * Registers a tool with the MCP server
   * @param tool The tool to register
   */
  public registerTool<Args extends ZodRawShape>(tool: Tool<Args>) {
    this.mcpServer.tool(tool.name, tool.description, tool.inputSchema, tool.execute);

    this.logger.debug(`Tool registered: ${tool.name}`);
  }

  /**
   * Starts the MCP server
   * @returns A promise that resolves when the server is started
   */
  public async start(): Promise<boolean> {
    if (this.isRunning) {
      this.logger.warn('MCP server is already running');
      return false;
    }

    try {
      // Start the HTTP server
      await this.startHttpServer();

      this.isRunning = true;
      this.logger.info(`MCP server started on port ${this.config.port}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to start MCP server:', error);
      return false;
    }
  }

  /**
   * Starts the HTTP server with SSEServerTransport
   */
  private async startHttpServer() {
    // Create Express application
    const app = express();

    // Initialize transports map to store session connections
    const transports: { [sessionId: string]: SSEServerTransport } = {};

    // Set up HTTP routes for MCP communication
    app.use(express.json());

    // SSE endpoint for establishing the stream
    app.get('/mcp', async (req, res) => {
      this.logger.info('Received GET request to /mcp (establishing SSE stream)');

      try {
        // Create a new SSE transport for the client
        // The endpoint for POST messages is '/messages'
        const transport = new SSEServerTransport('/messages', res);

        // Store the transport by session ID
        const sessionId = transport.sessionId;
        transports[sessionId] = transport;

        // Set up onclose handler to clean up transport when closed
        transport.onclose = () => {
          this.logger.debug(`SSE transport closed for session ${sessionId}`);
          delete transports[sessionId];
        };

        // Connect the transport to the MCP server
        await this.mcpServer.connect(transport);

        this.logger.info(`Established SSE stream with session ID: ${sessionId}`);
      } catch (error) {
        this.logger.error('Error establishing SSE stream:', error);
        if (!res.headersSent) {
          res.status(500).send('Error establishing SSE stream');
        }
      }
    });

    // Messages endpoint for receiving client JSON-RPC requests
    app.post('/messages', async (req, res) => {
      this.logger.debug('Received POST request to /messages, req body:', req.body);

      // Extract session ID from URL query parameter
      // In the SSE protocol, this is added by the client based on the endpoint event
      const sessionId = req.query.sessionId as string | undefined;

      if (!sessionId) {
        this.logger.warn('No session ID provided in request URL');
        res.status(400).send('Missing sessionId parameter');
        return;
      }

      const transport = transports[sessionId];
      if (!transport) {
        this.logger.warn(`No active transport found for session ID: ${sessionId}`);
        res.status(404).send('Session not found');
        return;
      }

      try {
        // Handle the POST message with the transport
        await transport.handlePostMessage(req, res, req.body);
      } catch (error) {
        this.logger.error('Error handling request:', error);
        if (!res.headersSent) {
          res.status(500).send('Error handling request');
        }
      }
    });

    // Start the HTTP server
    return new Promise<void>((resolve, reject) => {
      try {
        this.httpServer = app.listen(this.config.port, '127.0.0.1', () => {
          this.logger.info(`HTTP server listening on http://localhost:${this.config.port}`);
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Shuts down the MCP server
   * @returns A promise that resolves when the server is shut down
   */
  public async shutdown(): Promise<boolean> {
    if (!this.isRunning) {
      this.logger.warn('MCP server is not running');
      return false;
    }

    try {
      // Get all active transports (we need to get this before closing the server)
      const activeTransports = Object.values(
        this.httpServer?.address()
          ? // Using a type assertion because we can't directly access the transports map
            (this.httpServer as any)._events?.request?.transports || {}
          : {},
      ) as SSEServerTransport[];

      // Close all active transports to properly clean up resources
      if (activeTransports.length > 0) {
        this.logger.info(`Closing ${activeTransports.length} active transport(s)`);
        for (const transport of activeTransports) {
          try {
            await transport.close();
          } catch (error) {
            this.logger.error(`Error closing transport:`, error);
          }
        }
      }

      // Close the HTTP server
      if (this.httpServer) {
        await new Promise<void>(resolve => {
          this.httpServer.close(() => {
            this.logger.info('HTTP server closed');
            resolve();
          });
        });
        this.httpServer = null;
      }

      this.isRunning = false;
      this.logger.info('MCP server shutdown complete');
      return true;
    } catch (error) {
      this.logger.error('Error shutting down MCP server:', error);
      return false;
    }
  }

  /**
   * Gets the running status of the MCP server
   * @returns True if the server is running, false otherwise
   */
  public isServerRunning(): boolean {
    return this.isRunning;
  }

  public getMcpServer(): McpServer {
    return this.mcpServer;
  }
}
