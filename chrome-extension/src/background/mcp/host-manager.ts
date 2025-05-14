/**
 * MCP Host Manager
 *
 * This class manages the connection to the MCP Host process, monitors its status,
 * and provides methods to control it (start, stop, etc.).
 */

// Define the MCP Host status interface
export interface McpHostStatus {
  isConnected: boolean;
  startTime: number | null;
  lastHeartbeat: number | null;
  version: string | null;
  runMode: string | null;
}

// Define MCP Server status interface
export interface McpServerStatus {
  isRunning: boolean;
  config: {
    port: number | null;
    logLevel: string | null;
  } | null;
}

// Define MCP Server config interface
export interface McpServerConfig {
  port: number;
  logLevel: string;
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
  // Track MCP server status
  private serverStatus: McpServerStatus = {
    isRunning: false,
    config: null,
  };
  private listeners: StatusListener[] = [];
  // Server status listeners
  private serverStatusListeners: ((status: McpServerStatus) => void)[] = [];
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private pingTimeout: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_INTERVAL_MS = 10000; // 10 seconds
  private readonly PING_TIMEOUT_MS = 20000; // 20 seconds
  private readonly GRACEFUL_SHUTDOWN_TIMEOUT_MS = 1000; // 1 second

  /**
   * Establishes a connection to the MCP Host Native Messaging host.
   * @returns {boolean} True if connection was established, false otherwise.
   */
  public connect(): boolean {
    // Don't reconnect if already connected
    if (this.port) {
      return false;
    }

    try {
      // Connect to the native messaging host
      this.port = chrome.runtime.connectNative('dev.nanobrowser.mcp.host');

      // Set up message and disconnect handlers
      this.port.onMessage.addListener(this.handleMessage.bind(this));
      this.port.onDisconnect.addListener(this.handleDisconnect.bind(this));

      // Update and broadcast status
      this.updateStatus({ isConnected: true });

      // Start heartbeat
      this.startHeartbeat();

      // Request initial status
      this.requestStatus();

      return true;
    } catch (error) {
      console.error('Failed to connect to MCP Host:', error);
      return false;
    }
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
   */
  public async startMcpHost(options: McpHostOptions): Promise<boolean> {
    // Don't start if already connected
    if (this.status.isConnected) {
      return false;
    }

    // Send start request to the main extension process
    return new Promise(resolve => {
      chrome.runtime.sendMessage(
        {
          type: 'startMcpHost',
          options,
        },
        response => {
          if (response && response.success) {
            // Try to connect to the newly started Host
            setTimeout(() => {
              this.connect();
              resolve(true);
            }, 500); // Give some time for the process to start
          } else {
            resolve(false);
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
   * Handles incoming messages from the MCP Host.
   * @param {any} message The received message.
   * @private
   */

  /**
   * Adds a listener for MCP server status changes.
   * @param listener Function that will be called when server status changes
   */
  public addServerStatusListener(listener: (status: McpServerStatus) => void): void {
    this.serverStatusListeners.push(listener);
  }

  /**
   * Removes a server status listener.
   * @param listener The listener to remove
   */
  public removeServerStatusListener(listener: (status: McpServerStatus) => void): void {
    const index = this.serverStatusListeners.indexOf(listener);
    if (index !== -1) {
      this.serverStatusListeners.splice(index, 1);
    }
  }

  /**
   * Gets the current server status without sending a request.
   * @returns Current server status
   */
  public getCurrentServerStatus(): McpServerStatus {
    return { ...this.serverStatus };
  }

  /**
   * Updates the server status and notifies listeners.
   * @param status New server status
   */
  private updateServerStatus(status: McpServerStatus): void {
    this.serverStatus = status;

    // Notify listeners
    for (const listener of this.serverStatusListeners) {
      try {
        listener({ ...this.serverStatus });
      } catch (error) {
        console.error('Error in server status listener:', error);
      }
    }
  }

  private handleMessage(message: any): void {
    switch (message.type) {
      case 'status':
        this.updateStatus(message.data);
        break;
      case 'ping_result':
        this.updateStatus({ lastHeartbeat: message.timestamp });
        break;
      case 'error':
        console.error('MCP Host error:', message.error);
        break;
      // Handle MCP server status response
      case 'mcpServerStatus':
        if (message.isRunning !== undefined) {
          this.updateServerStatus({
            isRunning: message.isRunning,
            config: message.config || null,
          });
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
   * Sends a ping message to check if the MCP Host is alive.
   * @private
   */
  private sendPing(): void {
    if (!this.port) {
      this.stopHeartbeat();
      return;
    }

    // Send ping message
    this.port.postMessage({ type: 'ping' });

    // Set timeout for response
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
    }

    this.pingTimeout = globalThis.setTimeout(() => {
      // No ping response within timeout period, consider connection lost
      console.log('Ping timeout: no response from MCP Host');

      // Mark as disconnected
      this.updateStatus({ isConnected: false });

      // Stop the heartbeat timers
      this.stopHeartbeat();

      // Clean up port reference since we're no longer connected
      this.port = null;
    }, this.PING_TIMEOUT_MS);
  }

  /**
   * Requests status information from the MCP Host.
   * @private
   */
  private requestStatus(): void {
    if (!this.port) {
      return;
    }

    // Request host status
    this.port.postMessage({ type: 'getStatus' });

    // Also request server status (since server auto-starts with host)
    this.port.postMessage({ type: 'getMcpServerStatus' });
  }

  /**
   * Starts the MCP HTTP server with the given configuration.
   * @param {McpServerConfig} config Configuration for the MCP server.
   * @returns {Promise<boolean>} True if the server was started successfully.
   */
  public async startMcpServer(config: McpServerConfig): Promise<boolean> {
    if (!this.port || !this.status.isConnected) {
      console.warn('Cannot start MCP server: host not connected');
      return false;
    }

    return new Promise(resolve => {
      this.port?.postMessage({
        type: 'startMcpServer',
        port: config.port,
        logLevel: config.logLevel,
      });

      // We'll just assume it worked for now since we don't have a callback mechanism
      // In a real implementation, we'd wait for a response and check for success
      setTimeout(() => {
        resolve(true);
      }, 500);
    });
  }

  /**
   * Stops the MCP HTTP server.
   * @returns {Promise<boolean>} True if the server was stopped successfully.
   */
  public async stopMcpServer(): Promise<boolean> {
    if (!this.port || !this.status.isConnected) {
      console.warn('Cannot stop MCP server: host not connected');
      return false;
    }

    return new Promise(resolve => {
      this.port?.postMessage({
        type: 'stopMcpServer',
      });

      // We'll just assume it worked for now since we don't have a callback mechanism
      // In a real implementation, we'd wait for a response and check for success
      setTimeout(() => {
        resolve(true);
      }, 500);
    });
  }

  /**
   * Gets the current MCP server status.
   * @returns {Promise<McpServerStatus>} The current server status.
   */
  public async getMcpServerStatus(): Promise<McpServerStatus> {
    if (!this.port || !this.status.isConnected) {
      console.warn('Cannot get MCP server status: host not connected');
      return {
        isRunning: false,
        config: null,
      };
    }

    return new Promise(resolve => {
      this.port?.postMessage({
        type: 'getMcpServerStatus',
      });

      // Since we don't have a proper callback mechanism yet,
      // we'll just return a default value after a timeout
      // In a real implementation, we'd wait for a response
      setTimeout(() => {
        resolve({
          isRunning: false,
          config: null,
        });
      }, 500);
    });
  }

  /**
   * Updates the browser state on the MCP server.
   * @param {any} state The browser state to send to the MCP server.
   */
  public updateBrowserState(state: any): void {
    if (!this.port || !this.status.isConnected) {
      console.warn('Cannot update browser state: host not connected');
      return;
    }

    this.port.postMessage({
      type: 'setBrowserState',
      state,
    });
  }
}
