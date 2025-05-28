package tools

import (
	"fmt"
	"strconv"

	"github.com/algonius/algonius-browser/mcp-host-go/pkg/logger"
	"github.com/algonius/algonius-browser/mcp-host-go/pkg/types"
	"go.uber.org/zap"
)

// NavigateToTool implements a tool for navigating to URLs
type NavigateToTool struct {
	name        string
	description string
	logger      logger.Logger
	messaging   types.Messaging
}

// NavigateToConfig contains configuration for NavigateToTool
type NavigateToConfig struct {
	Logger    logger.Logger
	Messaging types.Messaging
}

// NewNavigateToTool creates a new NavigateToTool
func NewNavigateToTool(config NavigateToConfig) (*NavigateToTool, error) {
	if config.Logger == nil {
		return nil, fmt.Errorf("logger is required")
	}

	if config.Messaging == nil {
		return nil, fmt.Errorf("messaging is required")
	}

	return &NavigateToTool{
		name:        "navigate_to",
		description: "Navigate to a specified URL",
		logger:      config.Logger,
		messaging:   config.Messaging,
	}, nil
}

// GetName returns the tool name
func (t *NavigateToTool) GetName() string {
	return t.name
}

// GetDescription returns the tool description
func (t *NavigateToTool) GetDescription() string {
	return t.description
}

// GetInputSchema returns the tool input schema
func (t *NavigateToTool) GetInputSchema() interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"url": map[string]interface{}{
				"type":        "string",
				"description": "URL to navigate to",
			},
			"timeout": map[string]interface{}{
				"type":        "string",
				"description": "Navigation timeout: 'auto' for intelligent detection or timeout in milliseconds (e.g. '5000')",
				"default":     "auto",
			},
		},
		"required":             []string{"url"},
		"additionalProperties": false,
	}
}

// Execute executes the navigate_to tool
func (t *NavigateToTool) Execute(args map[string]interface{}) (types.ToolResult, error) {
	t.logger.Info("Executing navigate_to tool with args:", zap.Any("args", args))

	// Extract URL from arguments
	url, ok := args["url"].(string)
	if !ok || url == "" {
		return types.ToolResult{}, fmt.Errorf("url is required and must be a string")
	}

	// Handle timeout parameter
	timeoutStr := "auto" // default value
	if timeoutArg, ok := args["timeout"].(string); ok {
		timeoutStr = timeoutArg
	}

	// Parse timeout value
	var rpcTimeout int
	if timeoutStr == "auto" {
		rpcTimeout = 30000 // auto mode uses 30 seconds timeout
	} else {
		// Try to parse as number (milliseconds)
		if parsedTimeout, err := strconv.Atoi(timeoutStr); err == nil {
			if parsedTimeout < 1000 || parsedTimeout > 120000 {
				return types.ToolResult{}, fmt.Errorf("timeout must be between 1000 and 120000 milliseconds")
			}
			rpcTimeout = parsedTimeout
		} else {
			return types.ToolResult{}, fmt.Errorf("timeout must be 'auto' or a timeout in milliseconds")
		}
	}

	t.logger.Info("Navigate to URL with timeout", zap.String("url", url), zap.String("timeout", timeoutStr), zap.Int("rpcTimeout", rpcTimeout))

	// Send RPC request to the extension
	resp, err := t.messaging.RpcRequest(types.RpcRequest{
		Method: "navigate_to",
		Params: map[string]interface{}{
			"url":     url,
			"timeout": timeoutStr,
		},
	}, types.RpcOptions{Timeout: rpcTimeout + 5000}) // Add 5 seconds buffer for RPC timeout

	if err != nil {
		t.logger.Error("Error calling navigate_to", zap.Error(err))
		return types.ToolResult{}, fmt.Errorf("navigate_to RPC failed: %w", err)
	}

	if resp.Error != nil {
		t.logger.Error("RPC error in navigate_to", zap.Any("respError", resp.Error))
		return types.ToolResult{}, fmt.Errorf("RPC error: %s", resp.Error.Message)
	}

	// Return enhanced result
	return types.ToolResult{
		Content: []types.ToolResultItem{
			{
				Type: "text",
				Text: fmt.Sprintf("Successfully navigated to %s (strategy: %s)", url, timeoutStr),
			},
		},
	}, nil
}
