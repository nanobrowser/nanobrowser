package integration

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"env"
)

func TestCurrentStateMarkdownFormat(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Setup test environment
	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	err = testEnv.Setup(ctx)
	require.NoError(t, err)

	// Initialize MCP client session
	err = testEnv.GetMcpClient().Initialize(ctx)
	require.NoError(t, err)

	// Register RPC handler to simulate browser extension behavior
	testEnv.GetNativeMsg().RegisterRpcHandlers(map[string]env.RpcHandler{
		"get_browser_state": func(params map[string]interface{}) (interface{}, error) {
			return map[string]interface{}{
				"activeTab": map[string]interface{}{
					"id": 123,
				},
				"tabs": []map[string]interface{}{
					{
						"id":     123,
						"url":    "https://example.com",
						"title":  "Test Page",
						"active": true,
					},
					{
						"id":     124,
						"url":    "https://github.com",
						"title":  "GitHub",
						"active": false,
					},
				},
			}, nil
		},
	})

	// Read the current state resource
	resourceContent, err := testEnv.GetMcpClient().ReadResource("browser://current/state")
	require.NoError(t, err)
	require.NotEmpty(t, resourceContent.Contents)

	content := resourceContent.Contents[0]

	// Type assert to TextResourceContents
	textContent, ok := content.(mcp.TextResourceContents)
	require.True(t, ok, "Expected TextResourceContents")

	// Verify MIME type is markdown
	assert.Equal(t, "text/markdown", textContent.MIMEType)

	// Verify URI
	assert.Equal(t, "browser://current/state", textContent.URI)

	markdownContent := textContent.Text
	t.Logf("Received markdown content:\n%s", markdownContent)

	// Verify markdown structure and content
	assert.Contains(t, markdownContent, "# Browser State")
	assert.Contains(t, markdownContent, "## Active Tab")
	assert.Contains(t, markdownContent, "## Browser Tabs")
	assert.Contains(t, markdownContent, "## Summary")

	// Verify active tab information
	assert.Contains(t, markdownContent, "**Id:** 123")

	// Verify tab information
	assert.Contains(t, markdownContent, "### Tab 1")
	assert.Contains(t, markdownContent, "### Tab 2")
	assert.Contains(t, markdownContent, "**URL:** https://example.com")
	assert.Contains(t, markdownContent, "**Title:** Test Page")
	assert.Contains(t, markdownContent, "**URL:** https://github.com")
	assert.Contains(t, markdownContent, "**Title:** GitHub")

	// Verify active status indicators
	assert.Contains(t, markdownContent, "🟢 Currently Active")
	assert.Contains(t, markdownContent, "⚪ Background Tab")

	// Verify summary statistics
	assert.Contains(t, markdownContent, "**Total Browser Tabs:** 2")
	assert.Contains(t, markdownContent, "**Active Tabs:** 1")
	assert.Contains(t, markdownContent, "**Background Tabs:** 1")

	// Verify markdown formatting
	lines := strings.Split(markdownContent, "\n")
	var foundHeaders []string
	for _, line := range lines {
		if strings.HasPrefix(line, "#") {
			foundHeaders = append(foundHeaders, line)
		}
	}

	// Should have proper header hierarchy
	assert.Contains(t, foundHeaders, "# Browser State")
	assert.Contains(t, foundHeaders, "## Active Tab")
	assert.Contains(t, foundHeaders, "## Browser Tabs")
	assert.Contains(t, foundHeaders, "## Summary")
	assert.Contains(t, foundHeaders, "### Tab 1")
	assert.Contains(t, foundHeaders, "### Tab 2")

	t.Log("Successfully verified markdown format for browser state resource")
}

func TestCurrentStateEmptyTabs(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Setup test environment
	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	err = testEnv.Setup(ctx)
	require.NoError(t, err)

	// Initialize MCP client session
	err = testEnv.GetMcpClient().Initialize(ctx)
	require.NoError(t, err)

	// Register RPC handler with empty tabs
	testEnv.GetNativeMsg().RegisterRpcHandlers(map[string]env.RpcHandler{
		"get_browser_state": func(params map[string]interface{}) (interface{}, error) {
			return map[string]interface{}{
				"activeTab": nil,
				"tabs":      []map[string]interface{}{},
			}, nil
		},
	})

	// Read the current state resource
	resourceContent, err := testEnv.GetMcpClient().ReadResource("browser://current/state")
	require.NoError(t, err)
	require.NotEmpty(t, resourceContent.Contents)

	// Type assert to TextResourceContents
	textContent, ok := resourceContent.Contents[0].(mcp.TextResourceContents)
	require.True(t, ok, "Expected TextResourceContents")

	markdownContent := textContent.Text
	t.Logf("Received markdown content for empty state:\n%s", markdownContent)

	// Verify it handles empty state gracefully
	assert.Contains(t, markdownContent, "# Browser State")
	assert.Contains(t, markdownContent, "*No active tab information available*")
	assert.Contains(t, markdownContent, "*No tabs found.*")
	assert.Contains(t, markdownContent, "**Total Browser Tabs:** 0")
	assert.Contains(t, markdownContent, "**Active Tabs:** 0")
	assert.Contains(t, markdownContent, "**Background Tabs:** 0")

	t.Log("Successfully verified empty state handling in markdown format")
}
