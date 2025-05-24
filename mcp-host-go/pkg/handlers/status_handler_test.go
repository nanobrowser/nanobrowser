package handlers

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/algonius/algonius-browser/mcp-host-go/pkg/logger"
	"github.com/algonius/algonius-browser/mcp-host-go/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestStatusHandler_NewStatusHandler(t *testing.T) {
	tests := []struct {
		name        string
		config      StatusHandlerConfig
		expectError bool
	}{
		{
			name: "valid config",
			config: StatusHandlerConfig{
				Logger:      &mockLogger{},
				StartTime:   time.Now(),
				SSEPort:     ":8080",
				SSEBaseURL:  "http://localhost:8080",
				SSEBasePath: "/mcp",
			},
			expectError: false,
		},
		{
			name: "missing logger",
			config: StatusHandlerConfig{
				StartTime:   time.Now(),
				SSEPort:     ":8080",
				SSEBaseURL:  "http://localhost:8080",
				SSEBasePath: "/mcp",
			},
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler, err := NewStatusHandler(tt.config)
			if tt.expectError {
				assert.Error(t, err)
				assert.Nil(t, handler)
			} else {
				assert.NoError(t, err)
				assert.NotNil(t, handler)
			}
		})
	}
}

func TestStatusHandler_HandleStatus(t *testing.T) {
	startTime := time.Now().Add(-5 * time.Minute) // 5 minutes ago

	handler, err := NewStatusHandler(StatusHandlerConfig{
		Logger:      &mockLogger{},
		StartTime:   startTime,
		SSEPort:     ":9090",
		SSEBaseURL:  "http://test:9090",
		SSEBasePath: "/test",
	})
	require.NoError(t, err)

	request := types.RpcRequest{
		ID:     "test-123",
		Method: "status",
	}

	response, err := handler.HandleStatus(request)

	assert.NoError(t, err)
	assert.Equal(t, "test-123", response.ID)
	assert.Nil(t, response.Error)
	assert.NotNil(t, response.Result)

	// Verify the result structure
	resultBytes, err := json.Marshal(response.Result)
	require.NoError(t, err)

	var status StatusResponse
	err = json.Unmarshal(resultBytes, &status)
	require.NoError(t, err)

	// Verify response fields
	assert.Equal(t, ":9090", status.SSEPort)
	assert.Equal(t, "http://test:9090", status.SSEBaseURL)
	assert.Equal(t, "/test", status.SSEBasePath)
	assert.NotEmpty(t, status.Version)
	assert.NotEmpty(t, status.Uptime)
	assert.NotZero(t, status.CurrentTime)

	// Verify build info
	assert.NotEmpty(t, status.BuildInfo.GoVersion)
	assert.NotEmpty(t, status.BuildInfo.BuildTime)
	assert.NotEmpty(t, status.BuildInfo.GitCommit)
}

func TestFormatDuration(t *testing.T) {
	tests := []struct {
		name     string
		duration time.Duration
		expected string
	}{
		{"seconds", 30 * time.Second, "30s"},
		{"one minute", 1 * time.Minute, "1m"},
		{"minutes and seconds", 2*time.Minute + 30*time.Second, "2m30s"},
		{"one hour", 1 * time.Hour, "1h"},
		{"hours and minutes", 2*time.Hour + 30*time.Minute, "2h30m"},
		{"one day", 24 * time.Hour, "1d"},
		{"days and hours", 2*24*time.Hour + 5*time.Hour, "2d5h"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := formatDuration(tt.duration)
			assert.Equal(t, tt.expected, result)
		})
	}
}

// mockLogger implements the logger.Logger interface for testing
type mockLogger struct{}

func (m *mockLogger) Debug(msg string, fields ...zap.Field)  {}
func (m *mockLogger) Info(msg string, fields ...zap.Field)   {}
func (m *mockLogger) Warn(msg string, fields ...zap.Field)   {}
func (m *mockLogger) Error(msg string, fields ...zap.Field)  {}
func (m *mockLogger) Named(name string) logger.Logger        { return &mockLogger{} }
func (m *mockLogger) With(fields ...zap.Field) logger.Logger { return &mockLogger{} }
func (m *mockLogger) Sync() error                            { return nil }
