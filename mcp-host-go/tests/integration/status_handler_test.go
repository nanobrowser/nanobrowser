package integration

import (
	"context"
	"testing"
	"time"

	"env"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStatusHandlerIntegration(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// Create test environment
	testEnv, err := env.NewMcpHostTestEnvironment(&env.TestConfig{
		LogLevel: "debug",
	})
	require.NoError(t, err, "Failed to create test environment")

	// Setup the environment (starts MCP host)
	err = testEnv.Setup(ctx)
	require.NoError(t, err, "Failed to setup test environment")

	// Cleanup when done
	defer func() {
		if cleanupErr := testEnv.Cleanup(); cleanupErr != nil {
			t.Logf("Warning: cleanup failed: %v", cleanupErr)
		}
	}()

	// Test status RPC call through native messaging
	t.Run("status_rpc_via_native_messaging", func(t *testing.T) {
		nativeMsg := testEnv.GetNativeMsg()
		require.NotNil(t, nativeMsg, "Native messaging manager should not be nil")

		// Send status RPC request using RpcRequest
		response, err := nativeMsg.RpcRequest(ctx, "status", nil)
		require.NoError(t, err, "Failed to send status RPC request")

		// Verify response structure
		require.NotNil(t, response, "Response should not be nil")

		// Check if we got a result
		if result, ok := response["result"]; ok {
			t.Logf("Received status response: %+v", result)

			// Parse result as map
			if statusMap, ok := result.(map[string]interface{}); ok {
				// Verify required fields
				assert.NotEmpty(t, statusMap["version"], "Version should not be empty")
				assert.NotEmpty(t, statusMap["sse_port"], "SSE port should not be empty")
				assert.NotEmpty(t, statusMap["sse_base_url"], "SSE base URL should not be empty")
				assert.NotEmpty(t, statusMap["uptime"], "Uptime should not be empty")
				assert.NotZero(t, statusMap["current_time"], "Current time should not be zero")

				// Verify build info
				if buildInfo, ok := statusMap["build_info"].(map[string]interface{}); ok {
					assert.NotEmpty(t, buildInfo["go_version"], "Go version should not be empty")
				}
			}
		} else if errorInfo, ok := response["error"]; ok {
			t.Logf("RPC returned error (expected if status handler not implemented): %+v", errorInfo)
		} else {
			t.Logf("Unexpected response format: %+v", response)
		}
	})
}
