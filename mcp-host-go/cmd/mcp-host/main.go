package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/algonius/algonius-browser/mcp-host-go/pkg/handlers"
	"github.com/algonius/algonius-browser/mcp-host-go/pkg/logger"
	"github.com/algonius/algonius-browser/mcp-host-go/pkg/messaging"
	"github.com/algonius/algonius-browser/mcp-host-go/pkg/resources"
	"github.com/algonius/algonius-browser/mcp-host-go/pkg/sse"
	"github.com/algonius/algonius-browser/mcp-host-go/pkg/tools"
	"github.com/algonius/algonius-browser/mcp-host-go/pkg/types"
	"go.uber.org/zap"
)

const (
	// Version of the MCP host
	Version = "0.1.0"

	// Name of the MCP host
	Name = "dev.nanobrowser.mcp.host"

	// Default SSE port
	DefaultSSEPort = ":7890"

	// Default SSE base URL
	DefaultSSEBaseURL = "http://localhost:7890/sse"
)

// Container is a dependency injection container
type Container struct {
	Logger          logger.Logger
	Messaging       types.Messaging
	Server          *sse.SSEServer
	NavigateTool    types.Tool
	ScrollPageTool  types.Tool
	CurrentStateRes types.Resource
	DomStateRes     types.Resource
	StatusHandler   *handlers.StatusHandler
	InitHandler     *handlers.InitHandler
	ShutdownHandler *handlers.ShutdownHandler
	LogFilePath     string // Store the log file path for printing in shutdown messages
	StartTime       time.Time
	ShutdownChan    chan struct{} // Channel for graceful shutdown coordination
}

func main() {
	// Record start time
	startTime := time.Now()

	// Initialize the container
	container, err := initContainer(startTime)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize container: %v\n", err)
		os.Exit(1)
	}

	// Log startup
	container.Logger.Info("Starting SSE MCP Host", zap.String("version", Version))

	// Register RPC handlers for Native Messaging (browser extension calls)
	container.Messaging.RegisterRpcMethod("status", container.StatusHandler.HandleStatus)
	container.Messaging.RegisterRpcMethod("init", container.InitHandler.HandleInit)
	container.Messaging.RegisterRpcMethod("shutdown", container.ShutdownHandler.HandleShutdown)

	// Start Native Messaging
	if err := container.Messaging.Start(); err != nil {
		container.Logger.Error("Failed to start Native Messaging", zap.Error(err))
		os.Exit(1)
	}

	// Register resources
	if err := container.Server.RegisterResource(container.CurrentStateRes); err != nil {
		container.Logger.Error("Failed to register current state resource", zap.Error(err))
		os.Exit(1)
	}

	if err := container.Server.RegisterResource(container.DomStateRes); err != nil {
		container.Logger.Error("Failed to register DOM state resource", zap.Error(err))
		os.Exit(1)
	}

	// Register tools
	if err := container.Server.RegisterTool(container.NavigateTool); err != nil {
		container.Logger.Error("Failed to register navigate_to tool", zap.Error(err))
		os.Exit(1)
	}

	if err := container.Server.RegisterTool(container.ScrollPageTool); err != nil {
		container.Logger.Error("Failed to register scroll_page tool", zap.Error(err))
		os.Exit(1)
	}

	// Start the server
	if err := container.Server.Start(); err != nil {
		container.Logger.Error("Failed to start SSE MCP server", zap.Error(err))
		os.Exit(1)
	}

	// Log server information
	container.Logger.Info("SSE MCP server started successfully")
	container.Logger.Info("SSE Server available at", zap.String("url", getSSEBaseURL()))
	container.Logger.Info("External AI systems can connect via HTTP/SSE")
	container.Logger.Info("Requests will be forwarded to Chrome extension via Native Messaging")
	container.Logger.Info("Init, Status, and Shutdown RPC handlers registered for browser extension")

	// Handle signals for graceful shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	// Wait for shutdown signal (either from OS signal or shutdown handler)
	select {
	case <-stop:
		container.Logger.Info("Received OS shutdown signal")
	case <-container.ShutdownChan:
		container.Logger.Info("Received shutdown request from browser extension")
	}

	container.Logger.Info("Shutting down SSE MCP Host")

	// Print shutdown message to stderr for visibility during native messaging
	fmt.Fprintf(os.Stderr, "\nShutting down SSE MCP Host\n")
	if container.LogFilePath != "" {
		fmt.Fprintf(os.Stderr, "Logs were written to: %s\n", container.LogFilePath)
	}

	// Shut down the server
	if err := container.Server.Shutdown(); err != nil {
		container.Logger.Error("Error during server shutdown", zap.Error(err))
		fmt.Fprintf(os.Stderr, "Error during server shutdown: %v\n", err)
	}
}

