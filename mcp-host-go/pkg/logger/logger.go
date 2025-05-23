package logger

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// LogLevel defines the severity levels for logging
type LogLevel int

const (
	// ERROR is the level for error messages
	ERROR LogLevel = iota
	// WARN is the level for warning messages
	WARN
	// INFO is the level for informational messages
	INFO
	// DEBUG is the level for debug messages
	DEBUG
)

// String returns the string representation of the log level
func (l LogLevel) String() string {
	switch l {
	case ERROR:
		return "ERROR"
	case WARN:
		return "WARN"
	case INFO:
		return "INFO"
	case DEBUG:
		return "DEBUG"
	default:
		return "UNKNOWN"
	}
}

// Logger defines the interface for logging operations
type Logger interface {
	Error(message string, args ...interface{})
	Warn(message string, args ...interface{})
	Info(message string, args ...interface{})
	Debug(message string, args ...interface{})
}

// FileLogger implements the Logger interface with file output
type FileLogger struct {
	moduleName string
	logLevel   LogLevel
	writer     io.Writer
	mutex      sync.Mutex
}

// Config holds configuration parameters for the logger
type Config struct {
	LogLevel   LogLevel
	LogDir     string
	LogFile    string
	ModuleName string
}

// NewFileLogger creates a new file logger with the given configuration
func NewFileLogger(config Config) (*FileLogger, error) {
	// Ensure log directory exists
	if err := os.MkdirAll(config.LogDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create log directory: %w", err)
	}

	// Open log file
	logPath := filepath.Join(config.LogDir, config.LogFile)
	file, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return nil, fmt.Errorf("failed to open log file: %w", err)
	}

	// Write header
	startMsg := fmt.Sprintf("\n[%s] === MCP Host Logging Started (Module: %s) ===\n",
		time.Now().Format(time.RFC3339), config.ModuleName)
	if _, err := file.WriteString(startMsg); err != nil {
		return nil, fmt.Errorf("failed to write log header: %w", err)
	}

	return &FileLogger{
		moduleName: config.ModuleName,
		logLevel:   config.LogLevel,
		writer:     file,
	}, nil
}

// DefaultConfig returns a default logger configuration
func DefaultConfig(moduleName string) Config {
	// Get log level from environment variable
	logLevel := DEBUG
	switch os.Getenv("LOG_LEVEL") {
	case "ERROR":
		logLevel = ERROR
	case "WARN":
		logLevel = WARN
	case "INFO":
		logLevel = INFO
	case "DEBUG":
		logLevel = DEBUG
	}

	// Get log directory
	logDir := os.Getenv("LOG_DIR")
	if logDir == "" {
		logDir = filepath.Join(os.TempDir(), "mcp-host")
	}

	// Get log file name
	logFile := os.Getenv("LOG_FILE")
	if logFile == "" {
		logFile = "mcp-host.log"
	}

	return Config{
		ModuleName: moduleName,
		LogLevel:   logLevel,
		LogDir:     logDir,
		LogFile:    logFile,
	}
}

// formatMessage formats a log message with timestamp, level, module name and args
func (l *FileLogger) formatMessage(level LogLevel, message string, args ...interface{}) string {
	timestamp := time.Now().Format(time.RFC3339)
	prefix := fmt.Sprintf("[%s] [%s] [%s]", timestamp, level.String(), l.moduleName)

	formattedMessage := fmt.Sprintf("%s %s", prefix, message)

	// Format additional arguments
	if len(args) > 0 {
		formattedArgs := make([]string, len(args))
		for i, arg := range args {
			if obj, ok := arg.(interface{}); ok {
				if jsonBytes, err := json.Marshal(obj); err == nil {
					formattedArgs[i] = string(jsonBytes)
				} else {
					formattedArgs[i] = fmt.Sprintf("%+v", arg)
				}
			} else {
				formattedArgs[i] = fmt.Sprintf("%+v", arg)
			}
		}
		for _, arg := range formattedArgs {
			formattedMessage += " " + arg
		}
	}

	return formattedMessage
}

// writeToFile writes a formatted log message to the file
func (l *FileLogger) writeToFile(formattedMessage string) {
	l.mutex.Lock()
	defer l.mutex.Unlock()

	if l.writer != nil {
		_, _ = fmt.Fprintln(l.writer, formattedMessage)
	}
}

// Error logs an error message
func (l *FileLogger) Error(message string, args ...interface{}) {
	if l.logLevel >= ERROR {
		formattedMessage := l.formatMessage(ERROR, message, args...)
		l.writeToFile(formattedMessage)
	}
}

// Warn logs a warning message
func (l *FileLogger) Warn(message string, args ...interface{}) {
	if l.logLevel >= WARN {
		formattedMessage := l.formatMessage(WARN, message, args...)
		l.writeToFile(formattedMessage)
	}
}

// Info logs an informational message
func (l *FileLogger) Info(message string, args ...interface{}) {
	if l.logLevel >= INFO {
		formattedMessage := l.formatMessage(INFO, message, args...)
		l.writeToFile(formattedMessage)
	}
}

// Debug logs a debug message
func (l *FileLogger) Debug(message string, args ...interface{}) {
	if l.logLevel >= DEBUG {
		formattedMessage := l.formatMessage(DEBUG, message, args...)
		l.writeToFile(formattedMessage)
	}
}

// Close closes the log file
func (l *FileLogger) Close() error {
	l.mutex.Lock()
	defer l.mutex.Unlock()

	if closer, ok := l.writer.(io.Closer); ok {
		endMsg := fmt.Sprintf("\n[%s] === MCP Host Logging Ended (Module: %s) ===\n",
			time.Now().Format(time.RFC3339), l.moduleName)
		_, _ = fmt.Fprintln(l.writer, endMsg)
		return closer.Close()
	}
	return nil
}

// NewLogger is a convenience function that creates a logger with default config
func NewLogger(moduleName string) (Logger, error) {
	return NewFileLogger(DefaultConfig(moduleName))
}
