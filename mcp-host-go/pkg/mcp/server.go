package mcp

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/algonius/algonius-browser/mcp-host-go/pkg/logger"
	"github.com/algonius/algonius-browser/mcp-host-go/pkg/types"
)

// Server implements the McpServer interface
type Server struct {
	logger         logger.Logger
	messaging      types.Messaging
	resources      map[string]types.Resource
	tools          map[string]types.Tool
	running        bool
	runningMutex   sync.RWMutex
	startTime      int64
	hostInfo       types.HostInfo
	shutdownSignal chan struct{}
}

// ServerConfig contains configuration for the MCP Server
type ServerConfig struct {
	Logger    logger.Logger
	Messaging types.Messaging
	HostInfo  types.HostInfo
}

// NewServer creates a new MCP Server instance
func NewServer(config ServerConfig) (*Server, error) {
	if config.Logger == nil {
		return nil, fmt.Errorf("logger is required")
	}

	if config.Messaging == nil {
		return nil, fmt.Errorf("messaging is required")
	}

	server := &Server{
		logger:         config.Logger,
		messaging:      config.Messaging,
		resources:      make(map[string]types.Resource),
		tools:          make(map[string]types.Tool),
		hostInfo:       config.HostInfo,
		shutdownSignal: make(chan struct{}),
	}

	return server, nil
}

// RegisterResource registers a resource with the server
func (s *Server) RegisterResource(resource types.Resource) error {
	if resource == nil {
		return fmt.Errorf("resource cannot be nil")
	}

	uri := resource.GetURI()
	if uri == "" {
		return fmt.Errorf("resource URI cannot be empty")
	}

	s.logger.Debug("Registering resource", uri)

	if _, exists := s.resources[uri]; exists {
		return fmt.Errorf("resource already registered: %s", uri)
	}

	s.resources[uri] = resource
	return nil
}

// RegisterTool registers a tool with the server
func (s *Server) RegisterTool(tool types.Tool) error {
	if tool == nil {
		return fmt.Errorf("tool cannot be nil")
	}

	name := tool.GetName()
	if name == "" {
		return fmt.Errorf("tool name cannot be empty")
	}

	s.logger.Debug("Registering tool", name)

	if _, exists := s.tools[name]; exists {
		return fmt.Errorf("tool already registered: %s", name)
	}

	s.tools[name] = tool

	// Register the tool execute handler
	s.messaging.RegisterRpcMethod("execute_tool", s.handleExecuteTool)

	return nil
}

// Start starts the MCP server
func (s *Server) Start() error {
	s.runningMutex.Lock()
	defer s.runningMutex.Unlock()

	if s.running {
		return fmt.Errorf("server already running")
	}

	s.logger.Info("Starting MCP server")
	s.startTime = time.Now().Unix()
	s.running = true

	// Register status handler
	s.messaging.RegisterHandler("status_request", s.handleStatusRequest)

	// Register resource handlers
	s.messaging.RegisterRpcMethod("list_resources", s.handleListResources)
	s.messaging.RegisterRpcMethod("get_resource", s.handleGetResource)

	// Register tool handlers
	s.messaging.RegisterRpcMethod("list_tools", s.handleListTools)

	// Start message processing
	if err := s.messaging.Start(); err != nil {
		s.running = false
		return fmt.Errorf("failed to start messaging: %w", err)
	}

	s.logger.Info("MCP server started")
	return nil
}

// Shutdown shuts down the MCP server
func (s *Server) Shutdown() error {
	s.runningMutex.Lock()
	defer s.runningMutex.Unlock()

	if !s.running {
		return fmt.Errorf("server not running")
	}

	s.logger.Info("Shutting down MCP server")
	s.running = false
	close(s.shutdownSignal)
	return nil
}

// IsRunning returns true if the server is running
func (s *Server) IsRunning() bool {
	s.runningMutex.RLock()
	defer s.runningMutex.RUnlock()
	return s.running
}

// handleStatusRequest handles a status request message
func (s *Server) handleStatusRequest(data interface{}) error {
	s.logger.Debug("Handling status request")

	status := types.HostStatus{
		HostInfo:    s.hostInfo,
		IsConnected: true,
		StartTime:   s.startTime,
		LastPing:    time.Now().Unix(),
	}

	return s.messaging.SendMessage(types.Message{
		Type: "status_response",
		Data: status,
	})
}

