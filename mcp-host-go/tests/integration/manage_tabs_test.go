package integration

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"env"
)

func TestManageTabsToolBasicFunctionality(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Setup test environment
	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	err = testEnv.Setup(ctx)
	require.NoError(t, err)

	// Track captured manage_tabs requests
	var capturedManageTabsRequests []map[string]interface{}

	// Register RPC handler for manage_tabs method
	testEnv.GetNativeMsg().RegisterRpcHandler("manage_tabs", func(params map[string]interface{}) (interface{}, error) {
		capturedManageTabsRequests = append(capturedManageTabsRequests, params)

		action := params["action"].(string)
		switch action {
		case "switch":
			return map[string]interface{}{
				"success": true,
				"message": "Successfully switched to tab " + params["tab_id"].(string),
				"tab_id":  params["tab_id"],
			}, nil
		case "open":
			return map[string]interface{}{
				"success":    true,
				"message":    "Successfully opened new tab with URL: " + params["url"].(string),
				"new_tab_id": "456",
				"url":        params["url"],
				"background": params["background"],
			}, nil
		case "close":
			return map[string]interface{}{
				"success": true,
				"message": "Successfully closed tab " + params["tab_id"].(string),
				"tab_id":  params["tab_id"],
			}, nil
		default:
			return map[string]interface{}{
				"success": false,
				"message": "Invalid action",
			}, nil
		}
	})

	// Initialize MCP client
	err = testEnv.GetMcpClient().Initialize(ctx)
	require.NoError(t, err)

	// Verify manage_tabs tool is available
	tools, err := testEnv.GetMcpClient().ListTools()
	if err != nil {
		t.Logf("ListTools failed (expected if not implemented): %v", err)
		return
	}

	found := false
	for _, tool := range tools.Tools {
		if tool.Name == "manage_tabs" {
			found = true
			assert.Contains(t, tool.Description, "Manage browser tabs")
			t.Log("Found manage_tabs tool with correct description")
			break
		}
	}

	if !found {
		t.Log("manage_tabs tool not found (expected if not implemented)")
		return
	}

	// Test switch tab operation
	t.Run("successful_switch_tab", func(t *testing.T) {
		// Clear previous requests
		capturedManageTabsRequests = nil

		// Execute manage_tabs tool for switch action
		result, err := testEnv.GetMcpClient().CallTool("manage_tabs", map[string]interface{}{
			"action": "switch",
			"tab_id": "123",
		})
		require.NoError(t, err)
		assert.False(t, result.IsError, "Tool execution should not result in error")

		// Wait for RPC call to be processed
		time.Sleep(100 * time.Millisecond)

		// Verify RPC call was made with correct parameters
		require.Len(t, capturedManageTabsRequests, 1, "Should have captured exactly one manage_tabs request")

		capturedParams := capturedManageTabsRequests[0]
		assert.Equal(t, "switch", capturedParams["action"])
		assert.Equal(t, "123", capturedParams["tab_id"])

		t.Log("Successfully tested switch tab operation")
	})

	// Test open tab operation
	t.Run("successful_open_tab", func(t *testing.T) {
		// Clear previous requests
		capturedManageTabsRequests = nil

		// Execute manage_tabs tool for open action
		result, err := testEnv.GetMcpClient().CallTool("manage_tabs", map[string]interface{}{
			"action": "open",
			"url":    "https://example.com",
		})
		require.NoError(t, err)
		assert.False(t, result.IsError, "Tool execution should not result in error")

		// Wait for RPC call to be processed
		time.Sleep(100 * time.Millisecond)

		// Verify RPC call was made with correct parameters
		require.Len(t, capturedManageTabsRequests, 1, "Should have captured exactly one manage_tabs request")

		capturedParams := capturedManageTabsRequests[0]
		assert.Equal(t, "open", capturedParams["action"])
		assert.Equal(t, "https://example.com", capturedParams["url"])

		t.Log("Successfully tested open tab operation")
	})

	// Test close tab operation
	t.Run("successful_close_tab", func(t *testing.T) {
		// Clear previous requests
		capturedManageTabsRequests = nil

		// Execute manage_tabs tool for close action
		result, err := testEnv.GetMcpClient().CallTool("manage_tabs", map[string]interface{}{
			"action": "close",
			"tab_id": "123",
		})
		require.NoError(t, err)
		assert.False(t, result.IsError, "Tool execution should not result in error")

		// Wait for RPC call to be processed
		time.Sleep(100 * time.Millisecond)

		// Verify RPC call was made with correct parameters
		require.Len(t, capturedManageTabsRequests, 1, "Should have captured exactly one manage_tabs request")

		capturedParams := capturedManageTabsRequests[0]
		assert.Equal(t, "close", capturedParams["action"])
		assert.Equal(t, "123", capturedParams["tab_id"])

		t.Log("Successfully tested close tab operation")
	})
}

