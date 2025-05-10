// These would normally be imported from the MCP SDK, but we're mocking them for development
// import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
// import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
// import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

// Mock implementations of MCP SDK components
class ResourceTemplate {
  uri: string;
  options: any;

  constructor(uri: string, options: any) {
    this.uri = uri;
    this.options = options;
  }
}

class McpServer {
  private name: string;
  private version: string;
  private resources: Map<string, any> = new Map();
  private tools: Map<string, any> = new Map();

  constructor(options: { name: string; version: string }) {
    this.name = options.name;
    this.version = options.version;
  }

  public async connect(transport: any): Promise<void> {
    // In a real implementation, this would connect the server to the transport
    console.error(`McpServer ${this.name} v${this.version} connected to transport`);
  }

  public resource(name: string, template: ResourceTemplate, handler: Function): void {
    this.resources.set(name, { template, handler });
  }

  public tool(name: string, schema: any, handler: Function): void {
    this.tools.set(name, { schema, handler });
  }
}

class StreamableHTTPServerTransport {
  public sessionId: string | null = null;
  public onclose: (() => void) | null = null;

  constructor(options: { sessionIdGenerator: () => string; onsessioninitialized: (sessionId: string) => void }) {
    // Will be called during handleRequest for initialization
    this.sessionIdGenerator = options.sessionIdGenerator;
    this.onsessioninitialized = options.onsessioninitialized;
  }

  private sessionIdGenerator: () => string;
  private onsessioninitialized: (sessionId: string) => void;

  public async handleRequest(req: any, res: any, body?: any): Promise<void> {
    if (body && this.isInitializeRequest(body) && !this.sessionId) {
      // Generate a new session ID for initialization
      this.sessionId = this.sessionIdGenerator();
      this.onsessioninitialized(this.sessionId);

      // Set response headers
      res.setHeader('mcp-session-id', this.sessionId);

      // Respond with a mock initialization result
      res.status(200).json({
        jsonrpc: '2.0',
        result: {
          capabilities: {
            version: '0.1.0',
            name: 'Mock MCP Server',
            supportedProtocols: ['streamable-http'],
          },
        },
        id: body.id,
      });
      return;
    }

    // Handle other types of requests based on HTTP method
    switch (req.method) {
      case 'GET':
        // Set up SSE for notifications
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        // Send a test event
        res.write('data: {"jsonrpc":"2.0","method":"notification","params":{"type":"test"}}\n\n');
        break;

      case 'DELETE':
        // Close the session
        if (this.onclose) {
          this.onclose();
        }
        res.status(200).send('Session closed');
        break;

      case 'POST':
        if (body) {
          // Process different request types
          if (body.method === 'listResources') {
            res.status(200).json({
              jsonrpc: '2.0',
              result: {
                resources: [
                  { uri: 'browser://current/state', name: 'Browser State' },
                  { uri: 'browser://current/dom', name: 'DOM State' },
                ],
              },
              id: body.id,
            });
          } else if (body.method === 'readResource') {
            res.status(200).json({
              jsonrpc: '2.0',
              result: {
                contents: [
                  {
                    uri: body.params.uri,
                    type: 'application/json',
                    text: '{"status":"ok"}',
                  },
                ],
              },
              id: body.id,
            });
          } else if (body.method === 'callTool') {
            res.status(200).json({
              jsonrpc: '2.0',
              result: {
                content: [
                  {
                    type: 'text/plain',
                    text: JSON.stringify({ success: true, message: 'Tool executed' }),
                  },
                ],
              },
              id: body.id,
            });
          } else {
            // Default response for unknown methods
            res.status(200).json({
              jsonrpc: '2.0',
              result: { status: 'ok' },
              id: body.id,
            });
          }
        } else {
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32600,
              message: 'Invalid Request',
            },
            id: null,
          });
        }
        break;

      default:
        res.status(405).send('Method Not Allowed');
    }
  }

  public async close(): Promise<void> {
    // Clean up the transport
    if (this.onclose) {
      this.onclose();
    }
    this.sessionId = null;
  }

  private isInitializeRequest(body: any): boolean {
    return (
      body && body.jsonrpc === '2.0' && body.method === 'initialize' && body.params && typeof body.id !== 'undefined'
    );
  }
}

