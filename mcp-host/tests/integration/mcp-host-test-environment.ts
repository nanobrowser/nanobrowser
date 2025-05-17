import * as net from 'net';
import { ChildProcess, spawn } from 'child_process';
import { McpHttpClient } from './mcp-http-client';
import { MessageHandler, type RpcHandler, RpcRequest, RpcRequestOptions, RpcResponse } from '../../src/types';
import { NativeMessaging } from '../../src/messaging.js';
import { createLogger } from '../../src/logger';

/**
 * Test environment for MCP Host integration tests
 * Manages the lifecycle of an MCP Host process with mock stdio communication
 * and provides utilities for testing via both stdio and HTTP interfaces
 */
export class McpHostTestEnvironment {
  private logger = createLogger('mcp-host-test-environment');
  private hostProcess: ChildProcess | null = null;
  private mcpClient: McpHttpClient | null = null;
  private nativeMessaging: NativeMessaging | null = null;

  private port: number;
  private exitCode: number | null = null;
  private exitPromise: Promise<number> | null = null;

  /**
   * Create a new test environment
   * @param options Configuration options
   */
  constructor(options?: { port?: number }) {
    // Use provided port or find an available one
    this.port = options?.port || 0; // 0 will be replaced with actual port during setup
  }

  /**
   * Find an available port for the MCP host to listen on
   * This allows multiple test instances to run in parallel
   * @returns A promise that resolves to an available port number
   */
  private async findAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      // Create a server to listen on port 0 (OS will assign a free port)
      const server = net.createServer();
      server.on('error', reject);

