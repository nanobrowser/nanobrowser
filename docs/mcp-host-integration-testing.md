# MCP Host Go Integration Testing Strategy

This document outlines a comprehensive integration testing strategy for the Algonius Browser MCP Host (Go implementation) that ensures the deployed host functions correctly in a real-world environment.

## Core Testing Principles

The integration tests should validate that:

1. The MCP host process initializes correctly with proper dependency injection
2. Native Messaging communication works properly via stdin/stdout interface
3. The SSE server and MCP protocol implementation function as expected
4. Browser resources and tools are correctly registered and accessible
5. End-to-end flows represent real-world usage patterns with dual protocol support

## Testing Architecture

The integration tests will use a three-tiered approach:

```
┌─────────────────┐      ┌────────────────┐      ┌────────────────────┐
│                 │      │                │      │                    │
│  Mock Chrome    │      │   MCP Host     │      │    Mock MCP        │
│  Extension      │ ──── │   Process      │ ──── │    Client          │
│  (Go)           │      │   (Under Test) │      │    (HTTP/SSE)      │
└─────────────────┘      └────────────────┘      └────────────────────┘
     Native Messaging         SSE/HTTP Protocol
     (stdin/stdout)
```

### 1. Mock Chrome Extension (Go)

A simulated Chrome extension environment that:
- Spawns the actual MCP host as a child process
- Communicates with the host via Native Messaging (stdin/stdout)
- Simulates browser state and actions
- Injects test scenarios

### 2. MCP Host Process (System Under Test)

The actual Go MCP host that:
- Starts up with dependency injection container
- Registers resources (current_state) and tools (navigate_to)
- Processes Native Messaging from the mock extension
- Runs the SSE server for external MCP clients
- Handles MCP protocol requests via SSE

### 3. Mock MCP Client (HTTP/SSE)

A test client that:
- Connects to the MCP host's SSE server
- Issues MCP protocol requests (listResources, readResource, callTool)
- Validates responses
- Tests error handling

## Test Implementation

### Test Environment Setup

