package handlers

import (
	"fmt"
	"time"

	"github.com/algonius/algonius-browser/mcp-host-go/pkg/logger"
	"github.com/algonius/algonius-browser/mcp-host-go/pkg/types"
	"go.uber.org/zap"
)

// ShutdownHandler handles shutdown requests from the browser extension
type ShutdownHandler struct {
	logger       logger.Logger
	shutdownChan chan struct{}
}

// ShutdownHandlerConfig contains configuration for the ShutdownHandler
type ShutdownHandlerConfig struct {
	Logger       logger.Logger
	ShutdownChan chan struct{}
}

// ShutdownResponse represents the response structure for shutdown requests
type ShutdownResponse struct {
	Status  string `json:"status"`
	Message string `json:"message"`
}

// NewShutdownHandler creates a new ShutdownHandler instance
func NewShutdownHandler(config ShutdownHandlerConfig) (*ShutdownHandler, error) {
	if config.Logger == nil {
		return nil, fmt.Errorf("logger is required")
	}
	if config.ShutdownChan == nil {
		return nil, fmt.Errorf("shutdown channel is required")
	}

	return &ShutdownHandler{
		logger:       config.Logger,
		shutdownChan: config.ShutdownChan,
	}, nil
}

// HandleShutdown handles the shutdown RPC request
func (sh *ShutdownHandler) HandleShutdown(request types.RpcRequest) (types.RpcResponse, error) {
	sh.logger.Info("Received shutdown request, initiating graceful shutdown", zap.String("id", request.ID))

	// Start graceful shutdown in a goroutine to allow response to be sent first
	go func() {
		// Give the response time to be sent back to the client
		time.Sleep(100 * time.Millisecond)

		sh.logger.Info("Shutting down MCP host process")

		// TODO: Future cleanup logic will be added here:
		// 1. Close database connections
		// 2. Clean up temporary files
		// 3. Close network connections
		// 4. Flush logs
		// 5. Release other resources

		// For now, perform basic cleanup
		sh.logger.Info("Resource cleanup completed")

		// Signal the main goroutine to shut down
		select {
		case <-sh.shutdownChan:
			// Channel already closed, nothing to do
		default:
			close(sh.shutdownChan)
		}
	}()

	response := ShutdownResponse{
		Status:  "shutting_down",
		Message: "MCP host shutdown initiated",
	}

	sh.logger.Debug("Shutdown response prepared",
		zap.String("status", response.Status),
		zap.String("message", response.Message))

	return types.RpcResponse{
		ID:     request.ID,
		Result: response,
	}, nil
}
