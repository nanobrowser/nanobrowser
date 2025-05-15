import { McpServer as SdkMcpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { randomUUID } from 'crypto';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createLogger, LogLevel, Logger } from './logger.js';
import { BrowserResources } from './browser-resources.js';
import { BrowserTools, ActionCallback } from './browser-tools.js';

// Implementation of McpServer class used in tests
export class McpServer {
  private browserResources: BrowserResources;
  private browserTools: BrowserTools;
  private actionCallback: ActionCallback | null = null;
  private logger;
  private transport: StreamableHTTPServerTransport | null = null;
  private name: string;
  private version: string;

  constructor(options?: { name?: string; version?: string }) {
    this.browserResources = new BrowserResources();
    this.browserTools = new BrowserTools();
    this.logger = createLogger('mcp-server');
    this.name = options?.name || 'nanobrowser-mcp';
    this.version = options?.version || '1.0.0';
    this.logger.info(`McpServer instance created (${this.name} v${this.version})`);
  }

  /**
   * Connects the MCP server to a transport
   * @param transport The transport to connect to
   */
  public async connect(transport: StreamableHTTPServerTransport): Promise<void> {
    this.transport = transport;
    this.logger.info('Connected to transport');
  }

  /**
   * Registers an action callback for handling browser operations
   * @param callback The callback function for executing browser actions
   */
  public registerActionCallback(callback: ActionCallback): void {
    this.actionCallback = callback;
    this.browserTools.setBrowserActionCallback(callback);
    this.logger.info('Action callback registered');
  }

  /**
   * Sets the browser state
   * @param state The browser state to set
   */
  public setBrowserState(state: any): void {
    this.browserResources.updateState(state);
    this.logger.debug('Browser state updated');
  }

  /**
   * Lists all available resources
   * @returns A promise that resolves to the list of resources
   */
  public async handleListResources(): Promise<{ resources: any[] }> {
    return {
      resources: this.browserResources.listResources(),
    };
  }

  /**
   * Reads a resource by URI
   * @param uri The URI of the resource to read
   * @returns A promise that resolves to the resource content
   */
  public async handleReadResource(uri: string): Promise<any> {
    try {
      return await this.browserResources.readResource(uri);
    } catch (error) {
      this.logger.error(`Error reading resource ${uri}:`, error);
      throw error;
    }
  }

  /**
   * Lists all available tools
   * @returns A promise that resolves to the list of tools
   */
  public async handleListTools(): Promise<{ tools: any[] }> {
    return {
      tools: this.browserTools.listTools(),
    };
  }

  /**
   * Calls a tool with arguments
   * @param name The name of the tool to call
   * @param args The arguments to pass to the tool
   * @returns A promise that resolves to the tool result
   */
  public async handleCallTool(name: string, args: any): Promise<any> {
    try {
      this.logger.debug(`Executing tool: ${name} with args:`, args);
      return await this.browserTools.callTool(name, args);
    } catch (error) {
      this.logger.error(`Error executing tool ${name}:`, error);
      throw error;
    }
  }
}

// Extend the SDK's McpServer type for our custom handlers
declare module '@modelcontextprotocol/sdk/server/mcp.js' {
  interface McpServer {
    handleListResources?: () => Promise<{ resources: any[] }>;
    handleReadResource?: (uri: string) => Promise<any>;
    handleListTools?: () => Promise<{ tools: any[] }>;
    handleCallTool?: (name: string, args: any) => Promise<any>;
  }
}

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
    this.mcpServer.registerActionCallback(callback);
    this.browserTools.setBrowserActionCallback(callback);
    this.logger.info('Browser action callback set');
  }

  /**
   * Updates the browser state
   * @param state The current browser state
   */
  public setBrowserState(state: any) {
    this.mcpServer.setBrowserState(state);
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

    // Register resource handlers with SdkMcpServer
    this.mcpServer.handleListResources = async () => {
      this.logger.debug('Handling listResources request');
      return {
        resources: this.browserResources.listResources(),
      };
    };

    this.mcpServer.handleReadResource = async (uri: string) => {
      this.logger.debug(`Handling readResource request for ${uri}`);
      try {
        return await this.browserResources.readResource(uri);
      } catch (error) {
        this.logger.error(`Error reading resource ${uri}:`, error);
        throw error;
      }
    };

    // Register tool handlers with SdkMcpServer
    this.mcpServer.handleListTools = async () => {
      this.logger.debug('Handling listTools request');
      return {
        tools: this.browserTools.listTools(),
      };
    };

    this.mcpServer.handleCallTool = async (name: string, args: any) => {
      this.logger.debug(`Handling callTool request for ${name}`);
      try {
        this.logger.debug(`Executing tool: ${name} with args:`, args);
        return await this.browserTools.callTool(name, args);
      } catch (error) {
        this.logger.error(`Error executing tool ${name}:`, error);
        throw error;
      }
    };

    // Log registered resources and tools
    const resources = this.browserResources.listResources();
    this.logger.info(`Made ${resources.length} resources available through MCP server`);
    this.logger.debug('Available resources: ' + resources.map(r => r.uri).join(', '));

    const tools = this.browserTools.listTools();
    this.logger.info(`Made ${tools.length} tools available through MCP server`);
    this.logger.debug('Available tools: ' + tools.map(t => t.name).join(', '));
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
