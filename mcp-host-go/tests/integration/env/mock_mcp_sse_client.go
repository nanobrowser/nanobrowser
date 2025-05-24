package env

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// MockMcpSSEClient simulates an MCP client that communicates via SSE
type MockMcpSSEClient struct {
	baseURL    string
	httpClient *http.Client
	connected  bool
}

// MCP protocol message types
type ListResourcesResponse struct {
	Resources []Resource `json:"resources"`
}

type Resource struct {
	URI         string            `json:"uri"`
	Name        string            `json:"name"`
	Description string            `json:"description,omitempty"`
	MimeType    string            `json:"mimeType,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
}

type ListToolsResponse struct {
	Tools []Tool `json:"tools"`
}

type Tool struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description,omitempty"`
	InputSchema map[string]interface{} `json:"inputSchema"`
}

type CallToolRequest struct {
	Name      string                 `json:"name"`
	Arguments map[string]interface{} `json:"arguments,omitempty"`
}

type CallToolResponse struct {
	Content []ToolResponseContent `json:"content"`
	IsError bool                  `json:"isError,omitempty"`
}

type ToolResponseContent struct {
	Type string      `json:"type"`
	Text string      `json:"text,omitempty"`
	Data interface{} `json:"data,omitempty"`
}

type ReadResourceRequest struct {
	URI string `json:"uri"`
}

type ReadResourceResponse struct {
	Contents []ResourceContent `json:"contents"`
}

type ResourceContent struct {
	URI      string      `json:"uri"`
	MimeType string      `json:"mimeType,omitempty"`
	Text     string      `json:"text,omitempty"`
	Blob     string      `json:"blob,omitempty"`
	Data     interface{} `json:"data,omitempty"`
}

func NewMockMcpSSEClient(baseURL string) *MockMcpSSEClient {
	return &MockMcpSSEClient{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		connected: false,
	}
}

func (c *MockMcpSSEClient) Connect() error {
	// Test basic connectivity by making a simple GET request
	resp, err := c.httpClient.Get(c.baseURL + "/")
	if err != nil {
		return fmt.Errorf("failed to connect to MCP server: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNotFound {
		return fmt.Errorf("unexpected response status: %d", resp.StatusCode)
	}

	c.connected = true
	return nil
}

func (c *MockMcpSSEClient) Initialize(ctx context.Context) error {
	// Initialize the MCP session by connecting
	return c.Connect()
}

func (c *MockMcpSSEClient) ListResources() (*ListResourcesResponse, error) {
	if !c.connected {
		return nil, fmt.Errorf("not connected")
	}

	data := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "resources/list",
	}

	resp, err := c.makeRequest("POST", "/jsonrpc", data)
	if err != nil {
		return nil, err
	}

	var result ListResourcesResponse
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	return &result, nil
}

func (c *MockMcpSSEClient) ReadResource(uri string) (*ReadResourceResponse, error) {
	if !c.connected {
		return nil, fmt.Errorf("not connected")
	}

	data := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      2,
		"method":  "resources/read",
		"params": ReadResourceRequest{
			URI: uri,
		},
	}

	resp, err := c.makeRequest("POST", "/jsonrpc", data)
	if err != nil {
		return nil, err
	}

	var result ReadResourceResponse
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	return &result, nil
}

func (c *MockMcpSSEClient) ListTools() (*ListToolsResponse, error) {
	if !c.connected {
		return nil, fmt.Errorf("not connected")
	}

	data := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      3,
		"method":  "tools/list",
	}

	resp, err := c.makeRequest("POST", "/jsonrpc", data)
	if err != nil {
		return nil, err
	}

	var result ListToolsResponse
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	return &result, nil
}

func (c *MockMcpSSEClient) CallTool(name string, arguments map[string]interface{}) (*CallToolResponse, error) {
	if !c.connected {
		return nil, fmt.Errorf("not connected")
	}

	data := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      4,
		"method":  "tools/call",
		"params": CallToolRequest{
			Name:      name,
			Arguments: arguments,
		},
	}

	resp, err := c.makeRequest("POST", "/jsonrpc", data)
	if err != nil {
		return nil, err
	}

	var result CallToolResponse
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	return &result, nil
}

func (c *MockMcpSSEClient) SetBrowserState(state map[string]interface{}) error {
	if !c.connected {
		return fmt.Errorf("not connected")
	}

	data := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      5,
		"method":  "browser/setState",
		"params":  state,
	}

	_, err := c.makeRequest("POST", "/jsonrpc", data)
	return err
}

func (c *MockMcpSSEClient) makeRequest(method, path string, data interface{}) ([]byte, error) {
	// Prepare request body
	var body io.Reader
	if data != nil {
		jsonData, err := json.Marshal(data)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request data: %w", err)
		}
		body = bytes.NewReader(jsonData)
	}

	// Build URL
	requestURL, err := url.Parse(c.baseURL + path)
	if err != nil {
		return nil, fmt.Errorf("failed to parse URL: %w", err)
	}

	// Create request
	req, err := http.NewRequest(method, requestURL.String(), body)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	if data != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	// Make request
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()

	// Read response
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP error %d: %s", resp.StatusCode, string(respBody))
	}

	return respBody, nil
}

func (c *MockMcpSSEClient) Close() error {
	c.connected = false
	return nil
}
