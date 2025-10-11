import type {
  IncomingMessage,
  OutgoingMessage,
  SerializedMessage,
  ExecuteTaskMessage,
  PingMessage,
  TaskAcceptedMessage,
  TaskRejectedMessage,
  ExecutionEventMessage,
  PongMessage,
} from './types';
import type { AgentEvent } from '../../agent/event/types';
import { createLogger } from '../../log';
import type { Logger } from '../../log';
import { sanitizeForLogging } from './errors';

// Create dedicated logger for protocol operations
const logger: Logger = createLogger('WebSocket:Protocol');

/**
 * Error thrown when message deserialization fails.
 */
export class MessageDeserializationError extends Error {
  constructor(
    message: string,
    public readonly rawData?: string,
  ) {
    super(message);
    this.name = 'MessageDeserializationError';

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MessageDeserializationError);
    }
  }
}

/**
 * Error thrown when message serialization fails.
 */
export class MessageSerializationError extends Error {
  constructor(
    message: string,
    public readonly messageData?: unknown,
  ) {
    super(message);
    this.name = 'MessageSerializationError';

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MessageSerializationError);
    }
  }
}

/**
 * WebSocket message interpreter for serialization and deserialization.
 * Follows the pattern from packages/hmr/lib/interpreter/index.ts.
 *
 * Responsibilities:
 * - Serialize outgoing messages to JSON strings
 * - Deserialize incoming JSON strings to typed message objects
 * - Validate message structure and type safety
 * - Provide error handling for malformed messages
 */
export default class WebSocketMessageInterpreter {
  // Private constructor to prevent instantiation
  // This class is intended to be used statically only
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  /**
   * Serialize a message object to a JSON string for transmission.
   *
   * @param message - The message object to serialize
   * @returns Serialized JSON string
   * @throws MessageSerializationError if serialization fails
   */
  static send(message: OutgoingMessage): SerializedMessage {
    try {
      logger.debug('Serializing outgoing message', {
        type: message.type,
        summary: sanitizeForLogging(message, 100),
      });

      // Validate message has required fields
      if (!message || typeof message !== 'object' || !message.type) {
        throw new MessageSerializationError('Message must be an object with a type field', message);
      }

      // Handle AgentEvent serialization in ExecutionEventMessage
      if (message.type === 'execution_event') {
        const serializedMessage = {
          ...message,
          event: {
            actor: message.event.actor,
            state: message.event.state,
            data: message.event.data,
            timestamp: message.event.timestamp,
            type: message.event.type,
          },
        };
        const result = JSON.stringify(serializedMessage);
        logger.debug('Message serialized successfully', {
          type: message.type,
          length: result.length,
        });
        return result;
      }

      const result = JSON.stringify(message);
      logger.debug('Message serialized successfully', {
        type: message.type,
        length: result.length,
      });
      return result;
    } catch (error) {
      const errorMessage = `Failed to serialize message: ${error instanceof Error ? error.message : 'Unknown error'}`;
      logger.error('Serialization failed', {
        error: errorMessage,
        messageType: message?.type,
        messageSummary: sanitizeForLogging(message, 100),
      });
      throw new MessageSerializationError(errorMessage, message);
    }
  }

  /**
   * Deserialize a JSON string to a typed message object.
   *
   * @param serializedMessage - The JSON string to deserialize
   * @returns Typed message object
   * @throws MessageDeserializationError if deserialization or validation fails
   */
  static receive(serializedMessage: SerializedMessage): IncomingMessage {
    logger.debug('Deserializing incoming message', {
      messagePreview: sanitizeForLogging(serializedMessage, 200),
      messageLength: serializedMessage.length,
    });

    try {
      // Validate input is a non-empty string
      if (!serializedMessage || typeof serializedMessage !== 'string') {
        throw new MessageDeserializationError('Message must be a non-empty string', serializedMessage);
      }

      // Check for obviously malformed JSON before parsing
      if (serializedMessage.length > 1000000) {
        throw new MessageDeserializationError('Message too large (> 1MB)', serializedMessage);
      }

      const parsed = JSON.parse(serializedMessage);

      // Validate that the parsed object has a type field
      if (!parsed || typeof parsed !== 'object' || !parsed.type) {
        throw new MessageDeserializationError('Message must be an object with a type field', serializedMessage);
      }

      // Validate and return based on message type
      let result: IncomingMessage;
      switch (parsed.type) {
        case 'execute_task':
          result = this.validateExecuteTaskMessage(parsed, serializedMessage);
          break;
        case 'ping':
          result = this.validatePingMessage(parsed, serializedMessage);
          break;
        default:
          throw new MessageDeserializationError(`Unknown message type: ${parsed.type}`, serializedMessage);
      }

      logger.debug('Message deserialized successfully', {
        type: result.type,
      });
      return result;
    } catch (error) {
      if (error instanceof MessageDeserializationError) {
        logger.error('Deserialization validation failed', {
          error: error.message,
          messagePreview: sanitizeForLogging(serializedMessage, 100),
        });
        throw error;
      }

      const errorMessage = `Failed to deserialize message: ${error instanceof Error ? error.message : 'Unknown error'}`;
      logger.error('Deserialization failed', {
        error: errorMessage,
        messagePreview: sanitizeForLogging(serializedMessage, 100),
      });
      throw new MessageDeserializationError(errorMessage, serializedMessage);
    }
  }

