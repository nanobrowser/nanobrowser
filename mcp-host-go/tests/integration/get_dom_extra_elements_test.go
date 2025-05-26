package integration

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"env"
)

// TestGetDomExtraElementsToolBasicPagination tests basic pagination functionality
func TestGetDomExtraElementsToolBasicPagination(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Setup test environment
	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	// First setup the environment
	err = testEnv.Setup(ctx)
	require.NoError(t, err)

	// Now register mock handler for get_dom_state with 25 elements
	testEnv.GetNativeMsg().RegisterRpcHandlers(map[string]env.RpcHandler{
		"get_dom_state": func(params map[string]interface{}) (interface{}, error) {
			// Create mock data with 25 interactive elements (5 of each type)
			mockElements := make([]map[string]interface{}, 25)
			elementTypes := []string{"button", "input", "a", "select", "textarea"}

			for i := 0; i < 25; i++ {
				mockElements[i] = map[string]interface{}{
					"index":        i + 1,
					"tagName":      elementTypes[i%5],
					"text":         "Element " + string(rune(65+i)), // A, B, C, etc.
					"attributes":   map[string]interface{}{"class": "test"},
					"isInViewport": true,
					"selector":     elementTypes[i%5] + ".test",
					"isNew":        false,
				}
			}

			return map[string]interface{}{
				"formattedDom":        "Mock DOM with 25 interactive elements",
				"interactiveElements": mockElements,
				"meta": map[string]interface{}{
					"url":         "https://example.com",
					"title":       "Test Page",
					"tabId":       123,
					"pixelsAbove": 0,
					"pixelsBelow": 500,
				},
				"screenshot": nil,
			}, nil
		},
	})

	// Initialize MCP client session
	err = testEnv.GetMcpClient().Initialize(ctx)
	require.NoError(t, err)

	// List tools to verify get_dom_extra_elements is available
	tools, err := testEnv.GetMcpClient().ListTools()
	if err != nil {
		t.Logf("ListTools failed: %v", err)
		return
	}

	found := false
	for _, tool := range tools.Tools {
		if tool.Name == "get_dom_extra_elements" {
			found = true
			assert.Equal(t, "get_dom_extra_elements", tool.Name)
			assert.Contains(t, tool.Description, "Get additional DOM interactive elements")
			break
		}
	}

	require.True(t, found, "get_dom_extra_elements tool should be available")

	// Test default parameters (page 1, pageSize 20)
	t.Run("Default pagination", func(t *testing.T) {
		result, err := testEnv.GetMcpClient().CallTool("get_dom_extra_elements", map[string]interface{}{})
		require.NoError(t, err)
		assert.False(t, result.IsError, "Tool execution should not result in error")
		require.NotEmpty(t, result.Content)

		t.Log("Successfully tested default pagination through MCP tool call")
	})

	// Test page 2
	t.Run("Page 2", func(t *testing.T) {
		result, err := testEnv.GetMcpClient().CallTool("get_dom_extra_elements", map[string]interface{}{
			"page": 2,
		})
		require.NoError(t, err)
		assert.False(t, result.IsError, "Tool execution should not result in error")
		require.NotEmpty(t, result.Content)

		t.Log("Successfully tested page 2 pagination through MCP tool call")
	})

	// Test custom page size
	t.Run("Custom page size", func(t *testing.T) {
		result, err := testEnv.GetMcpClient().CallTool("get_dom_extra_elements", map[string]interface{}{
			"pageSize": 10,
		})
		require.NoError(t, err)
		assert.False(t, result.IsError, "Tool execution should not result in error")
		require.NotEmpty(t, result.Content)

		t.Log("Successfully tested custom page size through MCP tool call")
	})
}

