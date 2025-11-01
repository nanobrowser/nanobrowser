import { websocketStore } from '@extension/storage';
import type { WebSocketConfig } from '@extension/storage';
import { ConnectionManager, ConnectionState, ConnectionEvent } from './connection';
import type { ConnectionEventData } from './connection';
import WebSocketMessageInterpreter from './protocol';
import type { OutgoingMessage, IncomingMessage } from './types';
import { createLogger } from '../../log';
import type { Logger } from '../../log';
import { WebSocketError, WebSocketErrorCategory, createWebSocketError, sanitizeForLogging } from './errors';

// Create dedicated logger for WebSocket service
const logger: Logger = createLogger('WebSocket:Service');

/**
 * Service event types for higher-level application integration.
 */
export enum ServiceEvent {
  /** Emitted when the service is initialized and ready */
  READY = 'ready',
  /** Emitted when connection state changes */
  CONNECTION_CHANGE = 'connection_change',
  /** Emitted when an incoming message is received */
  MESSAGE_RECEIVED = 'message_received',
  /** Emitted when an error occurs */
  ERROR = 'error',
}

/**
 * Service event data passed to listeners.
 */
export interface ServiceEventData {
  type: ServiceEvent;
  state?: ConnectionState;
  message?: IncomingMessage;
  error?: Error;
}

/**
 * Service event listener callback type.
 */
export type ServiceEventListener = (event: ServiceEventData) => void;

/**
 * WebSocketService provides a high-level interface for WebSocket communication.
 *
 * Responsibilities:
 * - Integrate with WebSocket settings from storage
 * - Manage ConnectionManager lifecycle
 * - Serialize/deserialize messages using WebSocketMessageInterpreter
 * - Provide type-safe message sending interface
 * - Emit service-level events for application integration
 * - Handle connection state changes and automatic reconnection
 *
 * Usage:
 * ```typescript
 * const service = new WebSocketService();
 * await service.initialize();
 *
 * service.addEventListener(ServiceEvent.MESSAGE_RECEIVED, (event) => {
 *   console.log('Received message:', event.message);
 * });
 *
 * if (service.isConnected()) {
 *   const message = WebSocketMessageInterpreter.createTaskAccepted('task-123');
 *   service.sendMessage(message);
 * }
 * ```
 */
export class WebSocketService {
  private connectionManager: ConnectionManager | null = null;
  private settings: WebSocketConfig | null = null;
  private listeners: Map<ServiceEvent, Set<ServiceEventListener>> = new Map();
  private isInitialized = false;

  /**
   * Initialize the service by loading settings and setting up connection if enabled.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warning('WebSocketService already initialized');
      return;
    }

    logger.info('Initializing WebSocketService');

    try {
      // Load settings from storage
      this.settings = await websocketStore.getSettings();
      logger.debug('Settings loaded', sanitizeForLogging(this.settings));

      // Subscribe to settings changes
      websocketStore.subscribe(this.handleSettingsChange.bind(this));
      logger.debug('Subscribed to settings changes');

      // Connect if enabled in settings
      if (this.settings.enabled) {
        logger.info('WebSocket enabled, connecting...');
        this.connect();
      } else {
        logger.info('WebSocket disabled in settings');
      }

      this.isInitialized = true;
      this.emit({
        type: ServiceEvent.READY,
      });

      logger.info('WebSocketService initialized successfully');
    } catch (error) {
      const wsError = createWebSocketError(error, {
        operation: 'initialize',
      });
      logger.error('Failed to initialize WebSocketService', wsError.toLoggableObject());

      this.emit({
        type: ServiceEvent.ERROR,
        error: wsError,
      });

      throw wsError;
    }
  }

  /**
   * Get the current connection state.
   */
  getConnectionState(): ConnectionState {
    return this.connectionManager?.getState() ?? ConnectionState.DISCONNECTED;
  }

  /**
   * Check if the service is connected and ready to send messages.
   */
  isConnected(): boolean {
    return this.connectionManager?.isReady() ?? false;
  }

  /**
   * Check if the service is active (connected or reconnecting).
   */
  isActive(): boolean {
    return this.connectionManager?.isActive() ?? false;
  }

  /**
   * Add an event listener for service events.
   */
  addEventListener(event: ServiceEvent, listener: ServiceEventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(listener);
  }