```go
package integration_test

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type McpHostTestEnvironment struct {
	hostProcess   *exec.Cmd
	mcpClient     *MockMcpSSEClient
	nativeMsg     *NativeMessagingManager
	port          int
	baseURL       string
	basePath      string
	logFilePath   string
	testDataDir   string
}

type TestConfig struct {
	Port        int
	LogLevel    string
	TestDataDir string
}

func NewMcpHostTestEnvironment(config *TestConfig) (*McpHostTestEnvironment, error) {
	if config == nil {
		config = &TestConfig{}
	}
	
	// Use provided port or find an available one
	port := config.Port
	if port == 0 {
		var err error
		port, err = findAvailablePort()
		if err != nil {
			return nil, fmt.Errorf("failed to find available port: %w", err)
		}
	}
	
	baseURL := fmt.Sprintf("http://localhost:%d", port)
	basePath := "/mcp"
	
	// Create test data directory
	testDataDir := config.TestDataDir
	if testDataDir == "" {
		testDataDir = filepath.Join(os.TempDir(), "mcp-host-test", fmt.Sprintf("test-%d", time.Now().Unix()))
	}
	
	if err := os.MkdirAll(testDataDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create test data directory: %w", err)
	}
	
	return &McpHostTestEnvironment{
		port:        port,
		baseURL:     baseURL,
		basePath:    basePath,
		testDataDir: testDataDir,
		logFilePath: filepath.Join(testDataDir, "mcp-host.log"),
	}, nil
}

func (env *McpHostTestEnvironment) Setup(ctx context.Context) error {
	// Build the MCP host binary if needed
	if err := env.buildMcpHost(); err != nil {
		return fmt.Errorf("failed to build MCP host: %w", err)
	}
	
	// Start the MCP host process
	if err := env.startMcpHost(ctx); err != nil {
		return fmt.Errorf("failed to start MCP host: %w", err)
	}
	
	// Wait for the host to be ready
	if err := env.waitForHostReady(ctx); err != nil {
		return fmt.Errorf("MCP host failed to become ready: %w", err)
	}
	
	// Create MCP client
	env.mcpClient = NewMockMcpSSEClient(env.baseURL + env.basePath)
	
	// Create Native Messaging manager
	env.nativeMsg = NewNativeMessagingManager(env.hostProcess.Process.Pid)
	
	return nil
}

func (env *McpHostTestEnvironment) buildMcpHost() error {
	// Build the binary using the Makefile
	cmd := exec.Command("make", "build")
	cmd.Dir = "../../mcp-host-go" // Adjust path as needed
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	
	return cmd.Run()
}

func (env *McpHostTestEnvironment) startMcpHost(ctx context.Context) error {
	// Prepare environment variables
	environ := append(os.Environ(),
		fmt.Sprintf("SSE_PORT=:%d", env.port),
		fmt.Sprintf("SSE_BASE_URL=%s", env.baseURL),
		fmt.Sprintf("SSE_BASE_PATH=%s", env.basePath),
		fmt.Sprintf("LOG_FILE=%s", env.logFilePath),
		"LOG_LEVEL=debug",
		"RUN_MODE=test",
	)
	
	// Start the MCP host process
	env.hostProcess = exec.CommandContext(ctx, "../../mcp-host-go/bin/mcp-host")
	env.hostProcess.Env = environ
	
	// Create pipes for Native Messaging communication
	stdin, err := env.hostProcess.StdinPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdin pipe: %w", err)
	}
	
	stdout, err := env.hostProcess.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}
	
	stderr, err := env.hostProcess.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}
	
	// Start the process
	if err := env.hostProcess.Start(); err != nil {
		return fmt.Errorf("failed to start process: %w", err)
	}
	
	// Store pipes for Native Messaging
	env.nativeMsg = &NativeMessagingManager{
		stdin:  stdin,
		stdout: stdout,
		stderr: stderr,
		pid:    env.hostProcess.Process.Pid,
	}
	
	return nil
}

func (env *McpHostTestEnvironment) waitForHostReady(ctx context.Context) error {
	// Wait for SSE server to be ready
	client := &http.Client{Timeout: 1 * time.Second}
	
	for i := 0; i < 30; i++ { // Wait up to 30 seconds
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		
		resp, err := client.Get(env.baseURL + env.basePath + "/health")
		if err == nil && resp.StatusCode == 200 {
			resp.Body.Close()
			return nil
		}
		if resp != nil {
			resp.Body.Close()
		}
		
		time.Sleep(1 * time.Second)
	}
	
	return fmt.Errorf("MCP host did not become ready within timeout")
}

func (env *McpHostTestEnvironment) Cleanup() error {
	var errors []error
	
	// Shutdown the host process
	if env.hostProcess != nil && env.hostProcess.Process != nil {
		if err := env.hostProcess.Process.Signal(os.Interrupt); err != nil {
			errors = append(errors, fmt.Errorf("failed to send interrupt signal: %w", err))
		}
		
		// Wait for graceful shutdown
		done := make(chan error)
		go func() {
			done <- env.hostProcess.Wait()
		}()
		
		select {
		case err := <-done:
			if err != nil {
				errors = append(errors, fmt.Errorf("process exited with error: %w", err))
			}
		case <-time.After(10 * time.Second):
			// Force kill if graceful shutdown takes too long
			if err := env.hostProcess.Process.Kill(); err != nil {
				errors = append(errors, fmt.Errorf("failed to kill process: %w", err))
			}
		}
	}
	
	// Close MCP client
	if env.mcpClient != nil {
		if err := env.mcpClient.Close(); err != nil {
			errors = append(errors, fmt.Errorf("failed to close MCP client: %w", err))
		}
	}
	
	// Close Native Messaging
	if env.nativeMsg != nil {
		if err := env.nativeMsg.Close(); err != nil {
			errors = append(errors, fmt.Errorf("failed to close native messaging: %w", err))
		}
	}
	
	// Clean up test data directory
	if env.testDataDir != "" {
		if err := os.RemoveAll(env.testDataDir); err != nil {
			errors = append(errors, fmt.Errorf("failed to remove test data directory: %w", err))
		}
	}
	
	if len(errors) > 0 {
		return fmt.Errorf("cleanup errors: %v", errors)
	}
	
	return nil
}

func findAvailablePort() (int, error) {
	listener, err := net.Listen("tcp", ":0")
	if err != nil {
		return 0, err
	}
	defer listener.Close()
	
	addr := listener.Addr().(*net.TCPAddr)
	return addr.Port, nil
}
```

