package handlers

import (
	"testing"

	"github.com/algonius/algonius-browser/mcp-host-go/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewInitHandler(t *testing.T) {
	tests := []struct {
		name        string
		config      InitHandlerConfig
		expectError bool
		errorMsg    string
	}{
		{
			name: "valid config",
			config: InitHandlerConfig{
				Logger: &mockLogger{},
			},
			expectError: false,
		},
		{
			name: "missing logger",
			config: InitHandlerConfig{
				Logger: nil,
			},
			expectError: true,
			errorMsg:    "logger is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler, err := NewInitHandler(tt.config)

			if tt.expectError {
				assert.Error(t, err)
				assert.Contains(t, err.Error(), tt.errorMsg)
				assert.Nil(t, handler)
			} else {
				assert.NoError(t, err)
				assert.NotNil(t, handler)
				assert.Equal(t, tt.config.Logger, handler.logger)
			}
		})
	}
}

func TestInitHandler_HandleInit(t *testing.T) {
	logger := &mockLogger{}
	handler, err := NewInitHandler(InitHandlerConfig{
		Logger: logger,
	})
	require.NoError(t, err)

	tests := []struct {
		name     string
		request  types.RpcRequest
		expected types.RpcResponse
	}{
		{
			name: "successful init",
			request: types.RpcRequest{
				ID:     "test-123",
				Method: "init",
			},
			expected: types.RpcResponse{
				ID: "test-123",
				Result: InitResponse{
					Status:  "initialized",
					Message: "MCP host initialized successfully",
				},
			},
		},
		{
			name: "init without id",
			request: types.RpcRequest{
				Method: "init",
			},
			expected: types.RpcResponse{
				Result: InitResponse{
					Status:  "initialized",
					Message: "MCP host initialized successfully",
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			response, err := handler.HandleInit(tt.request)

			assert.NoError(t, err)
			assert.Equal(t, tt.expected.ID, response.ID)
			assert.Equal(t, tt.expected.Result, response.Result)
			assert.Nil(t, response.Error)
		})
	}
}
