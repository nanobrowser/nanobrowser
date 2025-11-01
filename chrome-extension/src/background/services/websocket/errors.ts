/**
 * WebSocket Error Handling and Categorization
 *
 * This module provides structured error handling for WebSocket operations,
 * including error categorization, user-friendly messages, and logging utilities.
 */

/**
 * Error categories for WebSocket operations.
 */
export enum WebSocketErrorCategory {
  /** Network-related errors (connection refused, timeout, etc.) */
  NETWORK = 'network',
  /** Protocol errors (invalid message format, handshake failure) */
  PROTOCOL = 'protocol',
  /** Timeout errors (connection timeout, message timeout) */
  TIMEOUT = 'timeout',
  /** Validation errors (invalid configuration, malformed messages) */
  VALIDATION = 'validation',
  /** Authentication/authorization errors */
  AUTH = 'auth',
  /** Unknown or uncategorized errors */
  UNKNOWN = 'unknown',
}

/**
 * Structured WebSocket error with category and context.
 */
export class WebSocketError extends Error {
  constructor(
    message: string,
    public readonly category: WebSocketErrorCategory,
    public readonly context?: Record<string, unknown>,
    public readonly originalError?: Error,
  ) {
    super(message);
    this.name = 'WebSocketError';

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WebSocketError);
    }
  }

  /**
   * Get a user-friendly error message suitable for display.
   */
  getUserMessage(): string {
    switch (this.category) {
      case WebSocketErrorCategory.NETWORK:
        return 'Unable to connect to WebSocket server. Please check your network connection and server URL.';
      case WebSocketErrorCategory.PROTOCOL:
        return 'Communication error with WebSocket server. The server may be incompatible.';
      case WebSocketErrorCategory.TIMEOUT:
        return 'Connection timeout. Please check if the server is responding.';
      case WebSocketErrorCategory.VALIDATION:
        return 'Invalid WebSocket configuration. Please check your settings.';
      case WebSocketErrorCategory.AUTH:
        return 'Authentication failed. Please check your credentials.';
      default:
        return 'An unexpected error occurred with the WebSocket connection.';
    }
  }

  /**
   * Create a sanitized version of this error safe for logging.
   * Removes sensitive information like tokens or passwords.
   */
  toLoggableObject() {
    return {
      name: this.name,
      message: this.message,
      category: this.category,
      context: this.sanitizeContext(this.context),
      stack: this.stack,
      originalError: this.originalError
        ? {
            name: this.originalError.name,
            message: this.originalError.message,
          }
        : undefined,
    };
  }

  private sanitizeContext(context?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!context) return undefined;

    const sanitized: Record<string, unknown> = {};
    const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth'];

    for (const [key, value] of Object.entries(context)) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'string' && value.length > 1000) {
        sanitized[key] = `[TRUNCATED: ${value.length} chars]`;
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}

/**
 * Categorize a WebSocket close event based on the close code.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent/code
 */
export function categorizeCloseEvent(code: number): WebSocketErrorCategory {
  if (code === 1000) {
    // Normal closure - not an error
    return WebSocketErrorCategory.UNKNOWN;
  } else if (code >= 1001 && code <= 1003) {
    // Going away, protocol error, unsupported data
    return WebSocketErrorCategory.PROTOCOL;
  } else if (code === 1006) {
    // Abnormal closure (usually network issue)
    return WebSocketErrorCategory.NETWORK;
  } else if (code === 1007 || code === 1008) {
    // Invalid payload or policy violation
    return WebSocketErrorCategory.VALIDATION;
  } else if (code === 1011) {
    // Server error
    return WebSocketErrorCategory.NETWORK;
  } else if (code >= 3000 && code <= 3999) {
    // Custom application codes (could be auth)
    return WebSocketErrorCategory.AUTH;
  }

  return WebSocketErrorCategory.UNKNOWN;
}

/**
 * Categorize a generic error based on its properties.
 */
export function categorizeError(error: unknown): WebSocketErrorCategory {
  if (error instanceof WebSocketError) {
    return error.category;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes('timeout') || message.includes('timed out')) {
      return WebSocketErrorCategory.TIMEOUT;
    }

    if (
      message.includes('network') ||
      message.includes('connection') ||
      message.includes('refused') ||
      message.includes('unreachable') ||
      message.includes('econnrefused') ||
      message.includes('enotfound')
    ) {
      return WebSocketErrorCategory.NETWORK;
    }

    if (
      message.includes('invalid') ||
      message.includes('malformed') ||
      message.includes('parse') ||
      message.includes('json')
    ) {
      return WebSocketErrorCategory.VALIDATION;
    }

    if (message.includes('auth') || message.includes('unauthorized') || message.includes('forbidden')) {
      return WebSocketErrorCategory.AUTH;
    }

    if (message.includes('protocol') || message.includes('handshake')) {
      return WebSocketErrorCategory.PROTOCOL;
    }
  }

  return WebSocketErrorCategory.UNKNOWN;
}

/**
 * Create a WebSocketError from an unknown error with automatic categorization.
 */
export function createWebSocketError(error: unknown, context?: Record<string, unknown>): WebSocketError {
  if (error instanceof WebSocketError) {
    return error;
  }

  const category = categorizeError(error);
  const message = error instanceof Error ? error.message : String(error);
  const originalError = error instanceof Error ? error : undefined;

  return new WebSocketError(message, category, context, originalError);
}

/**
 * Check if an error is considered recoverable (can retry).
 */
export function isRecoverableError(error: unknown): boolean {
  const category = error instanceof WebSocketError ? error.category : categorizeError(error);

  // Network and timeout errors are typically recoverable
  return category === WebSocketErrorCategory.NETWORK || category === WebSocketErrorCategory.TIMEOUT;
}

/**
 * Get a user-friendly error message from any error.
 */
export function getUserFriendlyErrorMessage(error: unknown): string {
  if (error instanceof WebSocketError) {
    return error.getUserMessage();
  }

  const category = categorizeError(error);
  const tempError = new WebSocketError('', category);
  return tempError.getUserMessage();
}

/**
 * Sanitize a message for logging by truncating large content and redacting sensitive fields.
 */
export function sanitizeForLogging(data: unknown, maxLength = 500): unknown {
  if (typeof data === 'string') {
    return data.length > maxLength ? `${data.substring(0, maxLength)}... [truncated]` : data;
  }

  if (Array.isArray(data)) {
    return data.map(item => sanitizeForLogging(item, maxLength));
  }

  if (data && typeof data === 'object') {
    const sanitized: Record<string, unknown> = {};
    const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth', 'credential'];

    for (const [key, value] of Object.entries(data)) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeForLogging(value, maxLength);
      }
    }

    return sanitized;
  }

  return data;
}
