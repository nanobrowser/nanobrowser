package env

import (
	"context"
	"fmt"
	"time"

	"github.com/mark3labs/mcp-go/client"
	"github.com/mark3labs/mcp-go/mcp"
)

// McpSSEClient wraps the real MCP client from mark3labs/mcp-go
type McpSSEClient struct {
	baseURL   string
	client    *client.Client
	connected bool
}

func NewMcpSSEClient(baseURL string) *McpSSEClient {
	return &McpSSEClient{
		baseURL:   baseURL,
		connected: false,
	}
}

func (c *McpSSEClient) Connect() error {
	if c.connected {
		return nil
	}

	// Create SSE client using mark3labs/mcp-go
	mcpClient, err := client.NewSSEMCPClient(c.baseURL)
	if err != nil {
		return fmt.Errorf("failed to create SSE MCP client: %w", err)
	}

	c.client = mcpClient
	c.connected = true
	return nil
}

func (c *McpSSEClient) Initialize(ctx context.Context) error {
	if err := c.Connect(); err != nil {
		return err
	}

	// Start the transport first
	if err := c.client.Start(ctx); err != nil {
		return fmt.Errorf("failed to start MCP client transport: %w", err)
	}

	// Initialize the MCP session
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	_, err := c.client.Initialize(ctx, mcp.InitializeRequest{
		Params: struct {
			ProtocolVersion string                 `json:"protocolVersion"`
			Capabilities    mcp.ClientCapabilities `json:"capabilities"`
			ClientInfo      mcp.Implementation     `json:"clientInfo"`
		}{
			ProtocolVersion: "2024-11-05",
			ClientInfo: mcp.Implementation{
				Name:    "mcp-host-test-client",
				Version: "1.0.0",
			},
			Capabilities: mcp.ClientCapabilities{},
		},
	})

	if err != nil {
		return fmt.Errorf("failed to initialize MCP client: %w", err)
	}

	return nil
}

func (c *McpSSEClient) ListResources() (*mcp.ListResourcesResult, error) {
	if !c.connected {
		return nil, fmt.Errorf("not connected")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	result, err := c.client.ListResources(ctx, mcp.ListResourcesRequest{})
	if err != nil {
		return nil, fmt.Errorf("failed to list resources: %w", err)
	}

	return result, nil
}

func (c *McpSSEClient) ReadResource(uri string) (*mcp.ReadResourceResult, error) {
	if !c.connected {
		return nil, fmt.Errorf("not connected")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	result, err := c.client.ReadResource(ctx, mcp.ReadResourceRequest{
		Params: struct {
			URI       string         `json:"uri"`
			Arguments map[string]any `json:"arguments,omitempty"`
		}{
			URI: uri,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to read resource: %w", err)
	}

	return result, nil
}

func (c *McpSSEClient) ListTools() (*mcp.ListToolsResult, error) {
	if !c.connected {
		return nil, fmt.Errorf("not connected")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	result, err := c.client.ListTools(ctx, mcp.ListToolsRequest{})
	if err != nil {
		return nil, fmt.Errorf("failed to list tools: %w", err)
	}

	return result, nil
}

func (c *McpSSEClient) CallTool(name string, arguments map[string]interface{}) (*mcp.CallToolResult, error) {
	if !c.connected {
		return nil, fmt.Errorf("not connected")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result, err := c.client.CallTool(ctx, mcp.CallToolRequest{
		Params: struct {
			Name      string    `json:"name"`
			Arguments any       `json:"arguments,omitempty"`
			Meta      *mcp.Meta `json:"_meta,omitempty"`
		}{
			Name:      name,
			Arguments: arguments,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to call tool: %w", err)
	}

	return result, nil
}

func (c *McpSSEClient) SetBrowserState(state map[string]interface{}) error {
	if !c.connected {
		return fmt.Errorf("not connected")
	}

	// This is a custom method for our test environment
	// We'll implement it using a custom tool call if needed
	_, err := c.CallTool("setBrowserState", state)
	return err
}

func (c *McpSSEClient) Close() error {
	if c.connected && c.client != nil {
		// Note: mark3labs client Close() doesn't take context
		err := c.client.Close()
		c.connected = false
		return err
	}
	c.connected = false
	return nil
}
