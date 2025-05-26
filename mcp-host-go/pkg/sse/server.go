package sse

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
	"go.uber.org/zap"

	"github.com/algonius/algonius-browser/mcp-host-go/pkg/logger"
	"github.com/algonius/algonius-browser/mcp-host-go/pkg/types"
)

// SSEServer represents an SSE MCP server that forwards requests to Chrome extension
type SSEServer struct {
	logger    logger.Logger
	messaging types.Messaging
	mcpServer *server.MCPServer
	sseServer *server.SSEServer
	port      string
	baseURL   string
	hostInfo  types.HostInfo
	tools     map[string]types.Tool
	resources map[string]types.Resource
}

// SSEServerConfig contains configuration for SSE server
type SSEServerConfig struct {
	Logger    logger.Logger
	Messaging types.Messaging
	Port      string
	BaseURL   string
	HostInfo  types.HostInfo
}

// NewSSEServer creates a new SSE MCP server
func NewSSEServer(config SSEServerConfig) (*SSEServer, error) {
	if config.Logger == nil {
		return nil, fmt.Errorf("logger is required")
	}
	if config.Messaging == nil {
		return nil, fmt.Errorf("messaging is required")
	}

	// Create the MCP server
	mcpServer := server.NewMCPServer(
		config.HostInfo.Name,
		config.HostInfo.Version,
	)

	// Create SSE server with proper configuration
	sseServer := server.NewSSEServer(mcpServer)

	s := &SSEServer{
		logger:    config.Logger,
		messaging: config.Messaging,
		mcpServer: mcpServer,
		sseServer: sseServer,
		port:      config.Port,
		baseURL:   config.BaseURL,
		hostInfo:  config.HostInfo,
		tools:     make(map[string]types.Tool),
		resources: make(map[string]types.Resource),
	}

	return s, nil
}

// RegisterTool registers a tool with the SSE server
func (s *SSEServer) RegisterTool(tool types.Tool) error {
	name := tool.GetName()
	s.logger.Debug("Registering tool for SSE server", zap.String("name", name))

	s.tools[name] = tool

	// Get the schema and convert to the proper format
	schema := tool.GetInputSchema()

	// Create a minimal schema if none is provided
	toolSchema := mcp.ToolInputSchema{
		Type:       "object",
		Properties: make(map[string]any),
	}

	// Try to convert the schema if it's provided in the right format
	if schemaMap, ok := schema.(map[string]interface{}); ok {
		if typeVal, ok := schemaMap["type"].(string); ok {
			toolSchema.Type = typeVal
		}
		if props, ok := schemaMap["properties"].(map[string]interface{}); ok {
			toolSchema.Properties = props
		}
		if required, ok := schemaMap["required"].([]string); ok {
			toolSchema.Required = required
		} else if requiredAny, ok := schemaMap["required"].([]interface{}); ok {
			// Convert []interface{} to []string if needed
			for _, r := range requiredAny {
				if s, ok := r.(string); ok {
					toolSchema.Required = append(toolSchema.Required, s)
				}
			}
		}
	} else {
		s.logger.Warn("Invalid input schema format for tool", zap.String("tool", name))
	}

	// Register with MCP server
	serverTool := mcp.Tool{
		Name:        name,
		Description: tool.GetDescription(),
		InputSchema: toolSchema,
	}

	s.mcpServer.AddTool(serverTool, s.createToolHandlerForTool(tool))

	return nil
}

// RegisterResource registers a resource with the SSE server
func (s *SSEServer) RegisterResource(resource types.Resource) error {
	uri := resource.GetURI()
	s.logger.Debug("Registering resource for SSE server", zap.String("uri", uri))

	s.resources[uri] = resource

	// Register with MCP server
	mcpResource := mcp.Resource{
		URI:         uri,
		Name:        resource.GetName(),
		Description: resource.GetDescription(),
		MIMEType:    resource.GetMimeType(),
	}

	s.mcpServer.AddResource(mcpResource, s.createResourceHandlerForResource(resource))

	return nil
}

// findMatchingResource finds a resource that matches the requested URI
func (s *SSEServer) findMatchingResource(requestedURI string) types.Resource {
	// First try exact match
	if resource, exists := s.resources[requestedURI]; exists {
		return resource
	}

	// Then try pattern matching for path-based parameters
	for baseURI, resource := range s.resources {
		if s.matchesURIPattern(requestedURI, baseURI) {
			return resource
		}
	}

	return nil
}