### Core Test Scenarios

#### 1. End-to-End Process Lifecycle

```go
func TestProcessLifecycle(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	
	// Setup test environment
	env, err := NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer env.Cleanup()
	
	// Setup the environment
	err = env.Setup(ctx)
	require.NoError(t, err)
	
	// Send initialization message via Native Messaging
	initResponse, err := env.nativeMsg.SendMessage(ctx, map[string]interface{}{
		"type": "initialize",
		"capabilities": map[string]interface{}{
			"version": "1.0.0",
		},
	})
	require.NoError(t, err)
	
	// Verify initialization response
	assert.Equal(t, true, initResponse["success"])
	
	// Verify process is running
	assert.True(t, env.IsHostRunning())
	
	// Test graceful shutdown
	err = env.hostProcess.Process.Signal(os.Interrupt)
	require.NoError(t, err)
	
	// Wait for process to exit
	err = env.hostProcess.Wait()
	assert.NoError(t, err)
}
```

#### 2. Browser State Resource Testing

```go
func TestBrowserStateResource(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	
	// Setup test environment
	env, err := NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer env.Cleanup()
	
	err = env.Setup(ctx)
	require.NoError(t, err)
	
	// Initialize MCP client session
	err = env.mcpClient.Initialize(ctx)
	require.NoError(t, err)
	
	// Set mock browser state via Native Messaging
	stateResponse, err := env.nativeMsg.SendMessage(ctx, map[string]interface{}{
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
	require.NoError(t, err)
	assert.Equal(t, true, stateResponse["success"])
	
	// Wait for state to be processed
	time.Sleep(100 * time.Millisecond)
	
	// Verify resource is available through MCP client
	resources, err := env.mcpClient.ListResources(ctx)
	require.NoError(t, err)
	
	found := false
	for _, resource := range resources.Resources {
		if resource.URI == "browser://current/state" {
			found = true
			break
		}
	}
	assert.True(t, found, "browser://current/state resource should be available")
	
	// Read and verify resource content
	resourceContent, err := env.mcpClient.ReadResource(ctx, "browser://current/state")
	require.NoError(t, err)
	
	var content map[string]interface{}
	err = json.Unmarshal([]byte(resourceContent.Contents[0].Text), &content)
	require.NoError(t, err)
	
	activeTab := content["activeTab"].(map[string]interface{})
	assert.Equal(t, "https://example.com", activeTab["url"])
}
```

#### 3. Tool Execution Testing

```go
func TestNavigateToTool(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	
	// Setup test environment
	env, err := NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer env.Cleanup()
	
	err = env.Setup(ctx)
	require.NoError(t, err)
	
	// Initialize MCP client
	err = env.mcpClient.Initialize(ctx)
	require.NoError(t, err)
	
	// Verify tool is available
	tools, err := env.mcpClient.ListTools(ctx)
	require.NoError(t, err)
	
	found := false
	for _, tool := range tools.Tools {
		if tool.Name == "navigate_to" {
			found = true
			break
		}
	}
	assert.True(t, found, "navigate_to tool should be available")
	
	// Set up action handler to capture navigation commands
	var capturedAction map[string]interface{}
	env.nativeMsg.SetActionHandler(func(action string, params map[string]interface{}) map[string]interface{} {
		capturedAction = map[string]interface{}{
			"action": action,
			"params": params,
		}
		return map[string]interface{}{"success": true}
	})
	
	// Execute navigation tool via MCP client
	result, err := env.mcpClient.CallTool(ctx, "navigate_to", map[string]interface{}{
		"url": "https://test.com",
	})
	require.NoError(t, err)
	assert.False(t, result.IsError)
	
	// Verify navigation was requested through Native Messaging
	require.NotNil(t, capturedAction)
	assert.Equal(t, "navigate", capturedAction["action"])
	params := capturedAction["params"].(map[string]interface{})
	assert.Equal(t, "https://test.com", params["url"])
}
```

