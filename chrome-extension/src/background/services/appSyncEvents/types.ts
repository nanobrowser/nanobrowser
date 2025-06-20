import { AgentNameEnum } from '@extension/storage';

/**
 * AppSync Event Action Types
 * These are the supported actions that can be sent via AppSync Events
 */
export enum AppSyncActionType {
  NEW_SESSION = 'NEW_SESSION',
  SEND_CHAT = 'SEND_CHAT',
  STOP_CHAT = 'STOP_CHAT',
  FOLLOW_UP_CHAT = 'FOLLOW_UP_CHAT',
  SET_MODEL = 'SET_MODEL',
}

/**
 * Model configuration for SET_MODEL action
 */
export interface ModelConfig {
  agent: AgentNameEnum;
  provider: string;
  model: string;
}

/**
 * Main event payload structure received from AppSync
 */
export interface AppSyncEventPayload {
  eventId: string; // Unique event identifier
  timestamp: number;
  instanceId: string; // Target instance ID
  actionType: AppSyncActionType;

  // Action-specific data
  sessionId?: string;
  taskId?: string;
  message?: string;
  modelConfig?: ModelConfig;
  metadata?: Record<string, any>;
}

/**
 * Response status types
 */
export enum AppSyncResponseStatus {
  SUCCESS = 'success',
  ERROR = 'error',
  PROCESSING = 'processing',
}

/**
 * Response payload structure sent back to AppSync
 */
export interface AppSyncEventResponse {
  eventId: string;
  instanceId: string;
  status: AppSyncResponseStatus;
  result?: any;
  error?: string;
  timestamp: number;
}

/**
 * Action handler result interface
 */
export interface ActionHandlerResult {
  sessionId?: string;
  taskId?: string;
  status: string;
  message?: string;
  result?: any;
  [key: string]: any;
}

/**
 * Action handler function type
 */
export type ActionHandler = (event: AppSyncEventPayload) => Promise<ActionHandlerResult>;

/**
 * Connection status for the AppSync Events service
 */
export enum ConnectionStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
  ERROR = 'ERROR',
}

/**
 * AppSync Events service configuration
 */
export interface AppSyncEventsServiceConfig {
  enabled: boolean;
  endpoint: string;
  region: string;
  apiKey: string;
  channelNamespace: string;
  instanceId: string;
}

/**
 * Event validation result
 */
export interface EventValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Connection error types
 */
export enum ConnectionError {
  CONFIGURATION_INVALID = 'CONFIGURATION_INVALID',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}
