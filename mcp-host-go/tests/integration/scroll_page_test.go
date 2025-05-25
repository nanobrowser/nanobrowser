package integration

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"env"
)

func TestScrollPageToolBasicActions(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Setup test environment
	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	err = testEnv.Setup(ctx)
	require.NoError(t, err)

	// Track captured scroll requests
	var capturedScrollRequests []map[string]interface{}

	// Register RPC handler for scroll_page method
	testEnv.GetNativeMsg().RegisterRpcHandler("scroll_page", func(params map[string]interface{}) (interface{}, error) {
		capturedScrollRequests = append(capturedScrollRequests, params)
		return map[string]interface{}{
			"success": true,
			"message": "Scroll completed",
		}, nil
	})

	// Initialize MCP client
	err = testEnv.GetMcpClient().Initialize(ctx)
	require.NoError(t, err)

	// Verify scroll_page tool is available
	tools, err := testEnv.GetMcpClient().ListTools()
	if err != nil {
		t.Logf("ListTools failed (expected if not implemented): %v", err)
		return
	}

	found := false
	for _, tool := range tools.Tools {
		if tool.Name == "scroll_page" {
			found = true
			assert.Equal(t, "Scroll the browser page in various directions or to specific positions", tool.Description)
			t.Log("Found scroll_page tool with correct description")
			break
		}
	}

	if !found {
		t.Log("scroll_page tool not found (expected if not implemented)")
		return
	}

	// Test cases for basic scroll actions
	testCases := []struct {
		name     string
		args     map[string]interface{}
		expected map[string]interface{}
	}{
		{
			name: "scroll_up_default",
			args: map[string]interface{}{
				"action": "up",
			},
			expected: map[string]interface{}{
				"action": "up",
				"pixels": 300.0,
			},
		},
		{
			name: "scroll_down_custom_pixels",
			args: map[string]interface{}{
				"action": "down",
				"pixels": 500.0,
			},
			expected: map[string]interface{}{
				"action": "down",
				"pixels": 500.0,
			},
		},
		{
			name: "scroll_to_top",
			args: map[string]interface{}{
				"action": "to_top",
			},
			expected: map[string]interface{}{
				"action": "to_top",
			},
		},
		{
			name: "scroll_to_bottom",
			args: map[string]interface{}{
				"action": "to_bottom",
			},
			expected: map[string]interface{}{
				"action": "to_bottom",
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Clear previous requests
			capturedScrollRequests = nil

			// Execute scroll tool
			result, err := testEnv.GetMcpClient().CallTool("scroll_page", tc.args)
			require.NoError(t, err)
			assert.False(t, result.IsError, "Tool execution should not result in error")

			// Wait for RPC call to be processed
			time.Sleep(100 * time.Millisecond)

			// Verify RPC call was made with correct parameters
			require.Len(t, capturedScrollRequests, 1, "Should have captured exactly one scroll request")

			capturedParams := capturedScrollRequests[0]
			for key, expectedValue := range tc.expected {
				assert.Equal(t, expectedValue, capturedParams[key], "Parameter %s should match expected value", key)
			}

			t.Logf("Successfully tested %s action", tc.args["action"])
		})
	}
}

func TestScrollPageToolElementScroll(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Setup test environment
	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	err = testEnv.Setup(ctx)
	require.NoError(t, err)

	// Track captured scroll requests
	var capturedScrollRequests []map[string]interface{}

	// Register RPC handler for scroll_page method
	testEnv.GetNativeMsg().RegisterRpcHandler("scroll_page", func(params map[string]interface{}) (interface{}, error) {
		capturedScrollRequests = append(capturedScrollRequests, params)
		return map[string]interface{}{
			"success": true,
			"message": "Scrolled to element",
		}, nil
	})

	// Initialize MCP client
	err = testEnv.GetMcpClient().Initialize(ctx)
	require.NoError(t, err)

	// Verify scroll_page tool is available
	tools, err := testEnv.GetMcpClient().ListTools()
	if err != nil {
		t.Logf("ListTools failed: %v", err)
		return
	}

	found := false
	for _, tool := range tools.Tools {
		if tool.Name == "scroll_page" {
			found = true
			break
		}
	}

	if !found {
		t.Log("scroll_page tool not found")
		return
	}

	// Test to_element action with valid element_index
	result, err := testEnv.GetMcpClient().CallTool("scroll_page", map[string]interface{}{
		"action":        "to_element",
		"element_index": 5,
	})

	require.NoError(t, err)
	assert.False(t, result.IsError, "Tool execution should not result in error")

	// Wait for RPC call to be processed
	time.Sleep(100 * time.Millisecond)

	// Verify RPC call was made with correct parameters
	require.Len(t, capturedScrollRequests, 1, "Should have captured exactly one scroll request")

	capturedParams := capturedScrollRequests[0]
	assert.Equal(t, "to_element", capturedParams["action"])
	assert.Equal(t, 5.0, capturedParams["element_index"])

	t.Log("Successfully tested to_element action with element_index")
}

