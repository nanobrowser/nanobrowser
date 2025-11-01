import type { SerializedMessage } from './types';
import { createLogger } from '../../log';
import type { Logger } from '../../log';
import {
  WebSocketError,
  WebSocketErrorCategory,
  categorizeCloseEvent,
  createWebSocketError,
  isRecoverableError,
  sanitizeForLogging,
} from './errors';

// Create dedicated logger for connection management
const logger: Logger = createLogger('WebSocket:Connection');

/**
 * Connection state enumeration for WebSocket lifecycle tracking.
 */
export enum ConnectionState {
  /** WebSocket is not connected and not attempting to connect */
  DISCONNECTED = 'disconnected',
  /** WebSocket is attempting to establish initial connection */
  CONNECTING = 'connecting',
  /** WebSocket is successfully connected and ready for communication */
  CONNECTED = 'connected',
  /** WebSocket is attempting to reconnect after a disconnection */
  RECONNECTING = 'reconnecting',
}

/**
 * Connection event types emitted by the ConnectionManager.
 */
export enum ConnectionEvent {
  /** Emitted when connection state changes */
  STATE_CHANGE = 'state_change',
  /** Emitted when a message is received */
  MESSAGE = 'message',
  /** Emitted when a connection error occurs */
  ERROR = 'error',
}

/**
 * Connection configuration options.
 */
export interface ConnectionConfig {
  /** WebSocket server URL (ws:// or wss://) */
  serverUrl: string;
  /** Connection timeout in milliseconds */
  connectionTimeout: number;
  /** Maximum reconnection delay in milliseconds */
  maxReconnectDelay?: number;
  /** Initial reconnection delay in milliseconds */
  initialReconnectDelay?: number;
}

/**
 * Event listener callback type for connection events.
 */
export type ConnectionEventListener = (event: ConnectionEventData) => void;

/**
 * Connection event data passed to listeners.
 */
export interface ConnectionEventData {
  type: ConnectionEvent;
  state?: ConnectionState;
  message?: SerializedMessage;
  error?: Error;
}

/**
 * ConnectionManager handles the low-level WebSocket connection lifecycle.
 *
 * Responsibilities:
 * - Manage WebSocket instance creation and cleanup
 * - Track connection state with proper state transitions
 * - Implement exponential backoff reconnection strategy
 * - Handle WebSocket events (open, close, error, message)
 * - Emit connection events for higher-level handling
 *
 * State Machine:
 * DISCONNECTED -> CONNECTING -> CONNECTED
 *      ^              |              |
 *      |              v              v
 *      +-------- RECONNECTING <------+
 */
export class ConnectionManager {
  private ws: WebSocket | null = null;
  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners: Map<ConnectionEvent, Set<ConnectionEventListener>> = new Map();

  // Reconnection configuration
  private readonly maxReconnectDelay: number;
  private readonly initialReconnectDelay: number;

  constructor(private config: ConnectionConfig) {
    this.maxReconnectDelay = config.maxReconnectDelay ?? 30000; // 30 seconds
    this.initialReconnectDelay = config.initialReconnectDelay ?? 1000; // 1 second
  }

  /**
   * Get the current connection state.
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Check if the connection is active (connected or reconnecting).
   */
  isActive(): boolean {
    return this.state === ConnectionState.CONNECTED || this.state === ConnectionState.RECONNECTING;
  }