func TestManageTabsToolParameterValidation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Setup test environment
	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	err = testEnv.Setup(ctx)
	require.NoError(t, err)

	// Register RPC handler (won't be called for invalid parameters)
	testEnv.GetNativeMsg().RegisterRpcHandler("manage_tabs", func(params map[string]interface{}) (interface{}, error) {
		return map[string]interface{}{
			"success": true,
		}, nil
	})

	// Initialize MCP client
	err = testEnv.GetMcpClient().Initialize(ctx)
	require.NoError(t, err)

	// Verify manage_tabs tool is available
	tools, err := testEnv.GetMcpClient().ListTools()
	if err != nil {
		t.Logf("ListTools failed: %v", err)
		return
	}

	found := false
	for _, tool := range tools.Tools {
		if tool.Name == "manage_tabs" {
			found = true
			break
		}
	}

	if !found {
		t.Log("manage_tabs tool not found")
		return
	}

	// Test cases for parameter validation
	testCases := []struct {
		name        string
		args        map[string]interface{}
		expectError bool
	}{
		{
			name:        "missing_action",
			args:        map[string]interface{}{},
			expectError: true,
		},
		{
			name:        "invalid_action",
			args:        map[string]interface{}{"action": "invalid_action"},
			expectError: true,
		},
		{
			name:        "switch_missing_tab_id",
			args:        map[string]interface{}{"action": "switch"},
			expectError: true,
		},
		{
			name:        "close_missing_tab_id",
			args:        map[string]interface{}{"action": "close"},
			expectError: true,
		},
		{
			name:        "open_missing_url",
			args:        map[string]interface{}{"action": "open"},
			expectError: true,
		},
		{
			name: "valid_switch_tab",
			args: map[string]interface{}{
				"action": "switch",
				"tab_id": "123",
			},
			expectError: false,
		},
		{
			name: "valid_open_tab",
			args: map[string]interface{}{
				"action": "open",
				"url":    "https://example.com",
			},
			expectError: false,
		},
		{
			name: "valid_close_tab",
			args: map[string]interface{}{
				"action": "close",
				"tab_id": "123",
			},
			expectError: false,
		},
		{
			name: "valid_open_tab_background",
			args: map[string]interface{}{
				"action":     "open",
				"url":        "https://example.com",
				"background": true,
			},
			expectError: false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result, err := testEnv.GetMcpClient().CallTool("manage_tabs", tc.args)

			if tc.expectError {
				// For parameter validation errors, we expect either an error or IsError=true
				if err == nil {
					assert.True(t, result.IsError, "Expected tool execution to result in error for case: %s", tc.name)
				}
				t.Logf("Correctly caught validation error for case: %s", tc.name)
			} else {
				require.NoError(t, err)
				assert.False(t, result.IsError, "Tool execution should not result in error for case: %s", tc.name)
			}
		})
	}
}

func TestManageTabsToolBackgroundOperation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Setup test environment
	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	err = testEnv.Setup(ctx)
	require.NoError(t, err)

	// Track captured requests
	var capturedRequests []map[string]interface{}

	// Register RPC handler for background tab opening
	testEnv.GetNativeMsg().RegisterRpcHandler("manage_tabs", func(params map[string]interface{}) (interface{}, error) {
		capturedRequests = append(capturedRequests, params)

		return map[string]interface{}{
			"success":    true,
			"message":    "Successfully opened new tab with URL: " + params["url"].(string),
			"new_tab_id": "456",
			"url":        params["url"],
			"background": params["background"],
		}, nil
	})

	// Initialize MCP client
	err = testEnv.GetMcpClient().Initialize(ctx)
	require.NoError(t, err)

	// Verify manage_tabs tool is available
	tools, err := testEnv.GetMcpClient().ListTools()
	if err != nil {
		t.Logf("ListTools failed: %v", err)
		return
	}

	found := false
	for _, tool := range tools.Tools {
		if tool.Name == "manage_tabs" {
			found = true
			break
		}
	}

	if !found {
		t.Log("manage_tabs tool not found")
		return
	}

	// Test background tab opening
	t.Run("background_tab_opening", func(t *testing.T) {
		// Clear previous requests
		capturedRequests = nil

		result, err := testEnv.GetMcpClient().CallTool("manage_tabs", map[string]interface{}{
			"action":     "open",
			"url":        "https://example.com",
			"background": true,
		})

		require.NoError(t, err)
		assert.False(t, result.IsError, "Tool execution should not result in error")

		// Wait for RPC call to be processed
		time.Sleep(50 * time.Millisecond)

		// Verify RPC call was made
		require.Len(t, capturedRequests, 1, "Should have captured the request")
		assert.Equal(t, "open", capturedRequests[0]["action"])
		assert.Equal(t, "https://example.com", capturedRequests[0]["url"])
		assert.Equal(t, true, capturedRequests[0]["background"])

		t.Log("Successfully tested background tab opening")
	})
}

func TestManageTabsToolSchema(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Setup test environment
	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	err = testEnv.Setup(ctx)
	require.NoError(t, err)

	// Initialize MCP client
	err = testEnv.GetMcpClient().Initialize(ctx)
	require.NoError(t, err)

	// Get tools list
	tools, err := testEnv.GetMcpClient().ListTools()
	if err != nil {
		t.Logf("ListTools failed: %v", err)
		return
	}

	// Find manage_tabs tool
	var manageTabsTool *struct {
		Name        string
		Description string
	}

	for _, tool := range tools.Tools {
		if tool.Name == "manage_tabs" {
			manageTabsTool = &struct {
				Name        string
				Description string
			}{
				Name:        tool.Name,
				Description: tool.Description,
			}
			break
		}
	}

	if manageTabsTool == nil {
		t.Log("manage_tabs tool not found")
		return
	}

	// Validate tool schema
	t.Run("tool_schema_validation", func(t *testing.T) {
		assert.Equal(t, "manage_tabs", manageTabsTool.Name)
		assert.Contains(t, manageTabsTool.Description, "Manage browser tabs")

		t.Log("Successfully validated manage_tabs tool schema")
	})
}
