package logger

import (
	"fmt"
	"os"

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

// buildZapLogger builds a zap logger based on environment configuration
func buildZapLogger() (*zap.Logger, error) {
	var config zap.Config

	// Choose configuration based on environment
	if isConsoleMode() || isDevelopmentMode() {
		config = zap.NewDevelopmentConfig()
		config.EncoderConfig.EncodeLevel = zapcore.CapitalColorLevelEncoder
		config.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
	} else {
		config = zap.NewProductionConfig()
		config.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
	}

	// Configure log level from environment
	if level := os.Getenv("LOG_LEVEL"); level != "" {
		var zapLevel zapcore.Level
		if err := zapLevel.UnmarshalText([]byte(level)); err != nil {
			return nil, fmt.Errorf("invalid log level %s: %w", level, err)
		}
		config.Level = zap.NewAtomicLevelAt(zapLevel)
	}

	// Configure output paths
	config.OutputPaths = []string{"stdout"}
	config.ErrorOutputPaths = []string{"stderr"}

	// Add file output if specified
	if logFile := os.Getenv("LOG_FILE"); logFile != "" {
		config.OutputPaths = append(config.OutputPaths, logFile)
	}

	// Add directory-based file output if specified
	if logDir := os.Getenv("LOG_DIR"); logDir != "" {
		logFile := "mcp-host.log"
		if customFile := os.Getenv("LOG_FILE"); customFile != "" {
			logFile = customFile
		}
		filePath := fmt.Sprintf("%s/%s", logDir, logFile)
		config.OutputPaths = append(config.OutputPaths, filePath)
	}

	return config.Build()
}

// isConsoleMode checks if console mode is enabled
func isConsoleMode() bool {
	return os.Getenv("LOG_FORMAT") == "console"
}

// isDevelopmentMode checks if development mode is enabled
func isDevelopmentMode() bool {
	env := os.Getenv("GO_ENV")
	return env == "development" || env == "dev"
}