function isInitializeRequest(body: any): boolean {
  return (
    body && body.jsonrpc === '2.0' && body.method === 'initialize' && body.params && typeof body.id !== 'undefined'
  );
}
import express from 'express';
import http from 'http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { BrowserResources, BrowserState } from './browser-resources';
import { ActionResult, BrowserTools } from './browser-tools';

export interface ActionCallback {
  (action: string, params: any): Promise<ActionResult>;
}

/**
 * BrowserMcpServer implements an MCP server that communicates with Chrome extension
 * using the Streamable HTTP protocol.
 */
export class BrowserMcpServer {
  private browserResources: BrowserResources;
  private browserTools: BrowserTools;
  private expressApp: express.Application;
  private httpServer: http.Server | null = null;
  private transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};
  private servers: { [sessionId: string]: McpServer } = {};
  private actionCallback: ActionCallback | null = null;
  private port: number;

  /**
   * Initialize the BrowserMcpServer
   * @param port The HTTP port to listen on
   */
  constructor(port: number = 8765) {
    // Store the HTTP server port
    this.port = port;

    // Create browser resources and tools handlers
    this.browserResources = new BrowserResources();
    this.browserTools = new BrowserTools();

    // Configure browser tools callback
    this.browserTools.setBrowserActionCallback(this.handleBrowserAction.bind(this));

    // Create Express application
    this.expressApp = express();
    this.expressApp.use(express.json());

    // Set up MCP HTTP endpoints
    this.setupExpressRoutes();
  }

  /**
   * Start the MCP server's HTTP interface
   */
  public async start(): Promise<void> {
    console.error(`Starting MCP Server with Streamable HTTP protocol on port ${this.port}...`);
    try {
      return new Promise<void>((resolve, reject) => {
        this.httpServer = this.expressApp.listen(this.port, () => {
          console.error(`MCP Server HTTP interface listening on port ${this.port}`);
          resolve();
        });

        this.httpServer.on('error', err => {
          console.error(`Error starting HTTP server: ${err.message}`);
          reject(err);
        });
      });
    } catch (error) {
      console.error('Failed to start MCP HTTP Server:', error);
      throw error;
    }
  }

  /**
   * Stop the MCP server
   */
  public async stop(): Promise<void> {
    console.error('Stopping MCP Server...');

    // Close all transports
    for (const sessionId in this.transports) {
      try {
        await this.transports[sessionId].close();
      } catch (err) {
        console.error(`Error closing transport for session ${sessionId}:`, err);
      }
    }

    // Clear all sessions
    this.transports = {};
    this.servers = {};

    // Close HTTP server
    if (this.httpServer) {
      return new Promise<void>((resolve, reject) => {
        this.httpServer!.close(err => {
          if (err) {
            console.error('Error closing HTTP server:', err);
            reject(err);
          } else {
            console.error('MCP Server stopped');
            this.httpServer = null;
            resolve();
          }
        });
      });
    }
  }

  /**
   * Register a callback for browser actions
   */
  public registerActionCallback(callback: ActionCallback): void {
    this.actionCallback = callback;
  }

  /**
   * Update the browser state
   */
  public setBrowserState(state: BrowserState): void {
    this.browserResources.updateState(state);
    console.error('Browser state updated');
  }

  /**
   * Set up Express routes for MCP communication
   */
  private setupExpressRoutes(): void {
    // Handle POST requests for client-to-server communication
    this.expressApp.post('/mcp', async (req, res) => {
      try {
        // Check for existing session ID
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        let transport: StreamableHTTPServerTransport;

        if (sessionId && this.transports[sessionId]) {
          // Reuse existing transport
          transport = this.transports[sessionId];
        } else if (!sessionId && isInitializeRequest(req.body)) {
          // New initialization request
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: newSessionId => {
              // Store transport by session ID
              this.transports[newSessionId] = transport;
              console.error(`New MCP session initialized: ${newSessionId}`);
            },
          });

          // Clean up transport when closed
          transport.onclose = () => {
            if (transport.sessionId) {
              console.error(`MCP session closed: ${transport.sessionId}`);
              delete this.transports[transport.sessionId];

              // Also remove the associated server if exists
              if (this.servers[transport.sessionId]) {
                delete this.servers[transport.sessionId];
              }
            }
          };

          // Create a new MCP server for this session
          const server = new McpServer({
            name: 'NanobrowserMcpServer',
            version: '0.1.0',
          });

          // Register tools and resources
          this.registerTools(server);
          this.registerResources(server);

          // Connect to the MCP server
          await server.connect(transport);

          // Store server by session ID
          if (transport.sessionId) {
            this.servers[transport.sessionId] = server;
          }
        } else {
          // Invalid request
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Bad Request: No valid session ID provided',
            },
            id: null,
          });
          return;
        }

        // Handle the request
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error('Error handling POST request:', error);
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Internal Server Error',
          },
          id: null,
        });
      }
    });

    // Reusable handler for GET and DELETE requests
    const handleSessionRequest = async (req: express.Request, res: express.Response) => {
      try {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !this.transports[sessionId]) {
          res.status(400).send('Invalid or missing session ID');
          return;
        }

        const transport = this.transports[sessionId];
        await transport.handleRequest(req, res);
      } catch (error) {
        console.error(`Error handling ${req.method} request:`, error);
        if (!res.headersSent) {
          res.status(500).send('Internal Server Error');
        }
      }
    };

    // Handle GET requests for server-to-client notifications via SSE
    this.expressApp.get('/mcp', handleSessionRequest);

    // Handle DELETE requests for session termination
    this.expressApp.delete('/mcp', handleSessionRequest);
  }

  /**
   * Handle browser action requests
   */
  private async handleBrowserAction(action: string, params: any): Promise<ActionResult> {
    console.error(`Executing browser action: ${action}`, params);

    if (this.actionCallback) {
      return this.actionCallback(action, params);
    }

    return {
      success: false,
      message: 'No action handler registered',
    };
  }

  /**
   * Register all browser tools with an MCP server instance
   */
  private registerTools(server: McpServer): void {
    // Navigation tool
    server.tool('navigate_to', { url: z.string().url() }, async ({ url }) => {
      const result = await this.browserTools.callTool('navigate_to', { url });
      return {
        content: [
          {
            type: 'text/plain',
            text: JSON.stringify(result),
          },
        ],
      };
    });

    // Click element tool
    server.tool('click_element', { selector: z.string() }, async ({ selector }) => {
      const result = await this.browserTools.callTool('click_element', { selector });
      return {
        content: [
          {
            type: 'text/plain',
            text: JSON.stringify(result),
          },
        ],
      };
    });

    // Type text tool
    server.tool(
      'type_text',
      {
        selector: z.string(),
        text: z.string(),
      },
      async ({ selector, text }) => {
        const result = await this.browserTools.callTool('type_text', { selector, text });
        return {
          content: [
            {
              type: 'text/plain',
              text: JSON.stringify(result),
            },
          ],
        };
      },
    );

    // Go back tool
    server.tool('go_back', {}, async () => {
      const result = await this.browserTools.callTool('go_back', {});
      return {
        content: [
          {
            type: 'text/plain',
            text: JSON.stringify(result),
          },
        ],
      };
    });

    // Go forward tool
    server.tool('go_forward', {}, async () => {
      const result = await this.browserTools.callTool('go_forward', {});
      return {
        content: [
          {
            type: 'text/plain',
            text: JSON.stringify(result),
          },
        ],
      };
    });

    // Reload page tool
    server.tool('reload_page', {}, async () => {
      const result = await this.browserTools.callTool('reload_page', {});
      return {
        content: [
          {
            type: 'text/plain',
            text: JSON.stringify(result),
          },
        ],
      };
    });
  }

  /**
   * Register all browser resources with an MCP server instance
   */
  private registerResources(server: McpServer): void {
    // Current browser state resource
    server.resource(
      'current_browser_state',
      new ResourceTemplate('browser://current/state', { list: true }),
      async uri => {
        try {
          const resource = await this.browserResources.readResource('browser://current/state');
          // Convert existing resource format to MCP SDK format
          return {
            contents: resource.contents.map(content => ({
              uri: uri.href,
              type: content.mimeType,
              text: content.text,
            })),
          };
        } catch (error) {
          console.error('Error reading browser state:', error);
          throw error;
        }
      },
    );

    // Current page DOM resource
    server.resource('current_page_dom', new ResourceTemplate('browser://current/dom', { list: true }), async uri => {
      try {
        const resource = await this.browserResources.readResource('browser://current/dom');
        return {
          contents: resource.contents.map(content => ({
            uri: uri.href,
            type: content.mimeType,
            text: content.text,
          })),
        };
      } catch (error) {
        console.error('Error reading DOM state:', error);
        throw error;
      }
    });
  }
}
