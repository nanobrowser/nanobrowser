package types

import (
	"github.com/algonius/algonius-browser/mcp-host-go/pkg/logger"
)

// Message represents a message exchanged with the Chrome extension
type Message struct {
	Type string      `json:"type"`
	Data interface{} `json:"data,omitempty"`
	ID   string      `json:"id,omitempty"`
	// Additional fields for specific message types
	Method string      `json:"method,omitempty"`
	Params interface{} `json:"params,omitempty"`
	Result interface{} `json:"result,omitempty"`
	Error  *ErrorInfo  `json:"error,omitempty"`
}

// ErrorInfo represents error information in JSON-RPC format
type ErrorInfo struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

// RpcRequest represents a JSON-RPC request
type RpcRequest struct {
	ID     string      `json:"id,omitempty"`
	Method string      `json:"method"`
	Params interface{} `json:"params,omitempty"`
}

// RpcResponse represents a JSON-RPC response
type RpcResponse struct {
	ID     string      `json:"id,omitempty"`
	Result interface{} `json:"result,omitempty"`
	Error  *ErrorInfo  `json:"error,omitempty"`
}

// RpcOptions represents options for RPC requests
type RpcOptions struct {
	Timeout int // Timeout in milliseconds
}

// BrowserState represents the state of the browser
type BrowserState struct {
	ActiveTab *TabInfo   `json:"activeTab,omitempty"`
	Tabs      []*TabInfo `json:"tabs,omitempty"`
}

// TabInfo represents information about a browser tab
type TabInfo struct {
	ID       int         `json:"id,omitempty"`
	URL      string      `json:"url,omitempty"`
	Title    string      `json:"title,omitempty"`
	Active   bool        `json:"active,omitempty"`
	DOMState interface{} `json:"domState,omitempty"`
}

// ActionResult represents the result of executing a browser action
type ActionResult struct {
	Success bool        `json:"success"`
	Message string      `json:"message,omitempty"`
	Data    interface{} `json:"data,omitempty"`
}

// HostInfo represents information about the MCP host
type HostInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	RunMode string `json:"runMode"`
}

// HostStatus represents the status of the MCP host
type HostStatus struct {
	HostInfo
	IsConnected bool  `json:"isConnected"`
	StartTime   int64 `json:"startTime"`
	LastPing    int64 `json:"lastPing"`
}

// MessageHandler is a function that handles a message
type MessageHandler func(data interface{}) error

// RpcHandler is a function that handles an RPC request
type RpcHandler func(request RpcRequest) (RpcResponse, error)

// Interfaces for dependency injection

// Messaging defines the interface for native messaging communication
type Messaging interface {
	RegisterHandler(messageType string, handler MessageHandler)
	RegisterRpcMethod(method string, handler RpcHandler)
	SendMessage(message Message) error
	RpcRequest(request RpcRequest, options RpcOptions) (RpcResponse, error)
	Start() error
}

// Resource defines the interface for MCP resources
type Resource interface {
	GetURI() string
	GetName() string
	GetMimeType() string
	GetDescription() string
	Read() (ResourceContent, error)
	ReadWithArguments(uri string, arguments map[string]any) (ResourceContent, error)
	NotifyStateChange(state interface{})
}

// ResourceContent represents the content of an MCP resource
type ResourceContent struct {
	Contents []ResourceItem `json:"contents"`
}

// ResourceItem represents a single item in a resource content
type ResourceItem struct {
	URI      string `json:"uri"`
	MimeType string `json:"mimeType"`
	Text     string `json:"text"`
}

// Tool defines the interface for MCP tools
type Tool interface {
	GetName() string
	GetDescription() string
	GetInputSchema() interface{}
	Execute(args map[string]interface{}) (ToolResult, error)
}

// ToolResult represents the result of executing a tool
type ToolResult struct {
	Content []ToolResultItem `json:"content"`
}

// ToolResultItem represents a single item in a tool result
type ToolResultItem struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// McpServer defines the interface for the MCP server
type McpServer interface {
	RegisterResource(resource Resource) error
	RegisterTool(tool Tool) error
	Start() error
	Shutdown() error
	IsRunning() bool
}

// AppDependencies contains all the dependencies needed for the application
type AppDependencies struct {
	Logger    logger.Logger
	Messaging Messaging
	McpServer McpServer
}
