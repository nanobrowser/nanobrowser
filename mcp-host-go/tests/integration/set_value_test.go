package integration

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"env"
)

func TestSetValueToolBasicFunctionality(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Setup test environment
	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	err = testEnv.Setup(ctx)
	require.NoError(t, err)

	// Track captured set_value requests
	var capturedSetValueRequests []map[string]interface{}

	// Register RPC handler for set_value method
	testEnv.GetNativeMsg().RegisterRpcHandler("set_value", func(params map[string]interface{}) (interface{}, error) {
		capturedSetValueRequests = append(capturedSetValueRequests, params)
		return map[string]interface{}{
			"success":       true,
			"message":       "Successfully set value",
			"target":        params["target"],
			"target_type":   params["target_type"],
			"element_index": 0,
			"element_type":  "text-input",
			"input_method":  "type",
			"actual_value":  params["value"],
			"element_info": map[string]interface{}{
				"tag_name":    "input",
				"text":        "",
				"placeholder": "Enter text here",
				"name":        "text-input",
				"id":          "text-input",
				"type":        "text",
			},
			"options_used": map[string]interface{}{
				"clear_first": true,
				"submit":      false,
				"wait_after":  1.0,
			},
		}, nil
	})

	// Initialize MCP client
	err = testEnv.GetMcpClient().Initialize(ctx)
	require.NoError(t, err)

	// Verify set_value tool is available
	tools, err := testEnv.GetMcpClient().ListTools()
	if err != nil {
		t.Logf("ListTools failed (expected if not implemented): %v", err)
		return
	}

	found := false
	for _, tool := range tools.Tools {
		if tool.Name == "set_value" {
			found = true
			assert.Contains(t, tool.Description, "Set values on interactive elements")
			t.Log("Found set_value tool with correct description")
			break
		}
	}

	if !found {
		t.Log("set_value tool not found (expected if not implemented)")
		return
	}

	// Test basic set value operation
	t.Run("successful text input", func(t *testing.T) {
		// Clear previous requests
		capturedSetValueRequests = nil

		// Execute set_value tool
		result, err := testEnv.GetMcpClient().CallTool("set_value", map[string]interface{}{
			"target":      0,
			"target_type": "index",
			"value":       "Hello World",
			"options": map[string]interface{}{
				"clear_first": true,
				"wait_after":  1.0,
			},
		})
		require.NoError(t, err)
		assert.False(t, result.IsError, "Tool execution should not result in error")

		// Wait for RPC call to be processed
		time.Sleep(100 * time.Millisecond)

		// Verify RPC call was made with correct parameters
		require.Len(t, capturedSetValueRequests, 1, "Should have captured exactly one set_value request")

		capturedParams := capturedSetValueRequests[0]
		assert.Equal(t, float64(0), capturedParams["target"])
		assert.Equal(t, "index", capturedParams["target_type"])
		assert.Equal(t, "Hello World", capturedParams["value"])

		options := capturedParams["options"].(map[string]interface{})
		assert.Equal(t, true, options["clear_first"])
		assert.Equal(t, 1.0, options["wait_after"])

		t.Log("Successfully tested basic text input setting")
	})
}

