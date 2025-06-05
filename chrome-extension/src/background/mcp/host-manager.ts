/**
 * MCP Host Manager
 *
 * This class manages the connection to the MCP Host process, monitors its status,
 * and provides methods to control it (start, stop, etc.).
 * It also supports bidirectional RPC communication with the MCP Host.
 */
import { McpErrorCode, createMcpError } from '@extension/shared';

// Define RPC types
export interface RpcRequest {
  /**
   * Unique identifier for the request
   */
  id?: string;

  /**
   * Method to be invoked
   */
  method: string;

  /**
   * Parameters for the method
   */
  params?: unknown;
}

/**
 * JSON-RPC like response structure
 */
export interface RpcResponse {
  /**
   * Identifier matching the request
   */
  id?: string;

  /**
   * Result of the method call (if successful)
   */
  result?: unknown;

  /**
   * Error information (if the call failed)
   */
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Options for RPC requests
 */
export interface RpcRequestOptions {
  /**
   * Timeout in milliseconds
   */
  timeout?: number;
}

/**
 * A function that handles an RPC request and returns a promise of RpcResponse
 */
export type RpcHandler = (request: RpcRequest) => Promise<RpcResponse>;

// Define the MCP Host status interface
export interface McpHostStatus {
  isConnected: boolean;
  startTime: number | null;
  lastHeartbeat: number | null;
  version: string | null;
  runMode: string | null;
}

// Define the MCP Host configuration options
export interface McpHostOptions {
  runMode: string;
  port?: number;
  logLevel?: string;
}

// Type for status change event listeners
export type StatusListener = (status: McpHostStatus) => void;

export class McpHostManager {
  private port: chrome.runtime.Port | null = null;
  private status: McpHostStatus = {
    isConnected: false,
    startTime: null,
    lastHeartbeat: null,
    version: null,
    runMode: null,
  };
  private listeners: StatusListener[] = [];
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private pingTimeout: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_INTERVAL_MS = 5000; // 5 seconds (reduced for faster detection)
  private readonly PING_TIMEOUT_MS = 20000; // 20 seconds
  private readonly GRACEFUL_SHUTDOWN_TIMEOUT_MS = 1000; // 1 second
  private readonly CONNECTION_VERIFICATION_TIMEOUT_MS = 2000; // 2 seconds for initial verification
  // RPC-related properties
  private rpcMethodHandlers: Map<string, RpcHandler> = new Map();
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: RpcResponse) => void;
      reject: (reason?: unknown) => void;
      timeoutId: NodeJS.Timeout;
    }
  >();
  private readonly RPC_TIMEOUT_MS = 5000; // 5 seconds default timeout for RPC requests

  /**
   * Verifies that the connection to MCP Host is actually working by sending a ping request.
   * @returns {Promise<boolean>} Promise that resolves to true if connection is verified
   * @private
   */
  private async verifyActualConnection(): Promise<boolean> {
    if (!this.port) {
      return false;
    }

    try {
      console.debug('[McpHostManager] Verifying actual connection with ping...');

      // Send a quick ping to verify the host is actually responding
      const response = await this.rpcRequest(
        { method: 'ping', params: {} },
        { timeout: this.CONNECTION_VERIFICATION_TIMEOUT_MS },
      );

      // Check if we got a valid response
      const isValid = response && (response.result !== undefined || response.error === undefined);

      console.debug('[McpHostManager] Connection verification result:', isValid);
      return isValid;
    } catch (error) {
      console.warn('[McpHostManager] Connection verification failed:', error);
      return false;
    }
  }

  /**
   * Handles connection failure by cleaning up and updating status
   * @private
   */
  private handleConnectionFailure(): void {
    console.debug('[McpHostManager] Handling connection failure...');

    // Clean up port
    if (this.port) {
      try {
        this.port.disconnect();
      } catch (error) {
        // Ignore disconnect errors
      }
      this.port = null;
    }

    // Update status to disconnected
    this.updateStatus({
      isConnected: false,
      startTime: null,
      lastHeartbeat: null,
    });
  }

  /**
   * Establishes a connection to the MCP Host Native Messaging host.
   * @returns {Promise<boolean>} Promise that resolves to true if connection was established successfully
   * @throws Will reject with an error if connection fails (e.g., host not installed)
   */
  public connect(): Promise<boolean> {
    // Don't reconnect if already connected
    if (this.port) {
      return Promise.resolve(false);
    }

    return new Promise((resolve, reject) => {
      // Connect to the native messaging host
      // Note: connectNative always returns a Port object even if the host doesn't exist
      this.port = chrome.runtime.connectNative('ai.nanobrowser.mcp.host');

      // Setup message handler
      this.port.onMessage.addListener(this.handleMessage.bind(this));

      // Critical: The onDisconnect event is where we need to check for connection errors
      // We'll create a local handler first that includes the Promise resolution
      const disconnectHandler = () => {
        // Check for runtime error which indicates connection failure
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          const errorMessage = lastError.message;
          console.error(`Native messaging connection failed: ${errorMessage}`);

          // Clean up port reference
          this.port = null;

          // Create a structured MCP error with appropriate error code
          const mcpError = createMcpError(
            McpErrorCode.HOST_NOT_FOUND,
            `Native messaging connection failed: ${errorMessage}`,
            { originalError: lastError.message },
          );

          // Reject the promise with the structured error
          reject(mcpError);
        } else {
          // This was a normal disconnect - should be handled by the main disconnect handler
          this.handleDisconnect();
        }
      };

      // Add our disconnect handler
      this.port.onDisconnect.addListener(disconnectHandler);

      // Set a timeout to verify successful connection with actual verification
      setTimeout(async () => {
        if (this.port) {
          try {
            console.debug('[McpHostManager] Attempting connection verification...');

            // Verify the connection is actually working
            const verified = await this.verifyActualConnection();

            if (verified) {
              // Connection is verified - set up remaining handlers and state
              console.debug('[McpHostManager] Connection verified successfully');

              // Update and broadcast status with timestamp
              this.updateStatus({
                isConnected: true,
                startTime: Date.now(),
                lastHeartbeat: Date.now(),
              });

              // Start heartbeat
              this.startHeartbeat();

              // Resolve the promise
              resolve(true);
            } else {
              // Verification failed - clean up and report failure
              console.warn('[McpHostManager] Connection verification failed');
              this.handleConnectionFailure();
              resolve(false);
            }
          } catch (error) {
            // Verification threw an error - treat as connection failure
            console.error('[McpHostManager] Connection verification error:', error);
            this.handleConnectionFailure();
            resolve(false);
          }
        }
      }, 200); // Increased timeout for verification process
    });
  }

  /**
   * Disconnects from the MCP Host.
   */
  public disconnect(): void {
    if (!this.port) {
      return;
    }

    // Clear heartbeat timer
    this.stopHeartbeat();

    // Disconnect
    this.port.disconnect();
    this.port = null;

    // Update status
    this.updateStatus({
      isConnected: false,
      lastHeartbeat: null,
    });
  }

  /**
   * Gets the current MCP Host status.
   * @returns {McpHostStatus} The current status.
   */
  public getStatus(): McpHostStatus {
    return { ...this.status };
  }

  /**
   * Registers a listener for status changes.
   * @param {StatusListener} listener The listener to add.
   */
  public addStatusListener(listener: StatusListener): void {
    this.listeners.push(listener);
  }

  /**
   * Removes a status change listener.
   * @param {StatusListener} listener The listener to remove.
   */
  public removeStatusListener(listener: StatusListener): void {
    const index = this.listeners.indexOf(listener);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Starts the MCP Host process.
   * @param {McpHostOptions} options Configuration options.
   * @returns {Promise<boolean>} True if the Host was started successfully.
   * @throws Will reject with an error if connection fails (e.g., host not installed)
   */
  public async startMcpHost(options: McpHostOptions): Promise<boolean> {
    // Don't start if already connected
    if (this.status.isConnected) {
      return false;
    }

    // Send start request to the main extension process
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: 'init',
          options,
        },
        response => {
          if (response && response.success) {
            // Try to connect to the newly started Host with minimal delay
            setTimeout(async () => {
              try {
                // Now using the Promise-based connect() method
                const connected = await this.connect();
                resolve(connected);
              } catch (error) {
                console.error('Failed to connect to MCP Host after init:', error);
                reject(error); // Propagate the error up
              }
            }, 100); // Reduced from 500ms to 100ms for faster connection
          } else {
            // Check if there's an error message in the response
            if (response && response.error) {
              reject(new Error(response.error));
            } else {
              resolve(false);
            }
          }
        },
      );
    });
  }

  /**
   * Stops the MCP Host process.
   * @returns {Promise<boolean>} True if the Host was stopped successfully.
   */
  public async stopMcpHost(): Promise<boolean> {
    if (!this.port || !this.status.isConnected) {
      return false;
    }

    return new Promise(resolve => {
      // Send shutdown command
      this.port?.postMessage({ type: 'shutdown' });

      // Set a timeout for graceful shutdown
      const timeout = setTimeout(() => {
        // Force disconnect if graceful shutdown times out
        this.disconnect();
        resolve(true);
      }, this.GRACEFUL_SHUTDOWN_TIMEOUT_MS);

      // Add a one-time disconnect listener
      const disconnectHandler = () => {
        clearTimeout(timeout);
        resolve(true);
      };

      // Wait for disconnect event
      this.port?.onDisconnect.addListener(disconnectHandler);
    });
  }

  /**
   * Registers an RPC method handler that can be called by the MCP Host.
   * @param method The RPC method name to register
   * @param handler The function to handle requests for this method
   */
  public registerRpcMethod(method: string, handler: RpcHandler): void {
    console.debug(`[McpHostManager] Registering RPC handler for method: ${method}`);
    this.rpcMethodHandlers.set(method, handler);
  }

  /**
   * Sends an RPC request to the MCP Host and returns a promise for the response.
   * @param rpc The RPC request to send
   * @param options Optional configuration for the request
   * @returns A Promise that resolves with the response or rejects on error/timeout
   */
  public rpcRequest(rpc: RpcRequest, options: RpcRequestOptions = {}): Promise<RpcResponse> {
    if (!this.port || !this.status.isConnected) {
      return Promise.reject(new Error('Cannot send RPC request: host not connected'));
    }

    // Generate a unique ID if not provided
    const id = rpc.id ?? this.generateRequestId();
    const method = rpc.method;
    const params = rpc.params;

    // Get timeout from options or use default
    const { timeout = this.RPC_TIMEOUT_MS } = options;

    console.debug(`[McpHostManager] Sending RPC request: ${method} (id: ${id})`);

    return new Promise((resolve, reject) => {
      // Set up timeout to reject the promise if no response is received
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`RPC request timeout: ${method} (id: ${id})`));
      }, timeout);

      // Store the promise resolvers with the request ID
      this.pendingRequests.set(id, { resolve, reject, timeoutId });

      // Send the RPC request message
      this.port?.postMessage({
        type: 'rpc_request',
        id,
        method,
        params,
      });
    });
  }

  /**
   * Generates a unique ID for RPC requests
   * @returns A unique string ID
   */
  private generateRequestId(): string {
    return 'req_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  /**
   * Processes an incoming RPC request from the MCP Host.
   * @param data The RPC request data
   */
  private async handleRpcRequest(data: { method: string; id?: string; params?: unknown }): Promise<void> {
    const { method, id, params } = data;
    console.debug(`[McpHostManager] Received RPC request: ${method} (id: ${id})`);

    // Find the registered handler for this method
    const handler = this.rpcMethodHandlers.get(method);

    if (!handler) {
      console.warn(`[McpHostManager] No handler registered for RPC method: ${method}`);
      this.port?.postMessage({
        type: 'rpc_response',
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      });
      return;
    }

    // Call the handler and send the response
    try {
      const request: RpcRequest = { id, method, params };
      const response = await handler(request);

      // Make sure the response includes the request ID
      response.id = id;

      console.debug(`[McpHostManager] Send RPC response:`, response);

      this.port?.postMessage({
        type: 'rpc_response',
        ...response,
      });
    } catch (error) {
      console.error(`[McpHostManager] Error handling RPC method ${method}:`, error);
      this.port?.postMessage({
        type: 'rpc_response',
        id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /**
   * Processes an incoming RPC response from the MCP Host.
   * @param data The RPC response data
   */
  private handleRpcResponse(data: {
    id: string;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
  }): void {
    const { id, error } = data;
    console.debug(`[McpHostManager] Received RPC response for ID: ${id}`);

    // Find the pending request for this ID
    const pendingRequest = this.pendingRequests.get(id);
    if (!pendingRequest) {
      console.warn(`[McpHostManager] No pending request found for RPC response ID: ${id}`);
      return;
    }

    // Clear the timeout and remove from pending requests
    clearTimeout(pendingRequest.timeoutId);
    this.pendingRequests.delete(id);

    // Resolve or reject the promise based on the response
    if (error) {
      pendingRequest.reject(error);
    } else {
      pendingRequest.resolve(data || {});
    }
  }

  private handleMessage(message: {
    type: string;
    data?: unknown;
    error?: string;
    method?: string;
    id?: string;
    params?: unknown;
    result?: unknown;
  }): void {
    switch (message.type) {
      case 'status':
        this.updateStatus(message.data as Partial<McpHostStatus>);
        break;
      case 'error':
        console.error('MCP Host error:', message.error);
        break;
      // Handle RPC messages
      case 'rpc_request':
        if (message.method) {
          this.handleRpcRequest(message as { method: string; id?: string; params?: unknown });
        }
        break;
      case 'rpc_response':
        if (message.id) {
          this.handleRpcResponse(
            message as { id: string; result?: unknown; error?: { code: number; message: string; data?: unknown } },
          );
        }
        break;
      default:
        console.log('Unknown message from MCP Host:', message);
    }
  }

  /**
   * Handles disconnection from the MCP Host.
   * @private
   */
  private handleDisconnect(): void {
    this.stopHeartbeat();
    this.port = null;
    this.updateStatus({ isConnected: false });
  }

  /**
   * Updates the status object and notifies listeners.
   * @param {Partial<McpHostStatus>} updates Status properties to update.
   * @private
   */
  private updateStatus(updates: Partial<McpHostStatus>): void {
    // Update status
    this.status = {
      ...this.status,
      ...updates,
    };

    // Notify listeners
    this.notifyListeners();
  }

  /**
   * Notifies all registered listeners of the current status.
   * @private
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.getStatus());
      } catch (error) {
        console.error('Error in status listener:', error);
      }
    }
  }

  /**
   * Starts the heartbeat mechanism.
   * @private
   */
  private startHeartbeat(): void {
    // Clear any existing heartbeat
    this.stopHeartbeat();

    // Set up new heartbeat interval
    // Use globalThis to be compatible with both browser and Node.js environments
    this.heartbeatInterval = globalThis.setInterval(() => {
      this.sendPing();
    }, this.HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Stops the heartbeat mechanism.
   * @private
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
      this.pingTimeout = null;
    }
  }

  /**
   * Sends a ping message to check if the MCP Host is alive using RPC.
   * @private
   */
  private sendPing(): void {
    if (!this.port) {
      this.stopHeartbeat();
      return;
    }

    // Clear any previous ping timeout
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
      this.pingTimeout = null;
    }

    // Use RPC to send ping request
    this.rpcRequest(
      {
        method: 'ping',
        params: {},
      },
      { timeout: this.PING_TIMEOUT_MS },
    )
      .then(response => {
        console.log('Ping response:', response);

        // Process successful response, update the last heartbeat time
        if (
          response &&
          response.result &&
          typeof response.result === 'object' &&
          response.result !== null &&
          'timestamp' in response.result
        ) {
          this.updateStatus({ lastHeartbeat: (response.result as { timestamp: number }).timestamp });
        }
      })
      .catch(error => {
        // Connection might be lost or request timed out
        console.log('Ping failed:', error.message || 'No response from MCP Host');

        // Mark as disconnected
        this.updateStatus({ isConnected: false });

        // Stop the heartbeat timers
        this.stopHeartbeat();

        // Clean up port reference since we're no longer connected
        this.port = null;
      });
  }
}
