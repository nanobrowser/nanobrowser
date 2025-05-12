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
  private heartbeatInterval: number | null = null;
  private pingTimeout: number | null = null;
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
      this.port = chrome.runtime.connectNative('mcp_host');

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
    this.heartbeatInterval = window.setInterval(() => {
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

    this.pingTimeout = window.setTimeout(() => {
      // No ping response within timeout period, consider connection lost
      this.updateStatus({ isConnected: false });
      this.stopHeartbeat();
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

    this.port.postMessage({ type: 'getStatus' });
  }
}