      // Listen on port 0 (OS will assign an available port)
      server.listen(0, () => {
        // Get the assigned port
        const address = server.address() as net.AddressInfo;
        const port = address.port;

        // Close the server and resolve with the port
        server.close(() => {
          resolve(port);
        });
      });
    });
  }

  /**
   * Wait for the host to be ready
   * @param timeout Maximum time to wait in milliseconds
   * @returns A promise that resolves when the host is ready
   */
  private async waitForHostReady(timeout = 10000): Promise<void> {
    const startTime = Date.now();
    let attemptCount = 0;

    this.logger.info(`Waiting for host to be ready at http://localhost:${this.port}...`);

    // Check repeatedly until host is ready or timeout
    while (Date.now() - startTime < timeout) {
      attemptCount++;
      try {
        // Try to connect to the HTTP server
        if (this.mcpClient) {
          this.logger.debug(`Attempt ${attemptCount}: Testing connection to MCP server...`);
          // Attempt a basic request
          await this.mcpClient.initialize();
          this.logger.info(`Host is ready on port ${this.port}`);
          return; // Success
        } else {
          this.logger.debug(`MCP client not initialized yet`);
        }
      } catch (error) {
        this.logger.debug(
          `Attempt ${attemptCount} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }

      // Wait a bit before retrying
      const waitTime = 500; // Longer wait between attempts
      this.logger.debug(`Waiting ${waitTime}ms before retrying...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    // If we get here, host is not ready within timeout
    if (this.hostProcess) {
      this.logger.error('Process output:', this.hostProcess.stdio);
    }

    throw new Error(`Host not ready after ${timeout}ms (attempted ${attemptCount} times)`);
  }

  /**
   * Setup the test environment
   * @returns A promise that resolves when the environment is ready
   */
  async setup(): Promise<void> {
    // Find available port if not specified
    if (this.port === 0) {
      this.port = await this.findAvailablePort();
    }

    // Start the MCP host process with mock stdio and the selected port
    this.hostProcess = spawn('node', ['./dist/index.js'], {
      stdio: ['pipe', 'pipe', 'inherit'], // Make stderr inherit to show logs in console
      env: {
        ...process.env,
        LOG_LEVEL: 'DEBUG',
        PORT: this.port.toString(),
      },
    });

    // Handle process exit
    this.exitPromise = new Promise<number>(resolve => {
      if (this.hostProcess) {
        this.hostProcess.on('exit', code => {
          this.logger.info(`hostProcess exit with code:`, code);

          this.exitCode = code ?? -1;
          resolve(this.exitCode);
        });

        // Forward stderr output to parent process
        if (this.hostProcess.stderr) {
          this.hostProcess.stderr.on('data', data => {
            process.stderr.write(data);
          });
        }
      } else {
        resolve(-1);
      }
    });

    // Connect mock stdio to the process
    if (this.hostProcess && this.hostProcess.stdout && this.hostProcess.stdin) {
      // From parent process perspective:
      // - Read FROM child's stdout (Readable)
      // - Write TO child's stdin (Writable)
      this.nativeMessaging = new NativeMessaging(this.hostProcess.stdout, this.hostProcess.stdin);

      this.nativeMessaging.registerHandler('status', async (data: any): Promise<void> => {
        this.logger.info('received status:', data);
      });

      this.nativeMessaging.registerRpcMethod('hello', async (req: RpcRequest): Promise<RpcResponse> => {
        this.logger.info('received hello request:', req);

        return {
          id: req.id,
          result: 'world',
        };
      });
    }

    // Create MCP client connected to the host's HTTP server
    this.mcpClient = new McpHttpClient(`http://localhost:${this.port}/mcp`);

    // Wait for host to initialize
    await this.waitForHostReady();
  }

  /**
   * Clean up the test environment
   * @returns A promise that resolves when cleanup is complete
   */
  async cleanup(): Promise<void> {
    // Close MCP client if it exists
    if (this.mcpClient) {
      await this.mcpClient.close().catch(() => {});
      this.mcpClient = null;
    }

    // Kill the host process if it's still running
    if (this.hostProcess && !this.hostProcess.killed) {
      this.hostProcess.kill();

      // Wait for process to exit
      if (this.exitPromise) {
        await Promise.race([
          this.exitPromise,
          new Promise(resolve => setTimeout(resolve, 1000)), // Timeout after 1s
        ]);
      }

      this.hostProcess = null;
    }
  }

  /**
   * Send a message to the host via stdio
   * @param message The message to send
   * @returns A promise that resolves with the response
   */
  async sendMessage(message: any): Promise<any> {
    return this.nativeMessaging?.sendMessage(message);
  }

  /**
   * Get the MCP client
   * @returns The MCP client or null if not initialized
   */
  getMcpClient(): McpHttpClient | null {
    return this.mcpClient;
  }

  /**
   * Get the port this instance is using
   * @returns The port number
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Check if the host process is running
   * @returns True if the host is running, false otherwise
   */
  isHostRunning(): boolean {
    return !!this.hostProcess && !this.hostProcess.killed;
  }

  /**
   * Get the exit code of the host process
   * @returns The exit code or null if the process hasn't exited
   */
  getExitCode(): number | null {
    return this.exitCode;
  }

  /**
   * Shutdown the test environment
   * @returns A promise that resolves when shutdown is complete
   */
  async shutdown(): Promise<void> {
    // Send shutdown message
    await this.sendMessage({
      type: 'shutdown',
    }).catch(() => {});

    // Clean up
    await this.cleanup();
  }

  public registerMessageHandler(type: string, handler: MessageHandler): void {
    this.nativeMessaging?.registerHandler(type, handler);
  }

  public registerRpcMethod(method: string, handler: RpcHandler): void {
    this.nativeMessaging?.registerRpcMethod(method, handler);
  }

  public async rpcRequest(rpc: RpcRequest, options: RpcRequestOptions = {}): Promise<RpcResponse> {
    if (this.nativeMessaging) {
      return this.nativeMessaging.rpcRequest(rpc, options);
    }

    return {
      error: {
        code: -32000,
        message: 'nativeMessaging is null',
      },
    };
  }
}