#### 4. Error Handling and Edge Cases

```go
func TestErrorHandling(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	
	// Setup test environment
	env, err := NewMcpHostTestEnvironment(nil)
	require.NoError(t, err)
	defer env.Cleanup()
	
	err = env.Setup(ctx)
	require.NoError(t, err)
	
	// Initialize MCP client
	err = env.mcpClient.Initialize(ctx)
	require.NoError(t, err)
	
	// Send malformed message via Native Messaging
	response, err := env.nativeMsg.SendMessage(ctx, map[string]interface{}{
		"type": "invalidMessageType",
	})
	require.NoError(t, err)
	
	// Verify error response
	assert.NotNil(t, response["error"])
	
	// Test invalid resource URI
	_, err = env.mcpClient.ReadResource(ctx, "invalid://uri")
	assert.Error(t, err, "Should return error for invalid resource URI")
	
	// Test invalid tool call
	result, err := env.mcpClient.CallTool(ctx, "nonexistent_tool", map[string]interface{}{})
	require.NoError(t, err)
	assert.True(t, result.IsError, "Should return error for nonexistent tool")
	
	// Verify process remains stable after errors
	resources, err := env.mcpClient.ListResources(ctx)
	require.NoError(t, err)
	assert.NotEmpty(t, resources.Resources, "Should still be able to list resources after errors")
}
```

## Test Helpers Implementation

### Native Messaging Manager

```go
type NativeMessagingManager struct {
	stdin  io.WriteCloser
	stdout io.ReadCloser
	stderr io.ReadCloser
	pid    int
	
	actionHandler func(action string, params map[string]interface{}) map[string]interface{}
	responses     chan map[string]interface{}
	errors        chan error
}

func NewNativeMessagingManager(pid int) *NativeMessagingManager {
	return &NativeMessagingManager{
		pid:       pid,
		responses: make(chan map[string]interface{}, 10),
		errors:    make(chan error, 10),
	}
}

func (nm *NativeMessagingManager) SendMessage(ctx context.Context, message map[string]interface{}) (map[string]interface{}, error) {
	// Encode message as JSON
	data, err := json.Marshal(message)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal message: %w", err)
	}
	
	// Write length-prefixed message (Native Messaging format)
	length := uint32(len(data))
	if err := binary.Write(nm.stdin, binary.LittleEndian, length); err != nil {
		return nil, fmt.Errorf("failed to write message length: %w", err)
	}
	
	if _, err := nm.stdin.Write(data); err != nil {
		return nil, fmt.Errorf("failed to write message data: %w", err)
	}
	
	// Wait for response
	select {
	case response := <-nm.responses:
		return response, nil
	case err := <-nm.errors:
		return nil, err
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(30 * time.Second):
		return nil, fmt.Errorf("timeout waiting for response")
	}
}

func (nm *NativeMessagingManager) SetActionHandler(handler func(action string, params map[string]interface{}) map[string]interface{}) {
	nm.actionHandler = handler
}

func (nm *NativeMessagingManager) startMessageReader(ctx context.Context) {
	go func() {
		reader := bufio.NewReader(nm.stdout)
		
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}
			
			// Read message length
			var length uint32
			if err := binary.Read(reader, binary.LittleEndian, &length); err != nil {
				if err != io.EOF {
					nm.errors <- fmt.Errorf("failed to read message length: %w", err)
				}
				return
			}
			
			// Read message data
			data := make([]byte, length)
			if _, err := io.ReadFull(reader, data); err != nil {
				nm.errors <- fmt.Errorf("failed to read message data: %w", err)
				return
			}
			
			// Parse message
			var message map[string]interface{}
			if err := json.Unmarshal(data, &message); err != nil {
				nm.errors <- fmt.Errorf("failed to unmarshal message: %w", err)
				continue
			}
			
			// Handle the message
			nm.handleMessage(message)
		}
	}()
}

func (nm *NativeMessagingManager) handleMessage(message map[string]interface{}) {
	// Check if it's an action request
	if msgType, ok := message["type"].(string); ok && msgType == "executeAction" {
		if nm.actionHandler != nil {
			action := message["action"].(string)
			params := message["params"].(map[string]interface{})
			response := nm.actionHandler(action, params)
			
			// Send response back
			responseMsg := map[string]interface{}{
				"type":   "executeAction_result",
				"result": response,
			}
			nm.responses <- responseMsg
			return
		}
	}
	
	// For other messages, just forward to response channel
	nm.responses <- message
}

func (nm *NativeMessagingManager) Close() error {
	var errors []error
	
	if nm.stdin != nil {
		if err := nm.stdin.Close(); err != nil {
			errors = append(errors, err)
		}
	}
	
	if nm.stdout != nil {
		if err := nm.stdout.Close(); err != nil {
			errors = append(errors, err)
		}
	}
	
	if nm.stderr != nil {
		if err := nm.stderr.Close(); err != nil {
			errors = append(errors, err)
		}
	}
	
	if len(errors) > 0 {
		return fmt.Errorf("close errors: %v", errors)
	}
	
	return nil
}
```