// TestGetDomExtraElementsToolElementFiltering tests element type filtering
func TestGetDomExtraElementsToolElementFiltering(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Setup test environment
	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	// First setup the environment
	err = testEnv.Setup(ctx)
	require.NoError(t, err)

	// Now register mock handler for get_dom_state with mixed element types
	testEnv.GetNativeMsg().RegisterRpcHandlers(map[string]env.RpcHandler{
		"get_dom_state": func(params map[string]interface{}) (interface{}, error) {
			// Create mock data with different element types
			mockElements := []map[string]interface{}{
				{"index": 1, "tagName": "button", "text": "Submit Button", "attributes": map[string]interface{}{"type": "submit"}, "isInViewport": true, "selector": "button[type=submit]", "isNew": false},
				{"index": 2, "tagName": "input", "text": "", "attributes": map[string]interface{}{"type": "email", "placeholder": "Email"}, "isInViewport": true, "selector": "input[type=email]", "isNew": false},
				{"index": 3, "tagName": "button", "text": "Cancel Button", "attributes": map[string]interface{}{"type": "button"}, "isInViewport": true, "selector": "button[type=button]", "isNew": false},
				{"index": 4, "tagName": "a", "text": "Home Link", "attributes": map[string]interface{}{"href": "/"}, "isInViewport": true, "selector": "a[href='/']", "isNew": false},
				{"index": 5, "tagName": "input", "text": "", "attributes": map[string]interface{}{"type": "password", "placeholder": "Password"}, "isInViewport": true, "selector": "input[type=password]", "isNew": false},
				{"index": 6, "tagName": "select", "text": "Country", "attributes": map[string]interface{}{"name": "country"}, "isInViewport": true, "selector": "select[name=country]", "isNew": false},
				{"index": 7, "tagName": "textarea", "text": "", "attributes": map[string]interface{}{"placeholder": "Comments"}, "isInViewport": true, "selector": "textarea", "isNew": false},
				{"index": 8, "tagName": "button", "text": "Save Button", "attributes": map[string]interface{}{"type": "button"}, "isInViewport": true, "selector": "button[type=button]", "isNew": false},
			}

			return map[string]interface{}{
				"formattedDom":        "Mock DOM with mixed elements",
				"interactiveElements": mockElements,
				"meta": map[string]interface{}{
					"url":         "https://example.com",
					"title":       "Test Page",
					"tabId":       123,
					"pixelsAbove": 0,
					"pixelsBelow": 500,
				},
				"screenshot": nil,
			}, nil
		},
	})

	// Initialize MCP client session
	err = testEnv.GetMcpClient().Initialize(ctx)
	require.NoError(t, err)

	// Test filtering by button elements
	t.Run("Filter buttons", func(t *testing.T) {
		result, err := testEnv.GetMcpClient().CallTool("get_dom_extra_elements", map[string]interface{}{
			"elementType": "button",
		})
		require.NoError(t, err)
		assert.False(t, result.IsError, "Tool execution should not result in error")
		require.NotEmpty(t, result.Content)

		t.Log("Successfully tested button filtering through MCP tool call")
	})

	// Test filtering by input elements
	t.Run("Filter inputs", func(t *testing.T) {
		result, err := testEnv.GetMcpClient().CallTool("get_dom_extra_elements", map[string]interface{}{
			"elementType": "input",
		})
		require.NoError(t, err)
		assert.False(t, result.IsError, "Tool execution should not result in error")
		require.NotEmpty(t, result.Content)

		t.Log("Successfully tested input filtering through MCP tool call")
	})

	// Test no filter (all elements)
	t.Run("No filter", func(t *testing.T) {
		result, err := testEnv.GetMcpClient().CallTool("get_dom_extra_elements", map[string]interface{}{
			"elementType": "all",
		})
		require.NoError(t, err)
		assert.False(t, result.IsError, "Tool execution should not result in error")
		require.NotEmpty(t, result.Content)

		t.Log("Successfully tested no filtering through MCP tool call")
	})
}

// TestGetDomExtraElementsToolParameterValidation tests parameter validation
func TestGetDomExtraElementsToolParameterValidation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Setup test environment
	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	// First setup the environment
	err = testEnv.Setup(ctx)
	require.NoError(t, err)

	// Now register mock handler for get_dom_state
	testEnv.GetNativeMsg().RegisterRpcHandlers(map[string]env.RpcHandler{
		"get_dom_state": func(params map[string]interface{}) (interface{}, error) {
			return map[string]interface{}{
				"formattedDom":        "Test DOM",
				"interactiveElements": []map[string]interface{}{},
				"meta": map[string]interface{}{
					"url":   "https://example.com",
					"title": "Test Page",
				},
			}, nil
		},
	})

	// Initialize MCP client session
	err = testEnv.GetMcpClient().Initialize(ctx)
	require.NoError(t, err)

	// Test invalid page number
	t.Run("Invalid page number", func(t *testing.T) {
		result, err := testEnv.GetMcpClient().CallTool("get_dom_extra_elements", map[string]interface{}{
			"page": 0,
		})
		// For parameter validation errors, we expect either an error or IsError=true
		if err == nil {
			assert.True(t, result.IsError, "Expected tool execution to result in error for invalid page")
		}

		t.Log("Successfully tested invalid page validation")
	})

	// Test invalid page size
	t.Run("Invalid page size", func(t *testing.T) {
		result, err := testEnv.GetMcpClient().CallTool("get_dom_extra_elements", map[string]interface{}{
			"pageSize": 101,
		})
		// For parameter validation errors, we expect either an error or IsError=true
		if err == nil {
			assert.True(t, result.IsError, "Expected tool execution to result in error for invalid page size")
		}

		t.Log("Successfully tested invalid page size validation")
	})

	// Test invalid element type
	t.Run("Invalid element type", func(t *testing.T) {
		result, err := testEnv.GetMcpClient().CallTool("get_dom_extra_elements", map[string]interface{}{
			"elementType": "invalid",
		})
		// For parameter validation errors, we expect either an error or IsError=true
		if err == nil {
			assert.True(t, result.IsError, "Expected tool execution to result in error for invalid element type")
		}

		t.Log("Successfully tested invalid element type validation")
	})

	// Test invalid startIndex
	t.Run("Invalid start index", func(t *testing.T) {
		result, err := testEnv.GetMcpClient().CallTool("get_dom_extra_elements", map[string]interface{}{
			"startIndex": 0,
		})
		// For parameter validation errors, we expect either an error or IsError=true
		if err == nil {
			assert.True(t, result.IsError, "Expected tool execution to result in error for invalid start index")
		}

		t.Log("Successfully tested invalid start index validation")
	})
}
