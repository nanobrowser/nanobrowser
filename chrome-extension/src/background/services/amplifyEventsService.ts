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
  private pendingEvents: Map<string, AppSyncEventPayload> = new Map(); // Track events waiting for completion

  /**
   * Initialize the AmplifyEventsService
   */
  async initialize(): Promise<void> {
    logger.info('Initializing AmplifyEventsService');

    try {
      // Load any persisted pending events first
      await this.loadPendingEventsFromStorage();

      // Get Amplify configuration
      const amplifyConfig = await amplifyConfigStore.getConfig();
      logger.info('Retrieved Amplify config:', {
        enabled: amplifyConfig.enabled,
        endpoint: amplifyConfig.endpoint,
        region: amplifyConfig.region,
      });

      if (!amplifyConfig.enabled) {
        logger.info('Amplify Events is disabled');
        return;
      }

      // Validate configuration
      const isValidConfig = await amplifyConfigStore.validateConfig();
      logger.info('Config validation result:', isValidConfig);
      if (!isValidConfig) {
        throw new Error('Invalid Amplify configuration');
      }

      // Get instance ID
      this.instanceId = await instanceIdService.getInstanceId();
      logger.info('Using instance ID:', this.instanceId);

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
      logger.info('Full channel path being used:', channelPath);

      this.channel = await events.connect(channelPath);
      logger.info('events.connect() completed successfully');

      // Subscribe to events
      this.channel.subscribe({
        next: (data: any) => {
          logger.info('🔥 RECEIVED EVENT from AppSync:', data);
          this.handleIncomingEvent(data);
        },
        error: (error: any) => {
          logger.error('❌ Channel subscription error:', error);
          this.handleConnectionError(error);
        },
        complete: () => logger.info('✅ Channel subscription completed'),
      });

      logger.info('Channel subscription setup completed');

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
      // Extract the actual event payload from the nested structure
      const event: AppSyncEventPayload = data.event || data;

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

      // Check if this event has already been processed to prevent duplicates
      if (this.pendingEvents.has(event.eventId)) {
        logger.info('Event already being processed:', event.eventId);
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

      // Store event for task completion tracking (for NEW_SESSION and similar long-running tasks)
      if (
        event.actionType === 'NEW_SESSION' ||
        event.actionType === 'SEND_CHAT' ||
        event.actionType === 'FOLLOW_UP_CHAT'
      ) {
        // Update the event with the actual taskId that was generated by the handler
        if (result.taskId) {
          event.taskId = result.taskId;
          logger.info('Updated event with taskId:', { eventId: event.eventId, taskId: result.taskId });
        }
        this.pendingEvents.set(event.eventId, event);
        await this.savePendingEventsToStorage();
        logger.info('Stored pending event:', {
          eventId: event.eventId,
          actionType: event.actionType,
          taskId: event.taskId,
        });

        // Don't send immediate success response for long-running tasks
        return;
      }

      // For immediate actions (SET_MODEL, STOP_CHAT), send success response immediately
      if (event.actionType === 'SET_MODEL' || event.actionType === 'STOP_CHAT') {
        await this.sendResponse({
          eventId: event.eventId,
          instanceId: event.instanceId,
          status: AppSyncResponseStatus.SUCCESS,
          result,
          timestamp: Date.now(),
        });
      }
      // For long-running tasks, the completion will be handled by executor event subscription
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
   * Handle task completion and send final results to AppSync
   */
  async handleTaskCompletion(taskId: string, success: boolean, result?: any, error?: string): Promise<void> {
    logger.info('Handling task completion:', { taskId, success, result });
    // Ensure we have the latest pending events from storage
    await this.loadPendingEventsFromStorage();
    logger.info(
      'Current pending events:',
      Array.from(this.pendingEvents.entries()).map(([id, event]) => ({
        eventId: id,
        actionType: event.actionType,
        taskId: event.taskId,
      })),
    );

    // Find the pending event that corresponds to this task
    let matchingEventId: string | null = null;
    for (const [eventId, event] of this.pendingEvents.entries()) {
      // Match by taskId directly
      if (event.taskId === taskId) {
        matchingEventId = eventId;
        logger.info('Found direct taskId match:', { eventId, taskId });
        break;
      }
    }

    if (!matchingEventId) {
      logger.info('No pending AppSync event found for completed task:', taskId);
      return;
    }

    const originalEvent = this.pendingEvents.get(matchingEventId);
    if (!originalEvent) {
      return;
    }

    try {
      if (success) {
        await this.sendResponse({
          eventId: originalEvent.eventId,
          instanceId: originalEvent.instanceId,
          status: AppSyncResponseStatus.SUCCESS,
          result: {
            taskId,
            sessionId: originalEvent.sessionId || taskId,
            status: 'completed',
            result: result,
            completedAt: Date.now(),
          },
          timestamp: Date.now(),
        });
      } else {
        await this.sendResponse({
          eventId: originalEvent.eventId,
          instanceId: originalEvent.instanceId,
          status: AppSyncResponseStatus.ERROR,
          error: error || 'Task execution failed',
          timestamp: Date.now(),
        });
      }

      // Remove from pending events
      this.pendingEvents.delete(matchingEventId);
      await this.savePendingEventsToStorage();
      logger.info('Task completion response sent for event:', matchingEventId);
    } catch (responseError) {
      logger.error('Failed to send task completion response:', responseError);
    }
  }

  /**
   * Get pending events (for debugging)
   */
  getPendingEvents(): Map<string, AppSyncEventPayload> {
    return this.pendingEvents;
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
    this.pendingEvents.clear();
  }

  /**
   * Saves the current pendingEvents map to chrome.storage.local
   */
  private async savePendingEventsToStorage(): Promise<void> {
    try {
      const eventsToStore = Array.from(this.pendingEvents.entries());
      await chrome.storage.local.set({ pendingAppSyncEvents: eventsToStore });
      logger.info('Saved pending events to storage.');
    } catch (error) {
      logger.error('Failed to save pending events to storage:', error);
    }
  }

  /**
   * Loads pendingEvents from chrome.storage.local
   */
  private async loadPendingEventsFromStorage(): Promise<void> {
    try {
      const result = await chrome.storage.local.get('pendingAppSyncEvents');
      if (result.pendingAppSyncEvents && Array.isArray(result.pendingAppSyncEvents)) {
        this.pendingEvents = new Map(result.pendingAppSyncEvents);
        logger.info(`Loaded ${this.pendingEvents.size} pending events from storage.`);
      }
    } catch (error) {
      logger.error('Failed to load pending events from storage:', error);
    }
  }
}
