/**
 * Logger module for MCP Host
 *
 * Ensures all logs go to stderr to avoid interfering with the Native Messaging protocol
 * which uses stdout for communication with the Chrome extension.
 */

// Log levels in order of verbosity
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

// Get log level from environment variable or default to INFO
function getLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toUpperCase();

  if (!envLevel) {
    return LogLevel.INFO; // Default level
  }

  switch (envLevel) {
    case 'ERROR':
      return LogLevel.ERROR;
    case 'WARN':
      return LogLevel.WARN;
    case 'INFO':
      return LogLevel.INFO;
    case 'DEBUG':
      return LogLevel.DEBUG;
    default:
      return LogLevel.INFO;
  }
}

export class Logger {
  private moduleName: string;
  private static logLevel: LogLevel = getLogLevel();

  constructor(moduleName: string) {
    this.moduleName = moduleName;
  }

  /**
   * Format a log message with timestamp, level, module name and params
   */
  private formatMessage(level: string, message: string, args: any[]): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}] [${this.moduleName}]`;

    let formattedMessage = `${prefix} ${message}`;

    // If there are additional arguments, stringify and append them
    if (args.length > 0) {
      // Format each argument
      const formattedArgs = args
        .map(arg => {
          if (typeof arg === 'object') {
            try {
              return JSON.stringify(arg);
            } catch (e) {
              return '[Circular Object]';
            }
          }
          return String(arg);
        })
        .join(' ');

      formattedMessage += ` ${formattedArgs}`;
    }

    return formattedMessage;
  }

  /**
   * Log an error message (always logged)
   */
  error(message: string, ...args: any[]): void {
    if (Logger.logLevel >= LogLevel.ERROR) {
      const formattedMessage = this.formatMessage('ERROR', message, args);
      console.error(formattedMessage);
    }
  }

  /**
   * Log a warning message
   */
  warn(message: string, ...args: any[]): void {
    if (Logger.logLevel >= LogLevel.WARN) {
      const formattedMessage = this.formatMessage('WARN', message, args);
      console.error(formattedMessage); // Still using stderr
    }
  }

  /**
   * Log an info message
   */
  info(message: string, ...args: any[]): void {
    if (Logger.logLevel >= LogLevel.INFO) {
      const formattedMessage = this.formatMessage('INFO', message, args);
      console.error(formattedMessage); // Still using stderr
    }
  }

  /**
   * Log a debug message
   */
  debug(message: string, ...args: any[]): void {
    if (Logger.logLevel >= LogLevel.DEBUG) {
      const formattedMessage = this.formatMessage('DEBUG', message, args);
      console.error(formattedMessage); // Still using stderr
    }
  }

  /**
   * Set log level globally for all loggers
   */
  static setLogLevel(level: LogLevel): void {
    Logger.logLevel = level;
  }

  /**
   * Get current log level
   */
  static getLogLevel(): LogLevel {
    return Logger.logLevel;
  }
}

/**
 * Create a new logger instance
 * @param moduleName The module name for this logger
 * @returns A logger instance
 */
export function createLogger(moduleName: string): Logger {
  return new Logger(moduleName);
}
