import type { AgentEvent } from '../../agent/event/types';

/**
 * WebSocket message protocol types for bidirectional communication
 * between the extension and external WebSocket server.
 *
 * Message flow:
 * - Server → Extension: ExecuteTaskMessage (task requests)
 * - Extension → Server: TaskAcceptedMessage | TaskRejectedMessage (responses)
 * - Extension → Server: ExecutionEventMessage (ongoing task events)
 * - Server ↔ Extension: PingMessage | PongMessage (heartbeat)
 */

// ============================================================================
// Incoming Messages (Server → Extension)
// ============================================================================

/**
 * Message type sent by the server to request task execution.
 * The extension will validate and either accept or reject the task.
 */
export interface ExecuteTaskMessage {
  type: 'execute_task';
  taskId: string;
  prompt: string;
  /** Optional metadata for task context */
  metadata?: {
    priority?: number;
    timeout?: number;
    [key: string]: unknown;
  };
}

/**
 * Heartbeat message sent by the server to check connection health.
 * Extension should respond with a PongMessage.
 */
export interface PingMessage {
  type: 'ping';
  timestamp: number;
}

/**
 * Union type for all messages the extension can receive from the server.
 */
export type IncomingMessage = ExecuteTaskMessage | PingMessage;

// ============================================================================
// Outgoing Messages (Extension → Server)
// ============================================================================

/**
 * Response message sent when the extension accepts a task for execution.
 */
export interface TaskAcceptedMessage {
  type: 'task_accepted';
  taskId: string;
  timestamp: number;
}

/**
 * Response message sent when the extension rejects a task request.
 * Includes a reason for the rejection (e.g., already executing, invalid request).
 */
export interface TaskRejectedMessage {
  type: 'task_rejected';
  taskId: string;
  reason: string;
  timestamp: number;
}

/**
 * Message sent during task execution to stream AgentEvent updates.
 * Allows the server to monitor task progress in real-time.
 */
export interface ExecutionEventMessage {
  type: 'execution_event';
  taskId: string;
  event: AgentEvent;
  timestamp: number;
}

/**
 * Heartbeat response message sent in reply to a PingMessage.
 * Confirms the extension is alive and responsive.
 */
export interface PongMessage {
  type: 'pong';
  timestamp: number;
}

/**
 * Union type for all messages the extension can send to the server.
 */
export type OutgoingMessage = TaskAcceptedMessage | TaskRejectedMessage | ExecutionEventMessage | PongMessage;

// ============================================================================
// Combined Types
// ============================================================================

/**
 * Union of all possible WebSocket messages (bidirectional).
 */
export type WebSocketMessage = IncomingMessage | OutgoingMessage;

/**
 * Serialized message format for transmission over WebSocket.
 */
export type SerializedMessage = string;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a message is an ExecuteTaskMessage.
 */
export function isExecuteTaskMessage(message: WebSocketMessage): message is ExecuteTaskMessage {
  return message.type === 'execute_task';
}

/**
 * Type guard to check if a message is a PingMessage.
 */
export function isPingMessage(message: WebSocketMessage): message is PingMessage {
  return message.type === 'ping';
}

/**
 * Type guard to check if a message is a TaskAcceptedMessage.
 */
export function isTaskAcceptedMessage(message: WebSocketMessage): message is TaskAcceptedMessage {
  return message.type === 'task_accepted';
}

/**
 * Type guard to check if a message is a TaskRejectedMessage.
 */
export function isTaskRejectedMessage(message: WebSocketMessage): message is TaskRejectedMessage {
  return message.type === 'task_rejected';
}

/**
 * Type guard to check if a message is an ExecutionEventMessage.
 */
export function isExecutionEventMessage(message: WebSocketMessage): message is ExecutionEventMessage {
  return message.type === 'execution_event';
}

/**
 * Type guard to check if a message is a PongMessage.
 */
export function isPongMessage(message: WebSocketMessage): message is PongMessage {
  return message.type === 'pong';
}

/**
 * Type guard to check if a message is an IncomingMessage.
 */
export function isIncomingMessage(message: WebSocketMessage): message is IncomingMessage {
  return isExecuteTaskMessage(message) || isPingMessage(message);
}

/**
 * Type guard to check if a message is an OutgoingMessage.
 */
export function isOutgoingMessage(message: WebSocketMessage): message is OutgoingMessage {
  return (
    isTaskAcceptedMessage(message) ||
    isTaskRejectedMessage(message) ||
    isExecutionEventMessage(message) ||
    isPongMessage(message)
  );
}