### Mock MCP SSE Client

```go
type MockMcpSSEClient struct {
	baseURL    string
	httpClient *http.Client
	sessionID  string
}

type McpResource struct {
	URI         string `json:"uri"`
	Name        string `json:"name"`
	Description string `json:"description"`
	MIMEType    string `json:"mimeType"`
}

type McpTool struct {
	Name        string      `json:"name"`
	Description string      `json:"description"`
	InputSchema interface{} `json:"inputSchema"`
}

type ListResourcesResponse struct {
	Resources []McpResource `json:"resources"`
}

type ListToolsResponse struct {
	Tools []McpTool `json:"tools"`
}

type ResourceContent struct {
	URI      string `json:"uri"`
	MIMEType string `json:"mimeType"`
	Text     string `json:"text"`
}

type ReadResourceResponse struct {
	Contents []ResourceContent `json:"contents"`
}

type CallToolResponse struct {
	IsError bool     `json:"isError"`
	Content []string `json:"content"`
}

func NewMockMcpSSEClient(baseURL string) *MockMcpSSEClient {
	return &MockMcpSSEClient{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *MockMcpSSEClient) Initialize(ctx context.Context) error {
	// For SSE-based MCP, initialization might involve establishing SSE connection
	// For now, we'll just do a health check
	resp, err := c.httpClient.Get(c.baseURL + "/health")
	if err != nil {
		return fmt.Errorf("failed to initialize MCP client: %w", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("MCP server not ready, status: %d", resp.StatusCode)
	}
	
	return nil
}

func (c *MockMcpSSEClient) ListResources(ctx context.Context) (*ListResourcesResponse, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/resources", nil)
	if err != nil {
		return nil, err
	}
	
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	var result ListResourcesResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	
	return &result, nil
}

func (c *MockMcpSSEClient) ReadResource(ctx context.Context, uri string) (*ReadResourceResponse, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/resources/"+uri, nil)
	if err != nil {
		return nil, err
	}
	
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to read resource, status: %d", resp.StatusCode)
	}
	
	var result ReadResourceResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	
	return &result, nil
}

func (c *MockMcpSSEClient) ListTools(ctx context.Context) (*ListToolsResponse, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/tools", nil)
	if err != nil {
		return nil, err
	}
	
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	var result ListToolsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	
	return &result, nil
}

func (c *MockMcpSSEClient) CallTool(ctx context.Context, name string, args map[string]interface{}) (*CallToolResponse, error) {
	requestBody, err := json.Marshal(map[string]interface{}{
		"name":      name,
		"arguments": args,
	})
	if err != nil {
		return nil, err
	}
	
	req, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/tools/"+name, bytes.NewReader(requestBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	var result CallToolResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	
	return &result, nil
}

func (c *MockMcpSSEClient) Close() error {
	// Clean up any persistent connections
	return nil
}
```

