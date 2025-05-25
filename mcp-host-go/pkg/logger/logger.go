package logger

import (
	"fmt"
	"os"
	"path/filepath"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// Logger defines the logging interface based on zap
type Logger interface {
	// Core logging methods with structured fields
	Debug(msg string, fields ...zap.Field)
	Info(msg string, fields ...zap.Field)
	Warn(msg string, fields ...zap.Field)
	Error(msg string, fields ...zap.Field)

	// Create child loggers
	Named(name string) Logger
	With(fields ...zap.Field) Logger

	// Utility methods for common patterns
	Sync() error // Flush any buffered log entries
}

// ZapLogger wraps zap.Logger to implement our Logger interface
type ZapLogger struct {
	*zap.Logger
}

// Ensure ZapLogger implements Logger interface
var _ Logger = (*ZapLogger)(nil)

// Debug logs a debug message with structured fields
func (l *ZapLogger) Debug(msg string, fields ...zap.Field) {
	l.Logger.Debug(msg, fields...)
}

// Info logs an info message with structured fields
func (l *ZapLogger) Info(msg string, fields ...zap.Field) {
	l.Logger.Info(msg, fields...)
}

// Warn logs a warning message with structured fields
func (l *ZapLogger) Warn(msg string, fields ...zap.Field) {
	l.Logger.Warn(msg, fields...)
}

// Error logs an error message with structured fields
func (l *ZapLogger) Error(msg string, fields ...zap.Field) {
	l.Logger.Error(msg, fields...)
}

// Named creates a child logger with the given name
func (l *ZapLogger) Named(name string) Logger {
	return &ZapLogger{l.Logger.Named(name)}
}

// With creates a child logger with additional fields
func (l *ZapLogger) With(fields ...zap.Field) Logger {
	return &ZapLogger{l.Logger.With(fields...)}
}

// Sync flushes any buffered log entries
func (l *ZapLogger) Sync() error {
	return l.Logger.Sync()
}

// NewLogger creates a new logger for the given module
func NewLogger(module string) (Logger, error) {
	zapLogger, err := buildZapLogger()
	if err != nil {
		return nil, fmt.Errorf("failed to build zap logger: %w", err)
	}

	return &ZapLogger{zapLogger.Named(module)}, nil
}

// NewLoggerFromZap wraps an existing zap logger
func NewLoggerFromZap(zapLogger *zap.Logger) Logger {
	return &ZapLogger{zapLogger}
}

// getDefaultLogFilePath returns the default log file path based on the OS
func getDefaultLogFilePath() string {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		// Fallback to temp directory if home directory can't be determined
		return filepath.Join(os.TempDir(), "mcp-host", "logs", "mcp-host.log")
	}
	return filepath.Join(homeDir, ".mcp-host", "logs", "mcp-host.log")
}

// ensureLogDirExists creates the log directory if it doesn't exist
func ensureLogDirExists(filePath string) error {
	// Get the directory part of the file path
	logDir := filepath.Dir(filePath)

	// Create the directory with all parent directories if they don't exist
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return fmt.Errorf("failed to create log directory %s: %w", logDir, err)
	}

	return nil
}

// buildZapLogger builds a zap logger based on environment configuration
// The logger outputs ONLY to file, not to stdout/stderr to avoid
// interference with native messaging which uses stdout/stderr
func buildZapLogger() (*zap.Logger, error) {
	// Always use console (text) format for better readability
	config := zap.NewDevelopmentConfig()

	// Configure console-style encoding for text format
	config.Encoding = "console"
	config.EncoderConfig.EncodeLevel = zapcore.CapitalLevelEncoder
	config.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
	config.EncoderConfig.EncodeCaller = zapcore.ShortCallerEncoder
	config.EncoderConfig.ConsoleSeparator = " | "

	// Enable development mode and set caller skip to show real calling location
	// instead of the wrapper methods in this logger package
	config.Development = true

	// Configure log level from environment
	if level := os.Getenv("LOG_LEVEL"); level != "" {
		var zapLevel zapcore.Level
		if err := zapLevel.UnmarshalText([]byte(level)); err != nil {
			return nil, fmt.Errorf("invalid log level %s: %w", level, err)
		}
		config.Level = zap.NewAtomicLevelAt(zapLevel)
	} else {
		config.Level = zap.NewAtomicLevelAt(zapcore.InfoLevel)
	}

	// Initialize empty output paths - we don't use stdout/stderr by default
	// as this would interfere with native messaging
	config.OutputPaths = []string{}
	config.ErrorOutputPaths = []string{}

	// Determine the log file path
	var logFilePath string

	// Check if LOG_FILE is specified directly
	if logFile := os.Getenv("LOG_FILE"); logFile != "" {
		logFilePath = logFile
	} else if logDir := os.Getenv("LOG_DIR"); logDir != "" {
		// If LOG_DIR is specified, use it with default filename
		logFilePath = filepath.Join(logDir, "mcp-host.log")
	} else {
		// Use default path if no environment variables are set
		logFilePath = getDefaultLogFilePath()
	}

	// Ensure log directory exists
	if err := ensureLogDirExists(logFilePath); err != nil {
		// If we can't create the directory, log a warning and continue
		// The logger will attempt to write to the file anyway, and may fail
		fmt.Fprintf(os.Stderr, "Warning: %v\n", err)
	}

	// Add log file to output paths
	config.OutputPaths = append(config.OutputPaths, logFilePath)
	config.ErrorOutputPaths = append(config.ErrorOutputPaths, logFilePath)

	// Only add stdout if explicitly requested via environment variable
	// This should NOT be used in production with native messaging
	if os.Getenv("LOG_TO_STDOUT") == "true" {
		config.OutputPaths = append(config.OutputPaths, "stdout")
	}

	// Only add stderr if explicitly requested via environment variable
	// This should NOT be used in production with native messaging
	if os.Getenv("LOG_TO_STDERR") == "true" {
		config.ErrorOutputPaths = append(config.ErrorOutputPaths, "stderr")
	}

	// Build the logger with caller skip to show real calling location
	// Skip 1 level to bypass our wrapper methods
	logger, err := config.Build(zap.AddCallerSkip(1))
	if err != nil {
		return nil, err
	}

	return logger, nil
}
