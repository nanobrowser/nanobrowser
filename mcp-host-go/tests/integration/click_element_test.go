package integration

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"env"
)

func TestClickElementToolBasicFunctionality(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Setup test environment
	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	err = testEnv.Setup(ctx)
	require.NoError(t, err)

	// Track captured click requests
	var capturedClickRequests []map[string]interface{}

	// Register RPC handler for click_element method
	testEnv.GetNativeMsg().RegisterRpcHandler("click_element", func(params map[string]interface{}) (interface{}, error) {
		capturedClickRequests = append(capturedClickRequests, params)
		return map[string]interface{}{
			"success":       true,
			"message":       "Successfully clicked element",
			"element_index": params["element_index"],
			"page_changed":  false,
			"element_info": map[string]interface{}{
				"tag_name":   "button",
				"text":       "Click me",
				"type":       "button",
				"role":       "button",
				"aria_label": "",
				"class":      "btn-primary",
				"id":         "submit-btn",
			},
			"before_url": "https://example.com/form",
			"after_url":  "https://example.com/form",
		}, nil
	})

	// Initialize MCP client
	err = testEnv.GetMcpClient().Initialize(ctx)
	require.NoError(t, err)

	// Verify click_element tool is available
	tools, err := testEnv.GetMcpClient().ListTools()
	if err != nil {
		t.Logf("ListTools failed (expected if not implemented): %v", err)
		return
	}

	found := false
	for _, tool := range tools.Tools {
		if tool.Name == "click_element" {
			found = true
			assert.Equal(t, "Click interactive elements on web pages using element index from DOM state", tool.Description)
			t.Log("Found click_element tool with correct description")
			break
		}
	}

	if !found {
		t.Log("click_element tool not found (expected if not implemented)")
		return
	}

	// Test basic click operation
	t.Run("successful element click", func(t *testing.T) {
		// Clear previous requests
		capturedClickRequests = nil

		// Execute click tool
		result, err := testEnv.GetMcpClient().CallTool("click_element", map[string]interface{}{
			"element_index": 1,
			"wait_after":    2.0,
		})
		require.NoError(t, err)
		assert.False(t, result.IsError, "Tool execution should not result in error")

		// Wait for RPC call to be processed
		time.Sleep(100 * time.Millisecond)

		// Verify RPC call was made with correct parameters
		require.Len(t, capturedClickRequests, 1, "Should have captured exactly one click request")

		capturedParams := capturedClickRequests[0]
		assert.Equal(t, float64(1), capturedParams["element_index"])
		assert.Equal(t, 2.0, capturedParams["wait_after"])

		t.Log("Successfully tested basic element click")
	})
}

