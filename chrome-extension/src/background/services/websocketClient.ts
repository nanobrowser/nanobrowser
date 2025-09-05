import { websocketServerStore, type WebSocketServerSettings } from '@extension/storage';
import { createLogger } from '../log';
import { Executor } from '../agent/executor';
import type { ExecutorOptions } from '../agent/types';
import type BrowserContext from '../browser/context';

const logger = createLogger('websocket-client');

export interface WebSocketMessage {
  type: string;
  taskId?: string;
  task?: string;
  options?: Record<string, any>;
  timestamp?: string;
  clientId?: string;
  error?: string;
  result?: any;
  step?: string;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private settings: WebSocketServerSettings;
  private reconnectAttempts = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private isIntentionalDisconnect = false;
  private onTaskReceivedCallback?: (taskId: string, task: string, options?: Record<string, any>) => Promise<void>;

  constructor(settings: WebSocketServerSettings) {
    this.settings = settings;
  }

  public setTaskHandler(callback: (taskId: string, task: string, options?: Record<string, any>) => Promise<void>): void {
    this.onTaskReceivedCallback = callback;
  }

  public async connect(): Promise<void> {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.CONNECTING)) {
      logger.info('Connection already in progress');
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      logger.info('Already connected');
      return;
    }

    this.isConnecting = true;
    this.isIntentionalDisconnect = false;

    try {
      logger.info(`Connecting to WebSocket server: ${this.settings.serverUrl}`);
      
      this.ws = new WebSocket(this.settings.serverUrl);
      
      // Set connection timeout
      const connectionTimeout = setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
          logger.error('Connection timeout');
          this.ws.close();
          this.handleConnectionError(new Error('Connection timeout'));
        }
      }, this.settings.connectionTimeout);

      this.ws.onopen = () => {
        clearTimeout(connectionTimeout);
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        logger.info('Connected to WebSocket server');
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onclose = (event) => {
        clearTimeout(connectionTimeout);
        this.isConnecting = false;
        this.stopHeartbeat();
        
        logger.info(`WebSocket connection closed: ${event.code} - ${event.reason}`);
        
        if (!this.isIntentionalDisconnect) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        clearTimeout(connectionTimeout);
        logger.error('WebSocket error:', error);
        this.handleConnectionError(error);
      };

    } catch (error) {
      this.isConnecting = false;
      logger.error('Failed to create WebSocket connection:', error);
      this.handleConnectionError(error);
    }
  }

  public disconnect(): void {
    this.isIntentionalDisconnect = true;
    this.stopHeartbeat();
    this.clearReconnectTimer();

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, 'Intentional disconnect');
      }
      this.ws = null;
    }

    logger.info('Disconnected from WebSocket server');
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  public sendMessage(message: WebSocketMessage): void {
    if (!this.isConnected()) {
      logger.warn('Cannot send message: WebSocket not connected');
      return;
    }

    try {
      const messageString = JSON.stringify(message);
      this.ws!.send(messageString);
      logger.debug('Sent message:', message.type, message.taskId);
    } catch (error) {
      logger.error('Failed to send message:', error);
    }
  }

  public updateSettings(settings: WebSocketServerSettings): void {
    const wasConnected = this.isConnected();
    
    this.settings = settings;
    
    // If URL changed and we were connected, reconnect
    if (wasConnected && this.settings.enabled) {
      this.disconnect();
      setTimeout(() => this.connect(), 1000);
    }
  }

  private handleMessage(data: string): void {
    try {
      const message: WebSocketMessage = JSON.parse(data);
      logger.debug('Received message:', message.type, message.taskId);

      switch (message.type) {
        case 'connection_established':
          logger.info('Connection established with server');
          break;

        case 'execute_task':
          this.handleExecuteTask(message);
          break;

        case 'heartbeat_response':
          // Heartbeat acknowledged by server
          break;

        default:
          logger.warn('Unknown message type:', message.type);
      }
    } catch (error) {
      logger.error('Failed to parse message:', error);
    }
  }

  private async handleExecuteTask(message: WebSocketMessage): Promise<void> {
    if (!message.taskId || !message.task) {
      logger.error('Invalid execute_task message: missing taskId or task');
      return;
    }

    logger.info(`Received task: ${message.taskId} - ${message.task}`);

    // Send task started notification
    this.sendMessage({
      type: 'task_started',
      taskId: message.taskId,
      timestamp: new Date().toISOString()
    });

    try {
      // Execute the task through the callback
      if (this.onTaskReceivedCallback) {
        await this.onTaskReceivedCallback(message.taskId, message.task, message.options);
      } else {
        throw new Error('No task handler available');
      }
    } catch (error) {
      logger.error(`Task failed: ${message.taskId}`, error);
      this.sendMessage({
        type: 'task_failed',
        taskId: message.taskId,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected()) {
        this.sendMessage({
          type: 'heartbeat',
          timestamp: new Date().toISOString()
        });
      }
    }, this.settings.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.settings.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached');
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const delay = this.settings.reconnectInterval * Math.pow(2, this.reconnectAttempts); // Exponential backoff
    
    logger.info(`Scheduling reconnection in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
  }

  private handleConnectionError(error: any): void {
    this.isConnecting = false;
    logger.error('WebSocket connection error:', error);
    
    if (!this.isIntentionalDisconnect) {
      this.scheduleReconnect();
    }
  }

  // Methods for sending task updates
  public sendTaskProgress(taskId: string, step: string): void {
    this.sendMessage({
      type: 'task_progress',
      taskId,
      step,
      timestamp: new Date().toISOString()
    });
  }

  public sendTaskCompleted(taskId: string, result: any): void {
    this.sendMessage({
      type: 'task_completed',
      taskId,
      result,
      timestamp: new Date().toISOString()
    });
  }

  public sendTaskFailed(taskId: string, error: string): void {
    this.sendMessage({
      type: 'task_failed',
      taskId,
      error,
      timestamp: new Date().toISOString()
    });
  }
}