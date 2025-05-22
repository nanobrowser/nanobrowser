/**
 * Logger module for MCP Host
 *
 * Ensures all logs go to stderr to avoid interfering with the Native Messaging protocol
 * which uses stdout for communication with the Chrome extension.
 *
 * Also provides file logging capabilities.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
    return LogLevel.DEBUG; // Default level
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

// Get log file path from environment or use default
function getLogFilePath(): string {
  const logDir = process.env.LOG_DIR || path.join(os.tmpdir(), 'mcp-host');
  const logFile = process.env.LOG_FILE || 'mcp-host.log';
  return path.join(logDir, logFile);
}

export class Logger {
  private moduleName: string;
  private static logLevel: LogLevel = getLogLevel();
  private static logFilePath: string = getLogFilePath();
  private static fileStream: fs.WriteStream | null = null;

  constructor(moduleName: string) {
    this.moduleName = moduleName;

    // Initialize file stream if not already done
    if (!Logger.fileStream) {
      try {
        // Ensure directory exists
        const dir = path.dirname(Logger.logFilePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // Create or open log file for appending
        Logger.fileStream = fs.createWriteStream(Logger.logFilePath, {
          flags: 'a', // Append mode
          encoding: 'utf8',
        });

        // Write header on initialization
        const startMsg = `\n[${new Date().toISOString()}] === MCP Host Logging Started ===\n`;
        Logger.fileStream.write(startMsg);

        // Set up cleanup on process exit
        process.on('exit', () => {
          if (Logger.fileStream) {
            const endMsg = `\n[${new Date().toISOString()}] === MCP Host Logging Ended ===\n`;
            Logger.fileStream.write(endMsg);
            Logger.fileStream.end();
          }
        });
      } catch (error) {
        console.error(`Failed to initialize log file at ${Logger.logFilePath}:`, error);
      }
    }
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
   * Write a log message to the file
   */
  private writeToFile(formattedMessage: string): void {
    if (Logger.fileStream) {
      try {
        Logger.fileStream.write(formattedMessage + '\n');
      } catch (error) {
        console.error(`Failed to write to log file:`, error);
      }
    }
  }

  /**
   * Log an error message (always logged)
   */
  error(message: string, ...args: any[]): void {
    if (Logger.logLevel >= LogLevel.ERROR) {
      const formattedMessage = this.formatMessage('ERROR', message, args);
      this.writeToFile(formattedMessage);
    }
  }

  /**
   * Log a warning message
   */
  warn(message: string, ...args: any[]): void {
    if (Logger.logLevel >= LogLevel.WARN) {
      const formattedMessage = this.formatMessage('WARN', message, args);
      this.writeToFile(formattedMessage);
    }
  }

  /**
   * Log an info message
   */
  info(message: string, ...args: any[]): void {
    if (Logger.logLevel >= LogLevel.INFO) {
      const formattedMessage = this.formatMessage('INFO', message, args);
      this.writeToFile(formattedMessage);
    }
  }

  /**
   * Log a debug message
   */
  debug(message: string, ...args: any[]): void {
    if (Logger.logLevel >= LogLevel.DEBUG) {
      const formattedMessage = this.formatMessage('DEBUG', message, args);
      this.writeToFile(formattedMessage);
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

  /**
   * Set log file path
   */
  static setLogFilePath(filePath: string): void {
    // Close existing stream if any
    if (Logger.fileStream) {
      Logger.fileStream.end();
      Logger.fileStream = null;
    }

    Logger.logFilePath = filePath;

    // The next logger instance created will initialize the new file stream
  }

  /**
   * Get current log file path
   */
  static getLogFilePath(): string {
    return Logger.logFilePath;
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