  /**
   * Check if the connection is ready to send messages.
   */
  isReady(): boolean {
    return this.state === ConnectionState.CONNECTED && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Add an event listener for connection events.
   */
  addEventListener(event: ConnectionEvent, listener: ConnectionEventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(listener);
  }

  /**
   * Remove an event listener.
   */
  removeEventListener(event: ConnectionEvent, listener: ConnectionEventListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  /**
   * Remove all event listeners for a specific event or all events.
   */
  removeAllEventListeners(event?: ConnectionEvent): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Emit a connection event to all registered listeners.
   */
  private emit(eventData: ConnectionEventData): void {
    const listeners = this.listeners.get(eventData.type);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(eventData);
        } catch (error) {
          const wsError = createWebSocketError(error, {
            eventType: eventData.type,
            state: this.state,
          });
          logger.error('Error in connection event listener:', wsError.toLoggableObject());
        }
      });
    }
  }

  /**
   * Update the connection state and emit state change event.
   */
  private setState(newState: ConnectionState): void {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;

      logger.info(`State transition: ${oldState} -> ${newState}`);
      logger.debug('Connection details:', {
        serverUrl: this.config.serverUrl,
        reconnectAttempts: this.reconnectAttempts,
        wsReadyState: this.ws?.readyState,
      });

      this.emit({
        type: ConnectionEvent.STATE_CHANGE,
        state: newState,
      });
    }
  }

  /**
   * Initiate a connection to the WebSocket server.
   */
  connect(): void {
    // Prevent multiple simultaneous connection attempts
    if (this.state === ConnectionState.CONNECTING || this.state === ConnectionState.CONNECTED) {
      logger.warning('Connection already in progress or established', {
        currentState: this.state,
        serverUrl: this.config.serverUrl,
      });
      return;
    }

    logger.info('Initiating connection', {
      serverUrl: this.config.serverUrl,
      timeout: this.config.connectionTimeout,
      reconnectAttempts: this.reconnectAttempts,
    });

    this.setState(ConnectionState.CONNECTING);
    this.clearTimers();

    try {
      // Validate URL before attempting connection
      if (!this.config.serverUrl) {
        throw new WebSocketError('Server URL is required', WebSocketErrorCategory.VALIDATION, {
          serverUrl: this.config.serverUrl,
        });
      }

      if (!this.config.serverUrl.startsWith('ws://') && !this.config.serverUrl.startsWith('wss://')) {
        throw new WebSocketError('Server URL must start with ws:// or wss://', WebSocketErrorCategory.VALIDATION, {
          serverUrl: this.config.serverUrl,
        });
      }

      this.ws = new WebSocket(this.config.serverUrl);
      this.setupWebSocketHandlers();

      // Set connection timeout
      this.connectionTimer = setTimeout(() => {
        if (this.state === ConnectionState.CONNECTING) {
          const timeoutError = new WebSocketError(
            `Connection timeout after ${this.config.connectionTimeout}ms`,
            WebSocketErrorCategory.TIMEOUT,
            {
              serverUrl: this.config.serverUrl,
              timeout: this.config.connectionTimeout,
            },
          );
          logger.error('Connection timeout', timeoutError.toLoggableObject());
          this.handleConnectionError(timeoutError);
        }
      }, this.config.connectionTimeout);
    } catch (error) {
      const wsError = createWebSocketError(error, {
        serverUrl: this.config.serverUrl,
        operation: 'connect',
      });
      logger.error('Failed to initiate connection', wsError.toLoggableObject());
      this.handleConnectionError(wsError);
    }
  }

  /**
   * Disconnect from the WebSocket server.
   */
  disconnect(): void {
    logger.info('Disconnecting', {
      currentState: this.state,
      reconnectAttempts: this.reconnectAttempts,
    });

    this.clearTimers();
    this.reconnectAttempts = 0;

    if (this.ws) {
      // Remove event listeners before closing to prevent reconnection
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;

      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        try {
          this.ws.close(1000, 'Client disconnect');
          logger.debug('WebSocket closed successfully');
        } catch (error) {
          const wsError = createWebSocketError(error, { operation: 'disconnect' });
          logger.warning('Error closing WebSocket', wsError.toLoggableObject());
        }
      }

      this.ws = null;
    }

    this.setState(ConnectionState.DISCONNECTED);
  }

  /**
   * Force a reconnection attempt.
   */
  reconnect(): void {
    logger.info('Forcing reconnection');
    this.disconnect();
    this.connect();
  }

  /**
   * Send a message through the WebSocket connection.
   * @throws WebSocketError if connection is not ready
   */
  send(message: SerializedMessage): void {
    if (!this.isReady()) {
      const error = new WebSocketError(
        `Cannot send message: connection is ${this.state}`,
        WebSocketErrorCategory.NETWORK,
        {
          state: this.state,
          wsReadyState: this.ws?.readyState,
        },
      );
      logger.error('Failed to send message', error.toLoggableObject());
      throw error;
    }

    try {
      logger.debug('Sending message', {
        messagePreview: sanitizeForLogging(message, 200),
        messageLength: message.length,
      });
      this.ws!.send(message);
    } catch (error) {
      const wsError = createWebSocketError(error, {
        operation: 'send',
        messageLength: message.length,
      });
      logger.error('Error sending message', wsError.toLoggableObject());
      throw wsError;
    }
  }

  /**
   * Setup event handlers for the WebSocket instance.
   */
  private setupWebSocketHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      this.clearTimers();
      this.reconnectAttempts = 0;
      logger.info('WebSocket connected', {
        serverUrl: this.config.serverUrl,
        protocol: this.ws?.protocol,
      });
      this.setState(ConnectionState.CONNECTED);
    };

    this.ws.onclose = event => {
      this.clearTimers();

      const category = categorizeCloseEvent(event.code);
      const isNormal = event.code === 1000;
      const logLevel = isNormal ? 'info' : 'warning';

      logger[logLevel]('WebSocket closed', {
        code: event.code,
        reason: event.reason || 'No reason provided',
        wasClean: event.wasClean,
        category,
      });

      // Only attempt reconnection if not explicitly disconnected
      if (this.state !== ConnectionState.DISCONNECTED) {
        if (!isNormal) {
          const closeError = new WebSocketError(`Connection closed: ${event.reason || 'No reason'}`, category, {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
          });
          this.emit({
            type: ConnectionEvent.ERROR,
            error: closeError,
          });
        }
        this.scheduleReconnection();
      }
    };

    this.ws.onerror = () => {
      const error = new WebSocketError('WebSocket error occurred', WebSocketErrorCategory.NETWORK, {
        serverUrl: this.config.serverUrl,
        readyState: this.ws?.readyState,
      });
      logger.error('WebSocket error event', error.toLoggableObject());
      this.emit({
        type: ConnectionEvent.ERROR,
        error,
      });
    };

    this.ws.onmessage = event => {
      try {
        const message = String(event.data);
        logger.debug('Message received', {
          messagePreview: sanitizeForLogging(message, 200),
          messageLength: message.length,
        });
        this.emit({
          type: ConnectionEvent.MESSAGE,
          message,
        });
      } catch (error) {
        const wsError = createWebSocketError(error, {
          operation: 'onmessage',
          dataType: typeof event.data,
        });
        logger.error('Error handling message', wsError.toLoggableObject());
        this.emit({
          type: ConnectionEvent.ERROR,
          error: wsError,
        });
      }
    };
  }

  /**
   * Handle connection errors.
   */
  private handleConnectionError(error: Error): void {
    const wsError =
      error instanceof WebSocketError
        ? error
        : createWebSocketError(error, {
            serverUrl: this.config.serverUrl,
            operation: 'handleConnectionError',
          });

    logger.error('Connection error', wsError.toLoggableObject());

    this.emit({
      type: ConnectionEvent.ERROR,
      error: wsError,
    });

    this.clearTimers();

    if (this.ws) {
      try {
        this.ws.close();
      } catch (closeError) {
        logger.warning('Error closing WebSocket after connection error', {
          originalError: wsError.toLoggableObject(),
          closeError: createWebSocketError(closeError).toLoggableObject(),
        });
      }
      this.ws = null;
    }

    // Only schedule reconnection for recoverable errors
    if (isRecoverableError(wsError)) {
      this.scheduleReconnection();
    } else {
      logger.warning('Error is not recoverable, not scheduling reconnection', {
        category: wsError.category,
      });
      this.setState(ConnectionState.DISCONNECTED);
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   */
  private scheduleReconnection(): void {
    this.setState(ConnectionState.RECONNECTING);

    // Calculate delay with exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped)
    const baseDelay = this.initialReconnectDelay;
    const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);

    logger.info('Scheduling reconnection', {
      attempt: this.reconnectAttempts + 1,
      delayMs: delay,
      maxDelay: this.maxReconnectDelay,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      logger.debug('Executing reconnection attempt', {
        attempt: this.reconnectAttempts,
      });
      this.connect();
    }, delay);
  }

  /**
   * Clear all timers.
   */
  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }
  }

  /**
   * Clean up resources and disconnect.
   */
  destroy(): void {
    logger.info('Destroying connection manager');
    this.disconnect();
    this.removeAllEventListeners();
  }
}