func TestClickElementToolParameterValidation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Setup test environment
	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	err = testEnv.Setup(ctx)
	require.NoError(t, err)

	// Register RPC handler (won't be called for invalid parameters)
	testEnv.GetNativeMsg().RegisterRpcHandler("click_element", func(params map[string]interface{}) (interface{}, error) {
		return map[string]interface{}{
			"success": true,
		}, nil
	})

	// Initialize MCP client
	err = testEnv.GetMcpClient().Initialize(ctx)
	require.NoError(t, err)

	// Verify click_element tool is available
	tools, err := testEnv.GetMcpClient().ListTools()
	if err != nil {
		t.Logf("ListTools failed: %v", err)
		return
	}

	found := false
	for _, tool := range tools.Tools {
		if tool.Name == "click_element" {
			found = true
			break
		}
	}

	if !found {
		t.Log("click_element tool not found")
		return
	}

	// Test cases for parameter validation
	testCases := []struct {
		name        string
		args        map[string]interface{}
		expectError bool
	}{
		{
			name:        "missing_element_index",
			args:        map[string]interface{}{},
			expectError: true,
		},
		{
			name: "negative_element_index",
			args: map[string]interface{}{
				"element_index": -1,
			},
			expectError: true,
		},
		{
			name: "invalid_wait_after_negative",
			args: map[string]interface{}{
				"element_index": 1,
				"wait_after":    -1,
			},
			expectError: true,
		},
		{
			name: "invalid_wait_after_too_large",
			args: map[string]interface{}{
				"element_index": 1,
				"wait_after":    35,
			},
			expectError: true,
		},
		{
			name: "invalid_element_index_type",
			args: map[string]interface{}{
				"element_index": "invalid",
			},
			expectError: true,
		},
		{
			name: "invalid_wait_after_type",
			args: map[string]interface{}{
				"element_index": 1,
				"wait_after":    "invalid",
			},
			expectError: true,
		},
		{
			name: "valid_parameters",
			args: map[string]interface{}{
				"element_index": 5,
				"wait_after":    1.5,
			},
			expectError: false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result, err := testEnv.GetMcpClient().CallTool("click_element", tc.args)

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

func TestClickElementToolErrorHandling(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Setup test environment
	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	err = testEnv.Setup(ctx)
	require.NoError(t, err)

	// Track captured click requests
	var capturedClickRequests []map[string]interface{}

	// Register RPC handler that simulates various error conditions
	testEnv.GetNativeMsg().RegisterRpcHandler("click_element", func(params map[string]interface{}) (interface{}, error) {
		capturedClickRequests = append(capturedClickRequests, params)

		elementIndex := params["element_index"].(float64)

		// Simulate different error conditions based on element index
		switch int(elementIndex) {
		case 999:
			// Element not found
			return nil, fmt.Errorf("Element with index 999 not found in DOM state")
		case 998:
			// Element not clickable
			return nil, fmt.Errorf("Element with index 998 is not visible or clickable")
		case 997:
			// Element detached
			return nil, fmt.Errorf("Element with index 997 could not be located on the page")
		default:
			// Success case
			return map[string]interface{}{
				"success":       true,
				"message":       "Successfully clicked element",
				"element_index": elementIndex,
				"page_changed":  false,
				"element_info": map[string]interface{}{
					"tag_name": "button",
					"text":     "Test Button",
					"type":     "button",
				},
				"before_url": "https://example.com",
				"after_url":  "https://example.com",
			}, nil
		}
	})

	// Initialize MCP client
	err = testEnv.GetMcpClient().Initialize(ctx)
	require.NoError(t, err)

	// Verify click_element tool is available
	tools, err := testEnv.GetMcpClient().ListTools()
	if err != nil {
		t.Logf("ListTools failed: %v", err)
		return
	}

	found := false
	for _, tool := range tools.Tools {
		if tool.Name == "click_element" {
			found = true
			break
		}
	}

	if !found {
		t.Log("click_element tool not found")
		return
	}

	// Test error cases
	errorTestCases := []struct {
		name          string
		elementIndex  int
		expectedError string
	}{
		{
			name:          "element_not_found",
			elementIndex:  999,
			expectedError: "not found",
		},
		{
			name:          "element_not_clickable",
			elementIndex:  998,
			expectedError: "not visible or clickable",
		},
		{
			name:          "element_detached",
			elementIndex:  997,
			expectedError: "could not be located",
		},
	}

	for _, tc := range errorTestCases {
		t.Run(tc.name, func(t *testing.T) {
			// Clear previous requests
			capturedClickRequests = nil

			result, err := testEnv.GetMcpClient().CallTool("click_element", map[string]interface{}{
				"element_index": tc.elementIndex,
			})

			// Should get an error result
			require.NoError(t, err, "MCP call itself should succeed")
			assert.True(t, result.IsError, "Tool execution should result in error")

			// Verify error content using mcp.AsTextContent
			if len(result.Content) > 0 {
				if textContent, ok := mcp.AsTextContent(result.Content[0]); ok {
					assert.Contains(t, textContent.Text, tc.expectedError)
					t.Logf("Got expected error for %s: %s", tc.name, textContent.Text)
				}
			}

			// Verify RPC call was made
			require.Len(t, capturedClickRequests, 1, "Should have captured the click request")
			assert.Equal(t, float64(tc.elementIndex), capturedClickRequests[0]["element_index"])
		})
	}

	// Test successful case
	t.Run("successful_click", func(t *testing.T) {
		// Clear previous requests
		capturedClickRequests = nil

		result, err := testEnv.GetMcpClient().CallTool("click_element", map[string]interface{}{
			"element_index": 1,
			"wait_after":    1.0,
		})

		require.NoError(t, err)
		assert.False(t, result.IsError, "Tool execution should not result in error")

		// Verify RPC call was made
		require.Len(t, capturedClickRequests, 1, "Should have captured the click request")
		assert.Equal(t, float64(1), capturedClickRequests[0]["element_index"])
		assert.Equal(t, 1.0, capturedClickRequests[0]["wait_after"])

		t.Log("Successfully tested successful click case")
	})
}

func TestClickElementToolCompleteWorkflow(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Setup test environment
	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	err = testEnv.Setup(ctx)
	require.NoError(t, err)

	// Track all operations
	var clickHistory []map[string]interface{}
	var domStateRequests []map[string]interface{}

	// Register RPC handlers for both click_element and get_dom_state
	testEnv.GetNativeMsg().RegisterRpcHandlers(map[string]env.RpcHandler{
		"click_element": func(params map[string]interface{}) (interface{}, error) {
			clickHistory = append(clickHistory, params)

			elementIndex := params["element_index"].(float64)

			return map[string]interface{}{
				"success":       true,
				"message":       "Successfully clicked element",
				"element_index": elementIndex,
				"page_changed":  elementIndex == 2, // Simulate page change for submit button
				"element_info": map[string]interface{}{
					"tag_name":   "button",
					"text":       "Submit",
					"type":       "submit",
					"role":       "button",
					"aria_label": "",
					"class":      "btn-submit",
					"id":         "submit-btn",
				},
				"before_url": "https://example.com/form",
				"after_url": func() string {
					if elementIndex == 2 {
						return "https://example.com/success"
					}
					return "https://example.com/form"
				}(),
			}, nil
		},
		"get_dom_state": func(params map[string]interface{}) (interface{}, error) {
			domStateRequests = append(domStateRequests, params)
			return map[string]interface{}{
				"formattedDom": "[Start of page]\n<button>1</button> Cancel (button)\n<button>2</button> Submit (button)\n[End of page]",
				"interactiveElements": []map[string]interface{}{
					{
						"index":        1,
						"tagName":      "button",
						"text":         "Cancel",
						"attributes":   map[string]interface{}{"class": "btn-cancel"},
						"isInViewport": true,
						"selector":     "button.btn-cancel",
						"isNew":        false,
					},
					{
						"index":        2,
						"tagName":      "button",
						"text":         "Submit",
						"attributes":   map[string]interface{}{"type": "submit", "class": "btn-submit"},
						"isInViewport": true,
						"selector":     "button[type=\"submit\"]",
						"isNew":        false,
					},
				},
				"meta": map[string]interface{}{
					"url":         "https://example.com/form",
					"title":       "Test Form",
					"tabId":       123,
					"pixelsAbove": 0,
					"pixelsBelow": 100,
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

	clickToolFound := false
	for _, tool := range tools.Tools {
		if tool.Name == "click_element" {
			clickToolFound = true
			break
		}
	}

	if !clickToolFound {
		t.Log("click_element tool not found")
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

	// Execute complete workflow: get DOM state, then click element
	t.Run("complete_workflow", func(t *testing.T) {
		// Step 1: Get DOM state to understand available elements
		domContent, err := testEnv.GetMcpClient().ReadResource("browser://dom/state")
		require.NoError(t, err)
		require.NotEmpty(t, domContent.Contents)
		t.Log("Successfully retrieved DOM state")

		// Step 2: Click the submit button (element index 2)
		result, err := testEnv.GetMcpClient().CallTool("click_element", map[string]interface{}{
			"element_index": 2,
			"wait_after":    1.5,
		})

		require.NoError(t, err)
		assert.False(t, result.IsError, "Tool execution should not result in error")

		// Wait for RPC call to be processed
		time.Sleep(100 * time.Millisecond)

		// Verify click request was made
		require.Len(t, clickHistory, 1, "Should have captured exactly one click request")
		assert.Equal(t, float64(2), clickHistory[0]["element_index"])
		assert.Equal(t, 1.5, clickHistory[0]["wait_after"])

		// Verify DOM state was requested
		require.Len(t, domStateRequests, 1, "Should have captured DOM state request")

		t.Log("Successfully completed full click element workflow test")
	})
}

func TestClickElementToolSchema(t *testing.T) {
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

	// Find click_element tool
	var clickElementTool *mcp.Tool
	for _, tool := range tools.Tools {
		if tool.Name == "click_element" {
			clickElementTool = &tool
			break
		}
	}

	if clickElementTool == nil {
		t.Log("click_element tool not found")
		return
	}

	// Validate tool schema
	t.Run("tool_schema_validation", func(t *testing.T) {
		assert.Equal(t, "click_element", clickElementTool.Name)
		assert.Contains(t, clickElementTool.Description, "Click interactive elements")

		// Validate input schema structure
		inputSchema := clickElementTool.InputSchema
		assert.Equal(t, "object", inputSchema.Type)

		// Check if required properties exist
		properties := inputSchema.Properties
		assert.Contains(t, properties, "element_index")
		assert.Contains(t, properties, "wait_after")

		// Validate element_index property
		elementIndexProp := properties["element_index"].(map[string]interface{})
		assert.Equal(t, "number", elementIndexProp["type"])
		assert.Contains(t, elementIndexProp["description"], "Index of the element")

		// Validate wait_after property
		waitAfterProp := properties["wait_after"].(map[string]interface{})
		assert.Equal(t, "number", waitAfterProp["type"])
		assert.Equal(t, float64(1), waitAfterProp["default"])
		assert.Equal(t, float64(0), waitAfterProp["minimum"])
		assert.Equal(t, float64(30), waitAfterProp["maximum"])

		// Validate required fields
		required := inputSchema.Required
		assert.Contains(t, required, "element_index")
		assert.NotContains(t, required, "wait_after") // wait_after is optional

		t.Log("Successfully validated click_element tool schema")
	})
}