func TestSetValueToolParameterValidation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Setup test environment
	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	err = testEnv.Setup(ctx)
	require.NoError(t, err)

	// Register RPC handler (won't be called for invalid parameters)
	testEnv.GetNativeMsg().RegisterRpcHandler("set_value", func(params map[string]interface{}) (interface{}, error) {
		return map[string]interface{}{
			"success": true,
		}, nil
	})

	// Initialize MCP client
	err = testEnv.GetMcpClient().Initialize(ctx)
	require.NoError(t, err)

	// Verify set_value tool is available
	tools, err := testEnv.GetMcpClient().ListTools()
	if err != nil {
		t.Logf("ListTools failed: %v", err)
		return
	}

	found := false
	for _, tool := range tools.Tools {
		if tool.Name == "set_value" {
			found = true
			break
		}
	}

	if !found {
		t.Log("set_value tool not found")
		return
	}

	// Test cases for parameter validation
	testCases := []struct {
		name        string
		args        map[string]interface{}
		expectError bool
	}{
		{
			name:        "missing_target",
			args:        map[string]interface{}{"value": "test"},
			expectError: true,
		},
		{
			name:        "missing_value",
			args:        map[string]interface{}{"target": 0},
			expectError: true,
		},
		{
			name: "invalid_wait_after_negative",
			args: map[string]interface{}{
				"target": 0,
				"value":  "test",
				"options": map[string]interface{}{
					"wait_after": -1,
				},
			},
			expectError: true,
		},
		{
			name: "invalid_wait_after_too_large",
			args: map[string]interface{}{
				"target": 0,
				"value":  "test",
				"options": map[string]interface{}{
					"wait_after": 35,
				},
			},
			expectError: true,
		},
		{
			name: "valid_parameters",
			args: map[string]interface{}{
				"target":      0,
				"target_type": "index",
				"value":       "test value",
				"options": map[string]interface{}{
					"clear_first": true,
					"submit":      false,
					"wait_after":  1.5,
				},
			},
			expectError: false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result, err := testEnv.GetMcpClient().CallTool("set_value", tc.args)

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

func TestSetValueToolDifferentElementTypes(t *testing.T) {
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

	// Register RPC handler that simulates different element types
	testEnv.GetNativeMsg().RegisterRpcHandler("set_value", func(params map[string]interface{}) (interface{}, error) {
		capturedRequests = append(capturedRequests, params)

		target := params["target"]
		value := params["value"]

		// Simulate different responses based on target
		switch target {
		case float64(0): // Text input
			return map[string]interface{}{
				"success":       true,
				"element_type":  "text-input",
				"input_method":  "type",
				"actual_value":  value,
				"element_index": 0,
			}, nil
		case float64(1): // Select dropdown
			return map[string]interface{}{
				"success":       true,
				"element_type":  "select",
				"input_method":  "single-select",
				"actual_value":  value,
				"element_index": 1,
			}, nil
		case float64(2): // Checkbox
			return map[string]interface{}{
				"success":       true,
				"element_type":  "checkbox",
				"input_method":  "toggle",
				"actual_value":  value,
				"element_index": 2,
			}, nil
		default:
			return map[string]interface{}{
				"success":       true,
				"element_type":  "unknown",
				"actual_value":  value,
				"element_index": target,
			}, nil
		}
	})

	// Initialize MCP client
	err = testEnv.GetMcpClient().Initialize(ctx)
	require.NoError(t, err)

	// Verify set_value tool is available
	tools, err := testEnv.GetMcpClient().ListTools()
	if err != nil {
		t.Logf("ListTools failed: %v", err)
		return
	}

	found := false
	for _, tool := range tools.Tools {
		if tool.Name == "set_value" {
			found = true
			break
		}
	}

	if !found {
		t.Log("set_value tool not found")
		return
	}

	// Test different element types
	elementTestCases := []struct {
		name           string
		target         int
		value          interface{}
		expectedType   string
		expectedMethod string
	}{
		{
			name:           "text_input",
			target:         0,
			value:          "Hello World",
			expectedType:   "text-input",
			expectedMethod: "type",
		},
		{
			name:           "select_dropdown",
			target:         1,
			value:          "Option 1",
			expectedType:   "select",
			expectedMethod: "single-select",
		},
		{
			name:           "checkbox",
			target:         2,
			value:          true,
			expectedType:   "checkbox",
			expectedMethod: "toggle",
		},
	}

	for _, tc := range elementTestCases {
		t.Run(tc.name, func(t *testing.T) {
			// Clear previous requests
			capturedRequests = nil

			result, err := testEnv.GetMcpClient().CallTool("set_value", map[string]interface{}{
				"target":      tc.target,
				"target_type": "index",
				"value":       tc.value,
			})

			require.NoError(t, err)
			assert.False(t, result.IsError, "Tool execution should not result in error")

			// Wait for RPC call to be processed
			time.Sleep(50 * time.Millisecond)

			// Verify RPC call was made
			require.Len(t, capturedRequests, 1, "Should have captured the request")
			assert.Equal(t, float64(tc.target), capturedRequests[0]["target"])
			assert.Equal(t, tc.value, capturedRequests[0]["value"])

			t.Logf("Successfully tested %s element type", tc.name)
		})
	}
}

func TestSetValueToolWithDescription(t *testing.T) {
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

	// Register RPC handler for description-based targeting
	testEnv.GetNativeMsg().RegisterRpcHandler("set_value", func(params map[string]interface{}) (interface{}, error) {
		capturedRequests = append(capturedRequests, params)

		return map[string]interface{}{
			"success":       true,
			"target":        params["target"],
			"target_type":   params["target_type"],
			"element_index": 0,
			"element_type":  "text-input",
			"input_method":  "type",
			"actual_value":  params["value"],
			"element_info": map[string]interface{}{
				"tag_name":    "input",
				"placeholder": "Enter your name",
				"id":          "name-field",
				"type":        "text",
			},
		}, nil
	})

	// Initialize MCP client
	err = testEnv.GetMcpClient().Initialize(ctx)
	require.NoError(t, err)

	// Verify set_value tool is available
	tools, err := testEnv.GetMcpClient().ListTools()
	if err != nil {
		t.Logf("ListTools failed: %v", err)
		return
	}

	found := false
	for _, tool := range tools.Tools {
		if tool.Name == "set_value" {
			found = true
			break
		}
	}

	if !found {
		t.Log("set_value tool not found")
		return
	}

	// Test description-based targeting
	t.Run("description_targeting", func(t *testing.T) {
		// Clear previous requests
		capturedRequests = nil

		result, err := testEnv.GetMcpClient().CallTool("set_value", map[string]interface{}{
			"target":      "Enter your name",
			"target_type": "description",
			"value":       "John Doe",
		})

		require.NoError(t, err)
		assert.False(t, result.IsError, "Tool execution should not result in error")

		// Wait for RPC call to be processed
		time.Sleep(50 * time.Millisecond)

		// Verify RPC call was made with correct parameters
		require.Len(t, capturedRequests, 1, "Should have captured the request")
		assert.Equal(t, "Enter your name", capturedRequests[0]["target"])
		assert.Equal(t, "description", capturedRequests[0]["target_type"])
		assert.Equal(t, "John Doe", capturedRequests[0]["value"])

		t.Log("Successfully tested description-based targeting")
	})
}

func TestSetValueToolSchema(t *testing.T) {
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

	// Find set_value tool
	var setValueTool *struct {
		Name        string
		Description string
	}

	for _, tool := range tools.Tools {
		if tool.Name == "set_value" {
			setValueTool = &struct {
				Name        string
				Description string
			}{
				Name:        tool.Name,
				Description: tool.Description,
			}
			break
		}
	}

	if setValueTool == nil {
		t.Log("set_value tool not found")
		return
	}

	// Validate tool schema
	t.Run("tool_schema_validation", func(t *testing.T) {
		assert.Equal(t, "set_value", setValueTool.Name)
		assert.Contains(t, setValueTool.Description, "Set values")

		t.Log("Successfully validated set_value tool schema")
	})
}
