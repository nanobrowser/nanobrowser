/**
 * WebSocket service module for bidirectional communication
 * between the Nanobrowser extension and external WebSocket servers.
 *
 * This module provides:
 * - Type-safe message protocol with discriminated unions
 * - Message serialization/deserialization utilities
 * - Connection management with automatic reconnection
 * - High-level service interface for application integration
 * - Integration with AgentEvent system for task execution streaming
 * - Comprehensive error handling and logging
 * - Error categorization and user-friendly error messages
 *
 * @module websocket
 */

export * from './types';
export {
  default as WebSocketMessageInterpreter,
  MessageDeserializationError,
  MessageSerializationError,
} from './protocol';
export * from './errors';
export * from './connection';
export * from './service';
