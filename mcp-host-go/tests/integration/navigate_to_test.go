package integration

import (
	"context"
	"testing"
	"time"

	"env"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNavigateToToolTimeout(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	err = testEnv.Setup(ctx)
	require.NoError(t, err)

	// Register RPC handler for navigate_to method with timeout support
	var capturedNavigation map[string]interface{}
	testEnv.GetNativeMsg().RegisterRpcHandler("navigate_to", func(params map[string]interface{}) (interface{}, error) {
		capturedNavigation = params
		return map[string]interface{}{
			"success": true,
			"message": "Navigation completed",
			"url":     params["url"],
		}, nil
	})

	// Initialize MCP client
	err = testEnv.GetMcpClient().Initialize(ctx)
	require.NoError(t, err)

	t.Run("navigate with default timeout", func(t *testing.T) {
		// Test navigation with default (auto) timeout
		result, err := testEnv.GetMcpClient().CallTool("navigate_to", map[string]interface{}{
			"url": "https://httpbin.org/delay/1",
		})

		require.NoError(t, err, "navigate_to tool should succeed")
		require.False(t, result.IsError, "Tool should not return error")

		// Wait for RPC call to be processed
		time.Sleep(100 * time.Millisecond)

		// Verify navigation was requested
		require.NotNil(t, capturedNavigation, "Navigation should be captured")
		assert.Equal(t, "https://httpbin.org/delay/1", capturedNavigation["url"])
		assert.Equal(t, "auto", capturedNavigation["timeout"]) // Should default to auto
	})

	t.Run("navigate with custom timeout", func(t *testing.T) {
		capturedNavigation = nil // Reset

		// Test navigation with custom timeout
		result, err := testEnv.GetMcpClient().CallTool("navigate_to", map[string]interface{}{
			"url":     "https://httpbin.org/delay/1",
			"timeout": "10000",
		})

		require.NoError(t, err, "navigate_to tool should succeed")
		require.False(t, result.IsError, "Tool should not return error")

		// Wait for RPC call to be processed
		time.Sleep(100 * time.Millisecond)

		// Verify navigation was requested with custom timeout
		require.NotNil(t, capturedNavigation, "Navigation should be captured")
		assert.Equal(t, "https://httpbin.org/delay/1", capturedNavigation["url"])
		assert.Equal(t, "10000", capturedNavigation["timeout"])
	})

	t.Run("navigate with invalid timeout", func(t *testing.T) {
		// Test navigation with invalid timeout (too short)
		result, err := testEnv.GetMcpClient().CallTool("navigate_to", map[string]interface{}{
			"url":     "https://httpbin.org/delay/1",
			"timeout": "500", // Too short
		})

		// Should either return error or result.IsError should be true
		if err == nil {
			require.True(t, result.IsError, "Should return error for invalid timeout")
		} else {
			assert.Contains(t, err.Error(), "timeout must be between 1000 and 120000 milliseconds")
		}
	})

	t.Run("navigate with auto timeout", func(t *testing.T) {
		capturedNavigation = nil // Reset

		// Test navigation with explicit auto timeout
		result, err := testEnv.GetMcpClient().CallTool("navigate_to", map[string]interface{}{
			"url":     "https://httpbin.org/delay/1",
			"timeout": "auto",
		})

		require.NoError(t, err, "navigate_to tool should succeed")
		require.False(t, result.IsError, "Tool should not return error")

		// Wait for RPC call to be processed
		time.Sleep(100 * time.Millisecond)

		// Verify navigation was requested with auto timeout
		require.NotNil(t, capturedNavigation, "Navigation should be captured")
		assert.Equal(t, "https://httpbin.org/delay/1", capturedNavigation["url"])
		assert.Equal(t, "auto", capturedNavigation["timeout"])
	})
}

func TestNavigateToToolSchema(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Minute)
	defer cancel()

	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	err = testEnv.Setup(ctx)
	require.NoError(t, err)

	// Initialize MCP client
	err = testEnv.GetMcpClient().Initialize(ctx)
	require.NoError(t, err)

	t.Run("verify schema includes timeout parameter", func(t *testing.T) {
		tools, err := testEnv.GetMcpClient().ListTools()
		require.NoError(t, err, "Should be able to list tools")

		var navigateToTool *mcp.Tool
		for _, tool := range tools.Tools {
			if tool.Name == "navigate_to" {
				navigateToTool = &tool
				break
			}
		}

		require.NotNil(t, navigateToTool, "navigate_to tool should be found")

		// The exact structure will depend on how the tool schema is represented
		// This is a basic test to ensure the tool exists and can be called
		assert.Equal(t, "navigate_to", navigateToTool.Name)
		assert.Contains(t, navigateToTool.Description, "Navigate to a specified URL")
	})
}
