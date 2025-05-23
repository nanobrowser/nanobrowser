package sse

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	"github.com/algonius/algonius-browser/mcp-host-go/pkg/logger"
	"github.com/algonius/algonius-browser/mcp-host-go/pkg/types"
)

// SSEServer implements an SSE-based MCP server using mark3labs/mcp-go
type SSEServer struct {
	logger    logger.Logger
	messaging types.Messaging
	hostInfo  types.HostInfo

	mcpServer *server.MCPServer
	sseServer *server.SSEServer

	// Keep track of registered tools and resources for adaptation
	tools     map[string]types.Tool
	resources map[string]types.Resource
	mu        sync.RWMutex

	// Server configuration
	port     string
	baseURL  string
	basePath string
}

// SSEServerConfig contains configuration for the SSE Server
type SSEServerConfig struct {
	Logger    logger.Logger
	Messaging types.Messaging
	HostInfo  types.HostInfo
	Port      string // e.g., ":8080"
	BaseURL   string // e.g., "http://localhost:8080"
	BasePath  string // e.g., "/mcp"
}

// NewSSEServer creates a new SSE-based MCP server
func NewSSEServer(config SSEServerConfig) (*SSEServer, error) {
	if config.Logger == nil {
		return nil, fmt.Errorf("logger is required")
	}

	if config.Messaging == nil {
		return nil, fmt.Errorf("messaging is required")
	}

	if config.Port == "" {
		config.Port = ":8080"
	}

	if config.BaseURL == "" {
		config.BaseURL = "http://localhost:8080"
	}

	if config.BasePath == "" {
		config.BasePath = "/mcp"
	}

	// Create the mark3labs/mcp-go server
	mcpServer := server.NewMCPServer(
		config.HostInfo.Name,
		config.HostInfo.Version,
		server.WithToolCapabilities(true),
		server.WithResourceCapabilities(true, true),
	)

	// Create the SSE server
	sseServer := server.NewSSEServer(mcpServer,
		server.WithBaseURL(config.BaseURL),
		server.WithStaticBasePath(config.BasePath),
	)

	s := &SSEServer{
		logger:    config.Logger,
		messaging: config.Messaging,
		hostInfo:  config.HostInfo,
		mcpServer: mcpServer,
		sseServer: sseServer,
		tools:     make(map[string]types.Tool),
		resources: make(map[string]types.Resource),
		port:      config.Port,
		baseURL:   config.BaseURL,
		basePath:  config.BasePath,
	}

	return s, nil
}