  /**
   * Validate and construct an ExecuteTaskMessage.
   */
  private static validateExecuteTaskMessage(parsed: unknown, rawData: string): ExecuteTaskMessage {
    if (!parsed || typeof parsed !== 'object') {
      throw new MessageDeserializationError('ExecuteTaskMessage must be an object', rawData);
    }

    const obj = parsed as Record<string, unknown>;

    if (typeof obj.taskId !== 'string' || !obj.taskId) {
      throw new MessageDeserializationError('ExecuteTaskMessage must have a non-empty taskId string', rawData);
    }

    if (obj.taskId.length > 1000) {
      throw new MessageDeserializationError('ExecuteTaskMessage taskId too long (> 1000 chars)', rawData);
    }

    if (typeof obj.prompt !== 'string' || !obj.prompt) {
      throw new MessageDeserializationError('ExecuteTaskMessage must have a non-empty prompt string', rawData);
    }

    if (obj.prompt.length > 100000) {
      throw new MessageDeserializationError('ExecuteTaskMessage prompt too long (> 100KB)', rawData);
    }

    // Validate metadata if present
    if (
      obj.metadata !== undefined &&
      (typeof obj.metadata !== 'object' || obj.metadata === null || Array.isArray(obj.metadata))
    ) {
      throw new MessageDeserializationError('ExecuteTaskMessage metadata must be an object if provided', rawData);
    }

    logger.debug('ExecuteTaskMessage validated', {
      taskId: obj.taskId,
      promptLength: (obj.prompt as string).length,
      hasMetadata: !!obj.metadata,
    });

    return {
      type: 'execute_task',
      taskId: obj.taskId,
      prompt: obj.prompt,
      metadata: obj.metadata as Record<string, unknown> | undefined,
    };
  }

  /**
   * Validate and construct a PingMessage.
   */
  private static validatePingMessage(parsed: unknown, rawData: string): PingMessage {
    if (!parsed || typeof parsed !== 'object') {
      throw new MessageDeserializationError('PingMessage must be an object', rawData);
    }

    const obj = parsed as Record<string, unknown>;

    if (typeof obj.timestamp !== 'number') {
      throw new MessageDeserializationError('PingMessage must have a numeric timestamp', rawData);
    }

    if (!Number.isFinite(obj.timestamp) || obj.timestamp < 0) {
      throw new MessageDeserializationError('PingMessage timestamp must be a valid positive number', rawData);
    }

    logger.debug('PingMessage validated', {
      timestamp: obj.timestamp,
    });

    return {
      type: 'ping',
      timestamp: obj.timestamp,
    };
  }

  /**
   * Helper method to create a TaskAcceptedMessage.
   */
  static createTaskAccepted(taskId: string): TaskAcceptedMessage {
    return {
      type: 'task_accepted',
      taskId,
      timestamp: Date.now(),
    };
  }

  /**
   * Helper method to create a TaskRejectedMessage.
   */
  static createTaskRejected(taskId: string, reason: string): TaskRejectedMessage {
    return {
      type: 'task_rejected',
      taskId,
      reason,
      timestamp: Date.now(),
    };
  }

  /**
   * Helper method to create an ExecutionEventMessage.
   */
  static createExecutionEvent(taskId: string, event: AgentEvent): ExecutionEventMessage {
    return {
      type: 'execution_event',
      taskId,
      event,
      timestamp: Date.now(),
    };
  }

  /**
   * Helper method to create a PongMessage.
   */
  static createPong(): PongMessage {
    return {
      type: 'pong',
      timestamp: Date.now(),
    };
  }
}