## Test Suite Organization

The integration tests should be organized into test suites focused on specific functional areas:

1. **Process Lifecycle Tests** (`lifecycle_test.go`): Starting up, initialization, clean shutdown
2. **Resource Management Tests** (`resources_test.go`): Registration, listing, and reading of browser resources
3. **Tool Execution Tests** (`tools_test.go`): Tool registration, listing, and execution
4. **Protocol Compliance Tests** (`protocol_test.go`): Adherence to MCP protocol spec via SSE
5. **Error Handling Tests** (`errors_test.go`): Graceful handling of errors, stability after errors
6. **Performance Tests** (`performance_test.go`): Response times under various loads
7. **Native Messaging Tests** (`native_messaging_test.go`): Chrome extension communication testing

## Build and Test Configuration

### Makefile Integration

```makefile
# Add to mcp-host-go/Makefile

.PHONY: test-integration test-integration-verbose test-integration-clean

test-integration: build
	@echo "Running integration tests..."
	cd tests/integration && go test -v -timeout=5m ./...

test-integration-verbose: build
	@echo "Running integration tests with verbose output..."
	cd tests/integration && go test -v -timeout=5m -args -test.v ./...

test-integration-clean: test-integration
	@echo "Cleaning up test artifacts..."
	rm -rf /tmp/mcp-host-test*

test-integration-coverage: build
	@echo "Running integration tests with coverage..."
	cd tests/integration && go test -v -timeout=5m -coverprofile=coverage.out ./...
	cd tests/integration && go tool cover -html=coverage.out -o coverage.html
```

### Go Module Configuration

```go
// tests/integration/go.mod
module github.com/algonius/algonius-browser/mcp-host-go/tests/integration

go 1.21

require (
	github.com/stretchr/testify v1.8.4
	github.com/algonius/algonius-browser/mcp-host-go v0.0.0
)

replace github.com/algonius/algonius-browser/mcp-host-go => ../../
```

## Implementation Plan

1. **Create the core test infrastructure**
   - `McpHostTestEnvironment` struct and setup methods
   - Native Messaging communication manager
   - Mock MCP SSE client

2. **Implement basic functional tests**
   - Process lifecycle tests
   - Resource accessibility tests
   - Tool execution tests

3. **Add protocol compliance tests**
   - SSE connection handling
   - MCP protocol message validation
   - Error response format validation

4. **Implement edge case and error handling tests**
   - Invalid inputs via both Native Messaging and SSE
   - Protocol violations
   - Concurrent operations
   - Resource cleanup

5. **Add performance and stability tests**
   - Long-running tests
   - Load testing with multiple concurrent MCP clients
   - Memory leak detection

## Key Differences from Node.js Version

1. **Language**: All test code is now in Go instead of TypeScript/JavaScript
2. **Build System**: Uses Go build tools and Makefile instead of npm/pnpm
3. **Process Communication**: Native Go process management with `os/exec` package
4. **SSE Protocol**: Tests the SSE-based MCP implementation instead of HTTP/JSON-RPC
5. **Dependency Injection**: Tests the container-based dependency injection pattern
6. **Logging**: Tests file-based logging system (no stdout interference)
7. **Environment Configuration**: Uses Go environment variable handling

## Conclusion

This integration testing approach ensures the Go MCP host functions correctly in a real-world environment by:

1. Testing the actual Go processes and communication channels used in production
2. Validating end-to-end flows from Chrome extension via Native Messaging to external MCP clients via SSE
3. Ensuring robustness through comprehensive edge case and error testing
4. Maintaining clear separation between the system under test and test infrastructure
5. Supporting both protocol interfaces (Native Messaging and SSE) in a unified test suite

When these tests pass, we can be confident that the deployed Go MCP host will work correctly when interacting with both the Chrome extension and external MCP clients in production environments.