// RegisterTool registers a tool with the SSE server
func (s *SSEServer) RegisterTool(tool types.Tool) error {
	if tool == nil {
		return fmt.Errorf("tool cannot be nil")
	}

	name := tool.GetName()
	if name == "" {
		return fmt.Errorf("tool name cannot be empty")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.logger.Debug("Registering tool for SSE server", name)

	if _, exists := s.tools[name]; exists {
		return fmt.Errorf("tool already registered: %s", name)
	}

	s.tools[name] = tool

	// Create mark3labs/mcp-go tool from our tool
	mcpTool := s.createMCPTool(tool)

	// Add tool with handler to mark3labs/mcp-go server
	s.mcpServer.AddTool(mcpTool, s.createToolHandler(tool))

	return nil
}

// RegisterResource registers a resource with the SSE server
func (s *SSEServer) RegisterResource(resource types.Resource) error {
	if resource == nil {
		return fmt.Errorf("resource cannot be nil")
	}

	uri := resource.GetURI()
	if uri == "" {
		return fmt.Errorf("resource URI cannot be empty")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.logger.Debug("Registering resource for SSE server", uri)

	if _, exists := s.resources[uri]; exists {
		return fmt.Errorf("resource already registered: %s", uri)
	}

	s.resources[uri] = resource

	// Create mark3labs/mcp-go resource from our resource
	mcpResource := s.createMCPResource(resource)

	// Add resource with handler to mark3labs/mcp-go server
	s.mcpServer.AddResource(mcpResource, s.createResourceHandler(resource))

	return nil
}

// Start starts the SSE server
func (s *SSEServer) Start() error {
	s.logger.Info("Starting SSE MCP server", "port", s.port, "baseURL", s.baseURL)

	// Start the SSE server
	go func() {
		if err := s.sseServer.Start(s.port); err != nil && err != http.ErrServerClosed {
			s.logger.Error("SSE server error", err)
		}
	}()

	s.logger.Info("SSE MCP server started")
	return nil
}

// Shutdown shuts down the SSE server
func (s *SSEServer) Shutdown() error {
	s.logger.Info("Shutting down SSE MCP server")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	return s.sseServer.Shutdown(ctx)
}

// IsRunning returns true if the server is running
func (s *SSEServer) IsRunning() bool {
	// For SSE server, we assume it's running if it was started successfully
	// mark3labs/mcp-go doesn't expose a direct IsRunning method
	return true
}

// createMCPTool converts our tool interface to mark3labs/mcp-go tool
func (s *SSEServer) createMCPTool(tool types.Tool) mcp.Tool {
	schema := tool.GetInputSchema()

	// Convert our schema to mark3labs/mcp-go format
	options := []mcp.ToolOption{
		mcp.WithDescription(tool.GetDescription()),
	}

	// Parse the schema and add parameters
	if schemaMap, ok := schema.(map[string]interface{}); ok {
		if properties, ok := schemaMap["properties"].(map[string]interface{}); ok {
			for propName, propDef := range properties {
				if propDefMap, ok := propDef.(map[string]interface{}); ok {
					if propType, ok := propDefMap["type"].(string); ok {
						switch propType {
						case "string":
							stringOptions := []mcp.PropertyOption{}
							if desc, ok := propDefMap["description"].(string); ok {
								stringOptions = append(stringOptions, mcp.Description(desc))
							}
							// Check if it's required
							if required, ok := schemaMap["required"].([]interface{}); ok {
								for _, req := range required {
									if reqStr, ok := req.(string); ok && reqStr == propName {
										stringOptions = append(stringOptions, mcp.Required())
										break
									}
								}
							}
							options = append(options, mcp.WithString(propName, stringOptions...))
						case "number":
							numberOptions := []mcp.PropertyOption{}
							if desc, ok := propDefMap["description"].(string); ok {
								numberOptions = append(numberOptions, mcp.Description(desc))
							}
							// Check if it's required
							if required, ok := schemaMap["required"].([]interface{}); ok {
								for _, req := range required {
									if reqStr, ok := req.(string); ok && reqStr == propName {
										numberOptions = append(numberOptions, mcp.Required())
										break
									}
								}
							}
							options = append(options, mcp.WithNumber(propName, numberOptions...))
						}
					}
				}
			}
		}
	}

	return mcp.NewTool(tool.GetName(), options...)
}

// createToolHandler creates a handler function for mark3labs/mcp-go that calls our tool
func (s *SSEServer) createToolHandler(tool types.Tool) func(context.Context, mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		s.logger.Debug("Executing tool via SSE", "tool", tool.GetName())

		// Convert the request arguments to our format
		args := request.GetArguments()

		// Execute our tool
		result, err := tool.Execute(args)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		// Convert our result to mark3labs/mcp-go format
		contents := make([]mcp.Content, 0, len(result.Content))
		for _, item := range result.Content {
			switch item.Type {
			case "text":
				contents = append(contents, mcp.NewTextContent(item.Text))
			default:
				contents = append(contents, mcp.NewTextContent(item.Text))
			}
		}

		return &mcp.CallToolResult{
			Content: contents,
		}, nil
	}
}

// createMCPResource converts our resource interface to mark3labs/mcp-go resource
func (s *SSEServer) createMCPResource(resource types.Resource) mcp.Resource {
	return mcp.NewResource(
		resource.GetURI(),
		resource.GetName(),
		mcp.WithResourceDescription(resource.GetDescription()),
		mcp.WithMIMEType(resource.GetMimeType()),
	)
}

// createResourceHandler creates a handler function for mark3labs/mcp-go that calls our resource
func (s *SSEServer) createResourceHandler(resource types.Resource) func(context.Context, mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
	return func(ctx context.Context, request mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
		s.logger.Debug("Reading resource via SSE", "uri", resource.GetURI())

		// Read our resource
		content, err := resource.Read()
		if err != nil {
			return nil, err
		}

		// Convert our result to mark3labs/mcp-go format
		contents := make([]mcp.ResourceContents, 0, len(content.Contents))
		for _, item := range content.Contents {
			contents = append(contents, mcp.TextResourceContents{
				URI:      item.URI,
				MIMEType: item.MimeType,
				Text:     item.Text,
			})
		}

		return contents, nil
	}
}
