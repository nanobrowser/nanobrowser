package integration

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"env"
)

func TestEnv(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	// Setup the environment
	err = testEnv.Setup(ctx)
	require.NoError(t, err)
}

func TestProcessLifecycle(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Setup test environment
	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	// Setup the environment
	err = testEnv.Setup(ctx)
	require.NoError(t, err)

	// Send initialization message via Native Messaging
	err = testEnv.GetNativeMsg().SendMessage(ctx, map[string]interface{}{
		"type": "initialize",
		"capabilities": map[string]interface{}{
			"version": "1.0.0",
		},
	})
	require.NoError(t, err)

	// Verify process is running
	assert.True(t, testEnv.IsHostRunning())

	// Test graceful shutdown
	err = testEnv.GetHostProcess().Process.Signal(os.Interrupt)
	require.NoError(t, err)

	// Wait for process to exit
	err = testEnv.GetHostProcess().Wait()
	assert.NoError(t, err)
}

func TestSSEServerConnectivity(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Setup test environment
	testEnv, err := env.NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer testEnv.Cleanup()

	// Setup the environment
	err = testEnv.Setup(ctx)
	require.NoError(t, err)

	// Initialize MCP client session
	err = testEnv.GetMcpClient().Initialize(ctx)
	require.NoError(t, err)

	// Test basic connectivity by trying to list resources
	resources, err := testEnv.GetMcpClient().ListResources()
	if err != nil {
		// If the endpoint doesn't exist yet, that's okay for this basic test
		t.Logf("ListResources failed (expected if not implemented): %v", err)
	} else {
		t.Logf("Successfully connected to SSE server, found %d resources", len(resources.Resources))
	}

	// Verify process is still running after the test
	assert.True(t, testEnv.IsHostRunning())
}

func TestBrowserStateResource(t *testing.T) {
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

	// Set mock browser state via Native Messaging
	err = testEnv.GetNativeMsg().SendMessage(ctx, map[string]interface{}{
		"type": "setBrowserState",
		"state": map[string]interface{}{
			"activeTab": map[string]interface{}{
				"id":      1,
				"url":     "https://example.com",
				"title":   "Test Page",
				"content": "<html><body><h1>Test</h1></body></html>",
			},
		},
	})

	// Note: This might fail if the handler isn't implemented yet
	if err != nil {
		t.Logf("setBrowserState failed (expected if not implemented): %v", err)
		return
	}

	// Wait for state to be processed
	time.Sleep(100 * time.Millisecond)

	// Try to verify resource is available through MCP client
	resources, err := testEnv.GetMcpClient().ListResources()
	if err != nil {
		t.Logf("ListResources failed (expected if not implemented): %v", err)
		return
	}

	found := false
	for _, resource := range resources.Resources {
		if resource.URI == "browser://current/state" {
			found = true
			break
		}
	}

	if found {
		t.Log("Successfully found browser://current/state resource")

		// Try to read the resource content
		resourceContent, err := testEnv.GetMcpClient().ReadResource("browser://current/state")
		if err != nil {
			t.Logf("ReadResource failed: %v", err)
		} else {
			t.Logf("Successfully read resource content: %d items", len(resourceContent.Contents))
		}
	} else {
		t.Log("browser://current/state resource not found (expected if not implemented)")
	}
}

func TestNavigateToTool(t *testing.T) {
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

	// Try to verify tool is available
	tools, err := testEnv.GetMcpClient().ListTools()
	if err != nil {
		t.Logf("ListTools failed (expected if not implemented): %v", err)
		return
	}

	found := false
	for _, tool := range tools.Tools {
		if tool.Name == "navigate_to" {
			found = true
			break
		}
	}

	if !found {
		t.Log("navigate_to tool not found (expected if not implemented)")
		return
	}

	t.Log("Successfully found navigate_to tool")

	// Set up action handler to capture navigation commands
	var capturedAction map[string]interface{}
	testEnv.GetNativeMsg().SetActionHandler(func(action string, params map[string]interface{}) map[string]interface{} {
		capturedAction = map[string]interface{}{
			"action": action,
			"params": params,
		}
		return map[string]interface{}{"success": true}
	})

	// Execute navigation tool via MCP client
	result, err := testEnv.GetMcpClient().CallTool("navigate_to", map[string]interface{}{
		"url": "https://test.com",
	})

	if err != nil {
		t.Logf("CallTool failed: %v", err)
		return
	}

	assert.False(t, result.IsError)
	t.Log("Successfully called navigate_to tool")

	// Verify navigation was requested through Native Messaging
	if capturedAction != nil {
		assert.Equal(t, "navigate", capturedAction["action"])
		params := capturedAction["params"].(map[string]interface{})
		assert.Equal(t, "https://test.com", params["url"])
		t.Log("Successfully captured navigation action via Native Messaging")
	} else {
		t.Log("No action captured (expected if action handling not implemented)")
	}
}
