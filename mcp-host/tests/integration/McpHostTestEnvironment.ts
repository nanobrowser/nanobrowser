import { ChildProcess, spawn } from 'child_process';
import { Readable, Writable } from 'stream';
import { createMockStdio } from '../helpers/mock-stdio';
import { McpHttpClient } from './mcp-http-client';
import { MockExtension } from './mock-extension';
import * as net from 'net';
import { promisify } from 'util';

/**
 * Test environment for MCP Host integration tests
 * Manages the lifecycle of an MCP Host process with mock stdio communication
 * and provides utilities for testing via both stdio and HTTP interfaces
 */
export class McpHostTestEnvironment {
  private hostProcess: ChildProcess | null = null;
  private mcpClient: McpHttpClient | null = null;
  private mockExtension: MockExtension;
  private mockStdio: {
    stdin: Readable;
    stdout: Writable;
    pushToStdin: (data: any) => void;
    readFromStdout: () => any[];
  };
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

    // Create mock stdio for communicating with the host
    this.mockStdio = createMockStdio();

    // Create mock extension
    this.mockExtension = new MockExtension();
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

    console.log(`Waiting for host to be ready at http://localhost:${this.port}...`);

    // Check repeatedly until host is ready or timeout
    while (Date.now() - startTime < timeout) {
      attemptCount++;
      try {
        // Try to connect to the HTTP server
        if (this.mcpClient) {
          console.log(`Attempt ${attemptCount}: Testing connection to MCP server...`);
          // Attempt a basic request
          await this.mcpClient.initialize();
          console.log(`Host is ready on port ${this.port}`);
          return; // Success
        } else {
          console.log(`MCP client not initialized yet`);
        }
      } catch (error) {
        console.log(`Attempt ${attemptCount} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Wait a bit before retrying
      const waitTime = 500; // Longer wait between attempts
      console.log(`Waiting ${waitTime}ms before retrying...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    // If we get here, host is not ready within timeout
    if (this.hostProcess) {
      console.error('Process output:', this.hostProcess.stdio);
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

    // Register message handlers
    this.mockExtension.registerHandlers();

    // Start the MCP host process with mock stdio and the selected port
    this.hostProcess = spawn('node', ['./dist/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        LOG_LEVEL: 'debug',
        PORT: this.port.toString(),
      },
    });

    // Handle process exit
    this.exitPromise = new Promise<number>(resolve => {
      if (this.hostProcess) {
        this.hostProcess.on('exit', code => {
          console.log(`hostProcess exit with code:`, code);

          this.exitCode = code ?? -1;
          resolve(this.exitCode);
        });
      } else {
        resolve(-1);
      }
    });

    // Connect mock stdio to the process
    if (this.hostProcess) {
      this.mockStdio.stdin.pipe(this.hostProcess.stdin!);
      this.hostProcess.stdout!.pipe(this.mockStdio.stdout);
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
    return this.mockExtension.sendMessageAndWaitForResponse(message);
  }

  /**
   * Set browser state via the mock extension
   * @param state The browser state to set
   * @returns A promise that resolves with the response
   */
  async setBrowserState(state: any): Promise<any> {
    return this.mockExtension.setBrowserState(state);
  }

  /**
   * Register an action handler for the mock extension
   * @param handler The action handler function
   */
  registerActionHandler(handler: (action: string, params: any) => Promise<any>): void {
    this.mockExtension.addHandler('executeAction', async data => {
      const { action, params } = data;
      return handler(action, params);
    });
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
}