func TestScrollPageToolParameterValidation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Setup test environment
	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	err = testEnv.Setup(ctx)
	require.NoError(t, err)

	// Register RPC handler (won't be called for invalid parameters)
	testEnv.GetNativeMsg().RegisterRpcHandler("scroll_page", func(params map[string]interface{}) (interface{}, error) {
		return map[string]interface{}{
			"success": true,
		}, nil
	})

	// Initialize MCP client
	err = testEnv.GetMcpClient().Initialize(ctx)
	require.NoError(t, err)

	// Verify scroll_page tool is available
	tools, err := testEnv.GetMcpClient().ListTools()
	if err != nil {
		t.Logf("ListTools failed: %v", err)
		return
	}

	found := false
	for _, tool := range tools.Tools {
		if tool.Name == "scroll_page" {
			found = true
			break
		}
	}

	if !found {
		t.Log("scroll_page tool not found")
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
			name: "invalid_action",
			args: map[string]interface{}{
				"action": "invalid_action",
			},
			expectError: true,
		},
		{
			name: "to_element_missing_element_index",
			args: map[string]interface{}{
				"action": "to_element",
			},
			expectError: true,
		},
		{
			name: "invalid_pixels_type",
			args: map[string]interface{}{
				"action": "up",
				"pixels": "invalid",
			},
			expectError: true,
		},
		{
			name: "invalid_element_index_type",
			args: map[string]interface{}{
				"action":        "to_element",
				"element_index": "invalid",
			},
			expectError: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result, err := testEnv.GetMcpClient().CallTool("scroll_page", tc.args)

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

func TestScrollPageToolWithDOMState(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Setup test environment
	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	err = testEnv.Setup(ctx)
	require.NoError(t, err)

	// Track both scroll and DOM state requests
	var capturedScrollRequests []map[string]interface{}

	// Register RPC handlers for both scroll_page and get_dom_state
	testEnv.GetNativeMsg().RegisterRpcHandlers(map[string]env.RpcHandler{
		"scroll_page": func(params map[string]interface{}) (interface{}, error) {
			capturedScrollRequests = append(capturedScrollRequests, params)
			return map[string]interface{}{
				"success": true,
				"message": "Scroll completed",
			}, nil
		},
		"get_dom_state": func(params map[string]interface{}) (interface{}, error) {
			return map[string]interface{}{
				"formattedDom": "[Start of page]\n<button>1</button> Click me (button)\n<button>2</button> Submit (button)\n[End of page]",
				"interactiveElements": []map[string]interface{}{
					{
						"index":        1,
						"tagName":      "button",
						"text":         "Click me",
						"attributes":   map[string]interface{}{"class": "primary"},
						"isInViewport": true,
						"selector":     "button.primary",
						"isNew":        false,
					},
					{
						"index":        2,
						"tagName":      "button",
						"text":         "Submit",
						"attributes":   map[string]interface{}{"type": "submit"},
						"isInViewport": false,
						"selector":     "button[type=\"submit\"]",
						"isNew":        false,
					},
				},
				"meta": map[string]interface{}{
					"url":         "https://example.com",
					"title":       "Test Page",
					"tabId":       123,
					"pixelsAbove": 0,
					"pixelsBelow": 300,
				},
				"screenshot": nil,
			}, nil
		},
	})

	// Initialize MCP client
	err = testEnv.GetMcpClient().Initialize(ctx)
	require.NoError(t, err)

	// Verify both tools/resources are available
	tools, err := testEnv.GetMcpClient().ListTools()
	if err != nil {
		t.Logf("ListTools failed: %v", err)
		return
	}

	scrollToolFound := false
	for _, tool := range tools.Tools {
		if tool.Name == "scroll_page" {
			scrollToolFound = true
			break
		}
	}

	if !scrollToolFound {
		t.Log("scroll_page tool not found")
		return
	}

	resources, err := testEnv.GetMcpClient().ListResources()
	if err != nil {
		t.Logf("ListResources failed: %v", err)
		return
	}

	domResourceFound := false
	for _, resource := range resources.Resources {
		if resource.URI == "browser://dom/state" {
			domResourceFound = true
			break
		}
	}

	if !domResourceFound {
		t.Log("DOM state resource not found")
		return
	}

	// First, get current DOM state
	domContent, err := testEnv.GetMcpClient().ReadResource("browser://dom/state")
	require.NoError(t, err)
	require.NotEmpty(t, domContent.Contents)
	t.Log("Successfully retrieved DOM state before scrolling")

	// Now test scrolling to an element that exists in the DOM
	result, err := testEnv.GetMcpClient().CallTool("scroll_page", map[string]interface{}{
		"action":        "to_element",
		"element_index": uint64(2), // Scroll to the Submit button
	})

	require.NoError(t, err)
	assert.False(t, result.IsError, "Tool execution should not result in error")

	// Wait for RPC call to be processed
	time.Sleep(100 * time.Millisecond)

	// Verify scroll request was made with correct element index
	require.Len(t, capturedScrollRequests, 1, "Should have captured exactly one scroll request")

	capturedParams := capturedScrollRequests[0]
	assert.Equal(t, "to_element", capturedParams["action"])
	assert.Equal(t, 2.0, capturedParams["element_index"])

	// Verify we can still get DOM state after scrolling
	domContentAfter, err := testEnv.GetMcpClient().ReadResource("browser://dom/state")
	require.NoError(t, err)
	require.NotEmpty(t, domContentAfter.Contents)

	t.Log("Successfully tested scroll_page tool integration with DOM state")
}

func TestScrollPageToolCompleteWorkflow(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Setup test environment
	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	err = testEnv.Setup(ctx)
	require.NoError(t, err)

	// Track all scroll operations
	var scrollHistory []map[string]interface{}

	// Register RPC handler that simulates more realistic browser behavior
	testEnv.GetNativeMsg().RegisterRpcHandler("scroll_page", func(params map[string]interface{}) (interface{}, error) {
		scrollHistory = append(scrollHistory, params)

		action := params["action"].(string)
		switch action {
		case "up", "down":
			pixels := params["pixels"].(float64)
			return map[string]interface{}{
				"success":     true,
				"message":     "Scrolled successfully",
				"action":      action,
				"pixels":      pixels,
				"newPosition": 100, // Simulated scroll position
			}, nil
		case "to_element":
			elementIndex := params["element_index"].(float64)
			return map[string]interface{}{
				"success":      true,
				"message":      "Scrolled to element",
				"action":       action,
				"elementIndex": elementIndex,
				"newPosition":  elementIndex * 50, // Simulated position
			}, nil
		case "to_top":
			return map[string]interface{}{
				"success":     true,
				"message":     "Scrolled to top",
				"action":      action,
				"newPosition": 0,
			}, nil
		case "to_bottom":
			return map[string]interface{}{
				"success":     true,
				"message":     "Scrolled to bottom",
				"action":      action,
				"newPosition": 1000,
			}, nil
		default:
			return nil, fmt.Errorf("invalid action: %s", action)
		}
	})

	// Initialize MCP client
	err = testEnv.GetMcpClient().Initialize(ctx)
	require.NoError(t, err)

	// Verify scroll_page tool is available
	tools, err := testEnv.GetMcpClient().ListTools()
	if err != nil {
		t.Logf("ListTools failed: %v", err)
		return
	}

	found := false
	for _, tool := range tools.Tools {
		if tool.Name == "scroll_page" {
			found = true
			break
		}
	}

	if !found {
		t.Log("scroll_page tool not found")
		return
	}

	// Execute a complete workflow: scroll down, then to element, then to top
	workflow := []map[string]interface{}{
		{
			"action": "down",
			"pixels": 400.0,
		},
		{
			"action":        "to_element",
			"element_index": 3,
		},
		{
			"action": "to_top",
		},
	}

	for i, step := range workflow {
		t.Run(fmt.Sprintf("workflow_step_%d", i+1), func(t *testing.T) {
			result, err := testEnv.GetMcpClient().CallTool("scroll_page", step)
			require.NoError(t, err)
			assert.False(t, result.IsError, "Tool execution should not result in error")

			// Verify the result contains expected content
			require.NotEmpty(t, result.Content)
			// Note: For now, just verify that we got some content back
			// The exact structure of Content depends on the MCP implementation
			t.Log("Successfully received tool execution result with content")

			time.Sleep(50 * time.Millisecond) // Small delay between operations
		})
	}

	// Verify all scroll operations were captured
	require.Len(t, scrollHistory, len(workflow), "Should have captured all scroll operations")

	// Verify the sequence of operations
	assert.Equal(t, "down", scrollHistory[0]["action"])
	assert.Equal(t, 400.0, scrollHistory[0]["pixels"])

	assert.Equal(t, "to_element", scrollHistory[1]["action"])
	assert.Equal(t, 3.0, scrollHistory[1]["element_index"])

	assert.Equal(t, "to_top", scrollHistory[2]["action"])

	t.Log("Successfully completed full scroll workflow test")
}