// matchesURIPattern checks if a requested URI matches a base URI pattern
func (s *SSEServer) matchesURIPattern(requestedURI, baseURI string) bool {
	// Simple pattern matching for DOM state resource
	// This specifically handles browser://dom/state/* patterns
	if baseURI == "browser://dom/state" {
		return strings.HasPrefix(requestedURI, "browser://dom/state")
	}

	return false
}

// Start starts the SSE MCP server
func (s *SSEServer) Start() error {
	s.logger.Info("Starting SSE MCP server",
		zap.String("port", s.port),
		zap.String("baseURL", s.baseURL))

	// Start the server in a goroutine
	go func() {
		if err := s.sseServer.Start(s.port); err != nil && err != http.ErrServerClosed {
			s.logger.Error("SSE server error", zap.Error(err))
		}
	}()

	s.logger.Info("SSE MCP server started")
	return nil
}

// Shutdown shuts down the SSE MCP server
func (s *SSEServer) Shutdown() error {
	s.logger.Info("Shutting down SSE MCP server")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	return s.sseServer.Shutdown(ctx)
}

// IsRunning returns whether the SSE server is running
func (s *SSEServer) IsRunning() bool {
	// For now just return true if the server is initialized
	// In a more sophisticated implementation, we could check the actual HTTP server status
	return s.sseServer != nil
}

// createToolHandlerForTool creates a tool handler function for the provided tool
func (s *SSEServer) createToolHandlerForTool(tool types.Tool) server.ToolHandlerFunc {
	return func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		s.logger.Debug("Executing tool via SSE", zap.String("tool", tool.GetName()))

		// Convert arguments to map[string]interface{}
		args, ok := request.Params.Arguments.(map[string]interface{})
		if !ok {
			args = make(map[string]interface{})
			s.logger.Warn("Invalid arguments format", zap.String("tool", tool.GetName()))
		}

		// Execute the tool
		result, err := tool.Execute(args)
		if err != nil {
			s.logger.Error("Tool execution failed", zap.Error(err), zap.String("tool", tool.GetName()))
			return &mcp.CallToolResult{
				IsError: true,
				Content: []mcp.Content{
					&mcp.TextContent{
						Type: "text",
						Text: fmt.Sprintf("Tool execution failed: %s", err.Error()),
					},
				},
			}, nil
		}

		// Convert result to MCP format
		var content []mcp.Content
		for _, item := range result.Content {
			content = append(content, &mcp.TextContent{
				Type: item.Type,
				Text: item.Text,
			})
		}

		return &mcp.CallToolResult{
			IsError: false,
			Content: content,
		}, nil
	}
}

// createResourceHandlerForResource creates a resource handler function for the provided resource
func (s *SSEServer) createResourceHandlerForResource(resource types.Resource) server.ResourceHandlerFunc {
	return func(ctx context.Context, request mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
		s.logger.Debug("Reading resource via SSE",
			zap.String("uri", resource.GetURI()),
			zap.String("requestedURI", request.Params.URI),
			zap.Any("arguments", request.Params.Arguments))

		// Check if this is a pattern match request
		var targetResource types.Resource = resource
		if request.Params.URI != resource.GetURI() {
			// Look for a matching resource pattern
			matchedResource := s.findMatchingResource(request.Params.URI)
			if matchedResource != nil {
				targetResource = matchedResource
				s.logger.Debug("Matched URI pattern",
					zap.String("requestedURI", request.Params.URI),
					zap.String("baseURI", targetResource.GetURI()))
			}
		}

		// Read the resource with arguments if provided
		content, err := targetResource.ReadWithArguments(request.Params.URI, request.Params.Arguments)
		if err != nil {
			s.logger.Error("Failed to read resource", zap.Error(err),
				zap.String("uri", targetResource.GetURI()),
				zap.String("requestedURI", request.Params.URI))
			return nil, fmt.Errorf("failed to read resource: %w", err)
		}

		// Convert to MCP format
		var result []mcp.ResourceContents

		for _, item := range content.Contents {
			result = append(result, &mcp.TextResourceContents{
				URI:      item.URI,
				MIMEType: item.MimeType,
				Text:     item.Text,
			})
		}

		return result, nil
	}
}