// handleListResources handles an RPC request to list all available resources
func (s *Server) handleListResources(request types.RpcRequest) (types.RpcResponse, error) {
	s.logger.Debug("Handling list_resources RPC request")

	resourceList := make([]map[string]string, 0, len(s.resources))
	for _, resource := range s.resources {
		resourceList = append(resourceList, map[string]string{
			"uri":         resource.GetURI(),
			"name":        resource.GetName(),
			"mimeType":    resource.GetMimeType(),
			"description": resource.GetDescription(),
		})
	}

	return types.RpcResponse{
		Result: resourceList,
	}, nil
}

// handleGetResource handles an RPC request to get a specific resource
func (s *Server) handleGetResource(request types.RpcRequest) (types.RpcResponse, error) {
	s.logger.Debug("Handling get_resource RPC request")

	// Extract URI from request parameters
	params, ok := request.Params.(map[string]interface{})
	if !ok {
		return types.RpcResponse{}, fmt.Errorf("invalid parameters format")
	}

	uriParam, ok := params["uri"]
	if !ok {
		return types.RpcResponse{}, fmt.Errorf("missing uri parameter")
	}

	uri, ok := uriParam.(string)
	if !ok {
		return types.RpcResponse{}, fmt.Errorf("uri parameter must be a string")
	}

	// Find the requested resource
	resource, exists := s.resources[uri]
	if !exists {
		return types.RpcResponse{
			Error: &types.ErrorInfo{
				Code:    404,
				Message: fmt.Sprintf("Resource not found: %s", uri),
			},
		}, nil
	}

	// Read the resource contents
	content, err := resource.Read()
	if err != nil {
		return types.RpcResponse{
			Error: &types.ErrorInfo{
				Code:    500,
				Message: fmt.Sprintf("Error reading resource: %s", err.Error()),
			},
		}, nil
	}

	return types.RpcResponse{
		Result: content,
	}, nil
}

// handleListTools handles an RPC request to list all available tools
func (s *Server) handleListTools(request types.RpcRequest) (types.RpcResponse, error) {
	s.logger.Debug("Handling list_tools RPC request")

	toolList := make([]map[string]interface{}, 0, len(s.tools))
	for _, tool := range s.tools {
		toolList = append(toolList, map[string]interface{}{
			"name":        tool.GetName(),
			"description": tool.GetDescription(),
			"inputSchema": tool.GetInputSchema(),
		})
	}

	return types.RpcResponse{
		Result: toolList,
	}, nil
}

// handleExecuteTool handles an RPC request to execute a tool
func (s *Server) handleExecuteTool(request types.RpcRequest) (types.RpcResponse, error) {
	s.logger.Debug("Handling execute_tool RPC request")

	// Extract parameters
	params, ok := request.Params.(map[string]interface{})
	if !ok {
		return types.RpcResponse{}, fmt.Errorf("invalid parameters format")
	}

	nameParam, ok := params["name"]
	if !ok {
		return types.RpcResponse{}, fmt.Errorf("missing tool name parameter")
	}

	name, ok := nameParam.(string)
	if !ok {
		return types.RpcResponse{}, fmt.Errorf("tool name must be a string")
	}

	// Get the tool arguments
	argsParam, ok := params["args"]
	if !ok {
		return types.RpcResponse{}, fmt.Errorf("missing args parameter")
	}

	// Convert arguments to the correct format
	var args map[string]interface{}

	// Handle different ways the args might be passed
	switch v := argsParam.(type) {
	case map[string]interface{}:
		args = v
	case string:
		// Try to parse JSON string
		if err := json.Unmarshal([]byte(v), &args); err != nil {
			return types.RpcResponse{}, fmt.Errorf("invalid args JSON: %w", err)
		}
	default:
		// Try to marshal and unmarshal to convert the type
		jsonBytes, err := json.Marshal(argsParam)
		if err != nil {
			return types.RpcResponse{}, fmt.Errorf("could not convert args: %w", err)
		}

		if err := json.Unmarshal(jsonBytes, &args); err != nil {
			return types.RpcResponse{}, fmt.Errorf("could not parse args: %w", err)
		}
	}

	// Find the tool
	tool, exists := s.tools[name]
	if !exists {
		return types.RpcResponse{
			Error: &types.ErrorInfo{
				Code:    404,
				Message: fmt.Sprintf("Tool not found: %s", name),
			},
		}, nil
	}

	// Execute the tool
	result, err := tool.Execute(args)
	if err != nil {
		return types.RpcResponse{
			Error: &types.ErrorInfo{
				Code:    500,
				Message: fmt.Sprintf("Tool execution error: %s", err.Error()),
			},
		}, nil
	}

	return types.RpcResponse{
		Result: result,
	}, nil
}