// initContainer initializes the dependency injection container
func initContainer(startTime time.Time) (*Container, error) {
	var err error
	container := &Container{
		StartTime:    startTime,
		ShutdownChan: make(chan struct{}),
	}

	// Determine log file path to store for later use in shutdown messages
	container.LogFilePath = getLogFilePath()

	// Create logger
	log, err := logger.NewLogger("main")
	if err != nil {
		return nil, fmt.Errorf("failed to create logger: %w", err)
	}
	container.Logger = log

	// Create messaging for Native Messaging communication with Chrome extension
	msgLogger, err := logger.NewLogger("messaging")
	if err != nil {
		return nil, fmt.Errorf("failed to create messaging logger: %w", err)
	}

	msg, err := messaging.NewNativeMessaging(messaging.NativeMessagingConfig{
		Logger: msgLogger,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create messaging: %w", err)
	}
	container.Messaging = msg

	// Create status handler for browser extension RPC calls
	statusLogger, err := logger.NewLogger("status-handler")
	if err != nil {
		return nil, fmt.Errorf("failed to create status handler logger: %w", err)
	}

	statusHandler, err := handlers.NewStatusHandler(handlers.StatusHandlerConfig{
		Logger:     statusLogger,
		StartTime:  startTime,
		SSEPort:    getSSEPort(),
		SSEBaseURL: getSSEBaseURL(),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create status handler: %w", err)
	}
	container.StatusHandler = statusHandler

	// Create init handler for browser extension RPC calls
	initLogger, err := logger.NewLogger("init-handler")
	if err != nil {
		return nil, fmt.Errorf("failed to create init handler logger: %w", err)
	}

	initHandler, err := handlers.NewInitHandler(handlers.InitHandlerConfig{
		Logger: initLogger,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create init handler: %w", err)
	}
	container.InitHandler = initHandler

	// Create shutdown handler for browser extension RPC calls
	shutdownLogger, err := logger.NewLogger("shutdown-handler")
	if err != nil {
		return nil, fmt.Errorf("failed to create shutdown handler logger: %w", err)
	}

	shutdownHandler, err := handlers.NewShutdownHandler(handlers.ShutdownHandlerConfig{
		Logger:       shutdownLogger,
		ShutdownChan: container.ShutdownChan,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create shutdown handler: %w", err)
	}
	container.ShutdownHandler = shutdownHandler

	// Create SSE server
	serverLogger, err := logger.NewLogger("sse-server")
	if err != nil {
		return nil, fmt.Errorf("failed to create server logger: %w", err)
	}

	server, err := sse.NewSSEServer(sse.SSEServerConfig{
		Logger:    serverLogger,
		Messaging: container.Messaging,
		Port:      getSSEPort(),
		BaseURL:   getSSEBaseURL(),
		HostInfo: types.HostInfo{
			Name:    Name,
			Version: Version,
			RunMode: getRunMode(),
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create SSE server: %w", err)
	}
	container.Server = server

	// Create resources
	resourceLogger, err := logger.NewLogger("resource")
	if err != nil {
		return nil, fmt.Errorf("failed to create resource logger: %w", err)
	}

	currentState, err := resources.NewCurrentStateResource(resources.CurrentStateConfig{
		Logger:    resourceLogger,
		Messaging: container.Messaging,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create current state resource: %w", err)
	}
	container.CurrentStateRes = currentState

	domState, err := resources.NewDomStateResource(resources.DomStateConfig{
		Logger:    resourceLogger,
		Messaging: container.Messaging,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create DOM state resource: %w", err)
	}
	container.DomStateRes = domState

	// Create tools
	toolLogger, err := logger.NewLogger("tool")
	if err != nil {
		return nil, fmt.Errorf("failed to create tool logger: %w", err)
	}

	navigateTool, err := tools.NewNavigateToTool(tools.NavigateToConfig{
		Logger:    toolLogger,
		Messaging: container.Messaging,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create navigate_to tool: %w", err)
	}
	container.NavigateTool = navigateTool

	scrollPageTool, err := tools.NewScrollPageTool(tools.ScrollPageConfig{
		Logger:    toolLogger,
		Messaging: container.Messaging,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create scroll_page tool: %w", err)
	}
	container.ScrollPageTool = scrollPageTool

	return container, nil
}

// getLogFilePath returns the log file path configured or default
func getLogFilePath() string {
	// Check if LOG_FILE is specified directly
	if logFile := os.Getenv("LOG_FILE"); logFile != "" {
		return logFile
	} else if logDir := os.Getenv("LOG_DIR"); logDir != "" {
		// If LOG_DIR is specified, use it with default filename
		return logDir + "/mcp-host.log"
	}

	// Attempt to get user's home directory
	homeDir, err := os.UserHomeDir()
	if err != nil {
		// Return a placeholder if we can't determine home directory
		return "<log file in user home directory>"
	}

	return homeDir + "/.mcp-host/logs/mcp-host.log"
}

// getRunMode returns the current run mode (development or production)
func getRunMode() string {
	mode := os.Getenv("RUN_MODE")
	if mode == "" {
		return "production"
	}
	return mode
}

// getSSEPort returns the SSE server port from environment or default
func getSSEPort() string {
	port := os.Getenv("SSE_PORT")
	if port == "" {
		return DefaultSSEPort
	}
	if port[0] != ':' {
		port = ":" + port
	}
	return port
}

// getSSEBaseURL returns the SSE base URL from environment or default
func getSSEBaseURL() string {
	baseURL := os.Getenv("SSE_BASE_URL")
	if baseURL == "" {
		return DefaultSSEBaseURL
	}
	return baseURL
}