  /**
   * Remove an event listener.
   */
  removeEventListener(event: ServiceEvent, listener: ServiceEventListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  /**
   * Remove all event listeners for a specific event or all events.
   */
  removeAllEventListeners(event?: ServiceEvent): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Emit a service event to all registered listeners.
   */
  private emit(eventData: ServiceEventData): void {
    const listeners = this.listeners.get(eventData.type);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(eventData);
        } catch (error) {
          const wsError = createWebSocketError(error, {
            eventType: eventData.type,
            hasMessage: !!eventData.message,
            hasError: !!eventData.error,
          });
          logger.error('Error in service event listener', wsError.toLoggableObject());
        }
      });
    }
  }

  /**
   * Connect to the WebSocket server.
   */
  connect(): void {
    if (!this.settings) {
      const error = new WebSocketError('WebSocketService not initialized', WebSocketErrorCategory.VALIDATION);
      logger.error('Cannot connect: service not initialized', error.toLoggableObject());
      throw error;
    }

    if (!this.settings.enabled) {
      logger.warning('Cannot connect: WebSocket is disabled in settings');
      return;
    }

    if (this.connectionManager) {
      logger.warning('Connection manager already exists, skipping connect');
      return;
    }

    try {
      logger.info('Creating connection manager', {
        serverUrl: this.settings.serverUrl,
        timeout: this.settings.connectionTimeout,
      });

      this.connectionManager = new ConnectionManager({
        serverUrl: this.settings.serverUrl,
        connectionTimeout: this.settings.connectionTimeout,
      });

      // Setup connection event listeners
      this.connectionManager.addEventListener(
        ConnectionEvent.STATE_CHANGE,
        this.handleConnectionStateChange.bind(this),
      );
      this.connectionManager.addEventListener(ConnectionEvent.MESSAGE, this.handleConnectionMessage.bind(this));
      this.connectionManager.addEventListener(ConnectionEvent.ERROR, this.handleConnectionError.bind(this));

      this.connectionManager.connect();
      logger.debug('Connection manager created and connection initiated');
    } catch (error) {
      const wsError = createWebSocketError(error, {
        operation: 'connect',
        serverUrl: this.settings.serverUrl,
      });
      logger.error('Failed to create connection', wsError.toLoggableObject());

      this.emit({
        type: ServiceEvent.ERROR,
        error: wsError,
      });

      throw wsError;
    }
  }

  /**
   * Disconnect from the WebSocket server.
   */
  disconnect(): void {
    if (this.connectionManager) {
      logger.info('Disconnecting WebSocket service');
      try {
        this.connectionManager.disconnect();
        this.connectionManager.removeAllEventListeners();
        this.connectionManager = null;
        logger.debug('Disconnected successfully');
      } catch (error) {
        const wsError = createWebSocketError(error, { operation: 'disconnect' });
        logger.error('Error during disconnect', wsError.toLoggableObject());
        // Ensure cleanup even if disconnect fails
        this.connectionManager = null;
      }
    }
  }

  /**
   * Force a reconnection attempt.
   */
  reconnect(): void {
    logger.info('Forcing reconnection');
    try {
      if (this.connectionManager) {
        this.connectionManager.reconnect();
      } else {
        logger.debug('No existing connection manager, creating new connection');
        this.connect();
      }
    } catch (error) {
      const wsError = createWebSocketError(error, { operation: 'reconnect' });
      logger.error('Failed to reconnect', wsError.toLoggableObject());
      throw wsError;
    }
  }

  /**
   * Send a message through the WebSocket connection.
   * @throws WebSocketError if not connected or message serialization fails
   */
  sendMessage(message: OutgoingMessage): void {
    if (!this.isConnected()) {
      const error = new WebSocketError(
        `Cannot send message: connection is ${this.getConnectionState()}`,
        WebSocketErrorCategory.NETWORK,
        {
          state: this.getConnectionState(),
          messageType: message.type,
        },
      );
      logger.error('Cannot send message', error.toLoggableObject());
      throw error;
    }

    try {
      logger.debug('Sending message', {
        type: message.type,
        messageSummary: sanitizeForLogging(message, 100),
      });

      const serialized = WebSocketMessageInterpreter.send(message);
      this.connectionManager!.send(serialized);

      logger.debug('Message sent successfully', {
        type: message.type,
        serializedLength: serialized.length,
      });
    } catch (error) {
      const wsError = createWebSocketError(error, {
        operation: 'sendMessage',
        messageType: message.type,
      });
      logger.error('Failed to send message', wsError.toLoggableObject());

      this.emit({
        type: ServiceEvent.ERROR,
        error: wsError,
      });

      throw wsError;
    }
  }

  /**
   * Handle connection state changes from ConnectionManager.
   */
  private handleConnectionStateChange(event: ConnectionEventData): void {
    if (event.state) {
      logger.info('Connection state changed', { state: event.state });
      this.emit({
        type: ServiceEvent.CONNECTION_CHANGE,
        state: event.state,
      });
    }
  }

  /**
   * Handle incoming messages from ConnectionManager.
   */
  private handleConnectionMessage(event: ConnectionEventData): void {
    if (!event.message) {
      logger.warning('Received message event with no message data');
      return;
    }

    try {
      logger.debug('Processing incoming message', {
        messagePreview: sanitizeForLogging(event.message, 200),
        messageLength: event.message.length,
      });

      // Deserialize and validate the message
      const message = WebSocketMessageInterpreter.receive(event.message);

      logger.debug('Message deserialized successfully', {
        type: message.type,
      });

      this.emit({
        type: ServiceEvent.MESSAGE_RECEIVED,
        message,
      });
    } catch (error) {
      const wsError = createWebSocketError(error, {
        operation: 'handleConnectionMessage',
        messageLength: event.message?.length,
        messagePreview: sanitizeForLogging(event.message, 100),
      });
      logger.error('Failed to process incoming message', wsError.toLoggableObject());

      this.emit({
        type: ServiceEvent.ERROR,
        error: wsError,
      });
      // Don't throw - continue processing other messages
    }
  }

  /**
   * Handle connection errors from ConnectionManager.
   */
  private handleConnectionError(event: ConnectionEventData): void {
    if (event.error) {
      const wsError =
        event.error instanceof WebSocketError
          ? event.error
          : createWebSocketError(event.error, { source: 'ConnectionManager' });

      logger.error('Connection error received', wsError.toLoggableObject());

      this.emit({
        type: ServiceEvent.ERROR,
        error: wsError,
      });
    }
  }

  /**
   * Handle settings changes from storage.
   */
  private async handleSettingsChange(): Promise<void> {
    try {
      logger.debug('Settings change detected, reloading...');

      const newSettings = await websocketStore.getSettings();
      const oldSettings = this.settings;
      this.settings = newSettings;

      logger.info('Settings updated', {
        enabledChanged: oldSettings?.enabled !== newSettings.enabled,
        urlChanged: oldSettings?.serverUrl !== newSettings.serverUrl,
        timeoutChanged: oldSettings?.connectionTimeout !== newSettings.connectionTimeout,
      });

      // Handle enabled/disabled state changes
      if (oldSettings?.enabled !== newSettings.enabled) {
        if (newSettings.enabled) {
          logger.info('WebSocket enabled, connecting...');
          this.connect();
        } else {
          logger.info('WebSocket disabled, disconnecting...');
          this.disconnect();
        }
        return;
      }

      // Handle server URL or timeout changes while connected
      if (
        this.connectionManager &&
        (oldSettings?.serverUrl !== newSettings.serverUrl ||
          oldSettings?.connectionTimeout !== newSettings.connectionTimeout)
      ) {
        logger.info('Connection settings changed, reconnecting...', {
          oldUrl: oldSettings?.serverUrl,
          newUrl: newSettings.serverUrl,
          oldTimeout: oldSettings?.connectionTimeout,
          newTimeout: newSettings.connectionTimeout,
        });
        this.disconnect();
        if (newSettings.enabled) {
          this.connect();
        }
      }
    } catch (error) {
      const wsError = createWebSocketError(error, {
        operation: 'handleSettingsChange',
      });
      logger.error('Failed to handle settings change', wsError.toLoggableObject());

      this.emit({
        type: ServiceEvent.ERROR,
        error: wsError,
      });
      // Don't throw - keep service running with old settings
    }
  }

  /**
   * Clean up resources and disconnect.
   */
  destroy(): void {
    logger.info('Destroying WebSocket service');
    try {
      this.disconnect();
      this.removeAllEventListeners();
      this.isInitialized = false;
      this.settings = null;
      logger.debug('Service destroyed successfully');
    } catch (error) {
      const wsError = createWebSocketError(error, { operation: 'destroy' });
      logger.error('Error during service destroy', wsError.toLoggableObject());
      // Ensure cleanup even if errors occur
      this.isInitialized = false;
      this.settings = null;
    }
  }
}

/**
 * Singleton instance of WebSocketService for application-wide use.
 * Call initialize() before using.
 */
export const webSocketService = new WebSocketService();
