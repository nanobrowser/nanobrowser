import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { randomUUID } from 'crypto';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createLogger, LogLevel, Logger } from './logger.js';
import { BrowserResources } from './browser-resources.js';
import { BrowserTools, ActionCallback } from './browser-tools.js';

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
  private browserResources: BrowserResources;
  private browserTools: BrowserTools;
  private isRunning: boolean = false;

  /**
   * Creates a new MCP server manager
   * @param config The server configuration
   */
  constructor(config: McpServerConfig) {
    this.config = config;
    this.logger = createLogger('mcp-server');

    // Set the log level based on the config
    this.setLogLevel(config.logLevel);

    // Initialize browser resources and tools
    this.browserResources = new BrowserResources();
    this.browserTools = new BrowserTools();

    // Create MCP server instance
    this.mcpServer = new McpServer({
      name: 'nanobrowser-mcp',
      version: '1.0.0',
    });

    this.logger.info('MCP server manager initialized');
  }

  /**
   * Sets the browser action callback to handle browser operations
   * @param callback The callback function to execute browser actions
   */
  public setBrowserActionCallback(callback: ActionCallback) {
    this.browserTools.setBrowserActionCallback(callback);
    this.logger.info('Browser action callback set');
  }

  /**
   * Updates the browser state
   * @param state The current browser state
   */
  public setBrowserState(state: any) {
    this.browserResources.updateState(state);
    this.logger.debug('Browser state updated');
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
      // Register browser resources and tools with the MCP server
      this.registerResourcesAndTools();

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
   * Registers browser resources and tools with the MCP server
   */
  private registerResourcesAndTools() {
    this.logger.info('Registering browser resources and tools');

    // Register browser resources (currently handled manually in handleListResources/handleReadResource)
    // TODO: Implement proper MCP SDK resource registration

    // Register browser tools (currently handled manually in handleListTools/handleCallTool)
    // TODO: Implement proper MCP SDK tool registration
  }

  /**
   * Starts the HTTP server with StreamableHTTPServerTransport
   */
  private async startHttpServer() {
    // Create Express application
    const app = express();

    // Initialize transports map to store session connections
    const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

    // Set up HTTP routes for MCP communication
    app.use(express.json());

    // Handle POST requests (client to server communication)
    app.post('/mcp', async (req, res) => {
      try {
        // Check if there's an existing session ID
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        let transport: StreamableHTTPServerTransport;

        if (sessionId && transports[sessionId]) {
          // Reuse existing transport
          transport = transports[sessionId];
        } else if (!sessionId && isInitializeRequest(req.body)) {
          // New initialization request
          this.logger.info('Creating new MCP session');

          // Create new transport with session ID generator
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: sessionId => {
              // Store transport instance by session ID
              transports[sessionId] = transport;
              this.logger.debug(`Session initialized: ${sessionId}`);
            },
          });

          // Clean up transport when closed
          transport.onclose = () => {
            if (transport.sessionId) {
              delete transports[transport.sessionId];
              this.logger.debug(`Session closed: ${transport.sessionId}`);
            }
          };

          // Connect MCP server to the transport
          await this.mcpServer.connect(transport);
        } else {
          // Invalid request
          this.logger.warn('Invalid request: No valid session ID');
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Invalid request: No valid session ID provided',
            },
            id: null,
          });
          return;
        }

        // Handle the request
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        this.logger.error('Error handling POST request:', error);
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : 'Unknown error',
          },
          id: null,
        });
      }
    });

    // Generic session request handler for GET and DELETE
    const handleSessionRequest = async (req: express.Request, res: express.Response) => {
      try {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !transports[sessionId]) {
          this.logger.warn(`Invalid or missing session ID: ${sessionId}`);
          res.status(400).send('Invalid or missing session ID');
          return;
        }

        const transport = transports[sessionId];
        await transport.handleRequest(req, res);
      } catch (error) {
        this.logger.error('Error handling session request:', error);
        res.status(500).send('Internal server error');
      }
    };

    // Handle GET requests (server to client notifications, using SSE)
    app.get('/mcp', handleSessionRequest);

    // Handle DELETE requests (session termination)
    app.delete('/mcp', handleSessionRequest);

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

  /**
   * Sets the log level for the MCP server
   * @param level The log level to set
   */
  private setLogLevel(level: string): void {
    switch (level.toUpperCase()) {
      case 'ERROR':
        Logger.setLogLevel(LogLevel.ERROR);
        break;
      case 'WARN':
        Logger.setLogLevel(LogLevel.WARN);
        break;
      case 'INFO':
        Logger.setLogLevel(LogLevel.INFO);
        break;
      case 'DEBUG':
        Logger.setLogLevel(LogLevel.DEBUG);
        break;
      default:
        Logger.setLogLevel(LogLevel.INFO);
        break;
    }
    this.logger.info(`Log level set to ${level.toUpperCase()}`);
  }
}
