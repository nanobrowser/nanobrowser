import { Amplify } from 'aws-amplify';
import { events } from 'aws-amplify/data';
import { amplifyConfigStore } from '@extension/storage';
import { instanceIdService } from './instanceId';
import { createLogger } from '../log';
import {
  AppSyncEventPayload,
  AppSyncEventResponse,
  AppSyncResponseStatus,
  ConnectionStatus,
  ConnectionError,
  AppSyncEventsServiceConfig,
} from './appSyncEvents/types';
import { validateEventPayload, actionHandlers } from './appSyncEvents/handlers';

const logger = createLogger('AmplifyEventsService');

/**
 * Service for managing AWS AppSync Events integration
 * Handles real-time communication with AppSync Event API
 */
export class AmplifyEventsService {
  private channel: any = null;
  private instanceId: string = '';
  private config: AppSyncEventsServiceConfig | null = null;
  private connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number = 5;
  private readonly baseReconnectDelay: number = 1000; // 1 second
  private reconnectTimer: NodeJS.Timeout | null = null;

  /**
   * Initialize the AmplifyEventsService
   */
  async initialize(): Promise<void> {
    logger.info('Initializing AmplifyEventsService');

    try {
      // Get Amplify configuration
      const amplifyConfig = await amplifyConfigStore.getConfig();

      if (!amplifyConfig.enabled) {
        logger.info('Amplify Events is disabled');
        return;
      }

      // Validate configuration
      const isValidConfig = await amplifyConfigStore.validateConfig();
      if (!isValidConfig) {
        throw new Error('Invalid Amplify configuration');
      }

      // Get instance ID
      this.instanceId = await instanceIdService.getInstanceId();

      // Set up service configuration
      this.config = {
        enabled: amplifyConfig.enabled,
        endpoint: amplifyConfig.endpoint,
        region: amplifyConfig.region,
        apiKey: amplifyConfig.apiKey,
        channelNamespace: amplifyConfig.channelNamespace,
        instanceId: this.instanceId,
      };

      await this.connect();
    } catch (error) {
      logger.error('Failed to initialize AmplifyEventsService:', error);
      this.connectionStatus = ConnectionStatus.ERROR;
      throw error;
    }
  }

  /**
   * Connect to AppSync Events
   */
  private async connect(): Promise<void> {
    if (!this.config) {
      throw new Error('Service not configured');
    }

    try {
      logger.info('Connecting to AppSync Events...');
      this.connectionStatus = ConnectionStatus.CONNECTING;

      // Configure Amplify with Event API settings
      const amplifyConfig = {
        API: {
          Events: {
            endpoint: this.config.endpoint,
            region: this.config.region,
            defaultAuthMode: 'apiKey' as const,
            apiKey: this.config.apiKey,
          },
        },
      };

      Amplify.configure(amplifyConfig);

      // Connect to instance-specific channel
      const channelPath = `/${this.config.channelNamespace}/${this.instanceId}`;
      logger.info('Connecting to channel:', channelPath);

      this.channel = await events.connect(channelPath);

      // Subscribe to events
      this.channel.subscribe({
        next: (data: any) => this.handleIncomingEvent(data),
        error: (error: any) => this.handleConnectionError(error),
        complete: () => logger.info('Channel subscription completed'),
      });

      this.connectionStatus = ConnectionStatus.CONNECTED;
      this.reconnectAttempts = 0;
      this.clearReconnectTimer();

      logger.info('Successfully connected to AppSync Events');
    } catch (error) {
      logger.error('Failed to connect to AppSync Events:', error);
      this.connectionStatus = ConnectionStatus.ERROR;
      this.scheduleReconnect();
      throw error;
    }
  }

  /**
   * Handle incoming AppSync events
   */
  private async handleIncomingEvent(data: any): Promise<void> {
    logger.info('Received AppSync event:', data);

    try {
      const event: AppSyncEventPayload = data;

      // Validate the event payload
      const validation = validateEventPayload(event);
      if (!validation.isValid) {
        const errorMessage = `Invalid event payload: ${validation.errors.join(', ')}`;
        logger.error(errorMessage);
        await this.sendErrorResponse(event.eventId, event.instanceId, errorMessage);
        return;
      }

      // Check if the event is for this instance
      if (event.instanceId !== this.instanceId) {
        logger.info('Received event for different instance:', event.instanceId);
        return;
      }

      // Send immediate processing response
      await this.sendResponse({
        eventId: event.eventId,
        instanceId: event.instanceId,
        status: AppSyncResponseStatus.PROCESSING,
        timestamp: Date.now(),
      });

      // Handle the event based on action type
      const handler = actionHandlers[event.actionType];
      if (!handler) {
        throw new Error(`Unknown action type: ${event.actionType}`);
      }

      const result = await handler(event);

      // Send success response
      await this.sendResponse({
        eventId: event.eventId,
        instanceId: event.instanceId,
        status: AppSyncResponseStatus.SUCCESS,
        result,
        timestamp: Date.now(),
      });
    } catch (error) {
      logger.error('Error handling incoming event:', error);

      // Extract event info for error response
      const eventId = (data as any)?.eventId || 'unknown';
      const instanceId = (data as any)?.instanceId || this.instanceId;

      await this.sendErrorResponse(eventId, instanceId, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Send a response back to AppSync
   */
  async sendResponse(response: AppSyncEventResponse): Promise<void> {
    if (!this.config) {
      logger.error('Cannot send response: service not configured');
      return;
    }

    try {
      const responsePath = `/${this.config.channelNamespace}/${this.instanceId}/response`;
      logger.info('Sending response to channel:', responsePath, response);

      await events.post(responsePath, response as any);
    } catch (error) {
      logger.error('Failed to send response:', error);
    }
  }

  /**
   * Send an error response
   */
  private async sendErrorResponse(eventId: string, instanceId: string, errorMessage: string): Promise<void> {
    await this.sendResponse({
      eventId,
      instanceId,
      status: AppSyncResponseStatus.ERROR,
      error: errorMessage,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle connection errors
   */
  private handleConnectionError(error: any): void {
    logger.error('AppSync Events connection error:', error);
    this.connectionStatus = ConnectionStatus.ERROR;
    this.scheduleReconnect();
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    logger.info(`Scheduling reconnection attempt ${this.reconnectAttempts} in ${delay}ms`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        this.connectionStatus = ConnectionStatus.RECONNECTING;
        await this.connect();
      } catch (error) {
        logger.error('Reconnection failed:', error);
      }
    }, delay);
  }

  /**
   * Clear the reconnection timer
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Get current connection status
   */
  getConnectionStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  /**
   * Get instance ID
   */
  getInstanceId(): string {
    return this.instanceId;
  }

  /**
   * Check if the service is connected
   */
  isConnected(): boolean {
    return this.connectionStatus === ConnectionStatus.CONNECTED;
  }

  /**
   * Manually trigger a reconnection
   */
  async reconnect(): Promise<void> {
    logger.info('Manual reconnection triggered');
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();
    await this.cleanup();
    await this.initialize();
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up AmplifyEventsService');

    this.clearReconnectTimer();

    if (this.channel) {
      try {
        await this.channel.close();
      } catch (error) {
        logger.error('Error closing channel:', error);
      }
      this.channel = null;
    }

    this.connectionStatus = ConnectionStatus.DISCONNECTED;
    this.config = null;
  }
}
