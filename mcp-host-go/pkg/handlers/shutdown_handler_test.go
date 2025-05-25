package handlers

import (
	"testing"
	"time"

	"github.com/algonius/algonius-browser/mcp-host-go/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewShutdownHandler(t *testing.T) {
	tests := []struct {
		name        string
		config      ShutdownHandlerConfig
		expectError bool
		errorMsg    string
	}{
		{
			name: "valid config",
			config: ShutdownHandlerConfig{
				Logger:       &mockLogger{},
				ShutdownChan: make(chan struct{}),
			},
			expectError: false,
		},
		{
			name: "missing logger",
			config: ShutdownHandlerConfig{
				Logger:       nil,
				ShutdownChan: make(chan struct{}),
			},
			expectError: true,
			errorMsg:    "logger is required",
		},
		{
			name: "missing shutdown channel",
			config: ShutdownHandlerConfig{
				Logger:       &mockLogger{},
				ShutdownChan: nil,
			},
			expectError: true,
			errorMsg:    "shutdown channel is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler, err := NewShutdownHandler(tt.config)

			if tt.expectError {
				assert.Error(t, err)
				assert.Contains(t, err.Error(), tt.errorMsg)
				assert.Nil(t, handler)
			} else {
				assert.NoError(t, err)
				assert.NotNil(t, handler)
				assert.Equal(t, tt.config.Logger, handler.logger)
				assert.Equal(t, tt.config.ShutdownChan, handler.shutdownChan)
			}
		})
	}
}

func TestShutdownHandler_HandleShutdown(t *testing.T) {
	logger := &mockLogger{}

	tests := []struct {
		name     string
		request  types.RpcRequest
		expected types.RpcResponse
	}{
		{
			name: "successful shutdown",
			request: types.RpcRequest{
				ID:     "test-123",
				Method: "shutdown",
			},
			expected: types.RpcResponse{
				ID: "test-123",
				Result: ShutdownResponse{
					Status:  "shutting_down",
					Message: "MCP host shutdown initiated",
				},
			},
		},
		{
			name: "shutdown without id",
			request: types.RpcRequest{
				Method: "shutdown",
			},
			expected: types.RpcResponse{
				Result: ShutdownResponse{
					Status:  "shutting_down",
					Message: "MCP host shutdown initiated",
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create a new shutdown channel for each test
			testShutdownChan := make(chan struct{})
			testHandler, err := NewShutdownHandler(ShutdownHandlerConfig{
				Logger:       logger,
				ShutdownChan: testShutdownChan,
			})
			require.NoError(t, err)

			response, err := testHandler.HandleShutdown(tt.request)

			assert.NoError(t, err)
			assert.Equal(t, tt.expected.ID, response.ID)
			assert.Equal(t, tt.expected.Result, response.Result)
			assert.Nil(t, response.Error)

			// Verify that shutdown channel is closed within a reasonable time
			select {
			case <-testShutdownChan:
				// Expected - channel was closed
			case <-time.After(200 * time.Millisecond):
				t.Error("shutdown channel was not closed within expected time")
			}
		})
	}
}

func TestShutdownHandler_HandleShutdownAlreadyClosed(t *testing.T) {
	shutdownChan := make(chan struct{})
	close(shutdownChan) // Pre-close the channel

	logger := &mockLogger{}
	handler, err := NewShutdownHandler(ShutdownHandlerConfig{
		Logger:       logger,
		ShutdownChan: shutdownChan,
	})
	require.NoError(t, err)

	request := types.RpcRequest{
		ID:     "test-456",
		Method: "shutdown",
	}

	// This should not panic even if the channel is already closed
	response, err := handler.HandleShutdown(request)

	assert.NoError(t, err)
	assert.Equal(t, "test-456", response.ID)

	result, ok := response.Result.(ShutdownResponse)
	require.True(t, ok)
	assert.Equal(t, "shutting_down", result.Status)
	assert.Equal(t, "MCP host shutdown initiated", result.Message)
}
