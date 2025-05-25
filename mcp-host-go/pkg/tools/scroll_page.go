package tools

import (
	"fmt"

	"github.com/algonius/algonius-browser/mcp-host-go/pkg/logger"
	"github.com/algonius/algonius-browser/mcp-host-go/pkg/types"
	"go.uber.org/zap"
)

// ScrollPageTool implements a tool for scrolling browser pages
type ScrollPageTool struct {
	name        string
	description string
	logger      logger.Logger
	messaging   types.Messaging
}

// ScrollPageConfig contains configuration for ScrollPageTool
type ScrollPageConfig struct {
	Logger    logger.Logger
	Messaging types.Messaging
}

// NewScrollPageTool creates a new ScrollPageTool
func NewScrollPageTool(config ScrollPageConfig) (*ScrollPageTool, error) {
	if config.Logger == nil {
		return nil, fmt.Errorf("logger is required")
	}

	if config.Messaging == nil {
		return nil, fmt.Errorf("messaging is required")
	}

	return &ScrollPageTool{
		name:        "scroll_page",
		description: "Scroll the browser page in various directions or to specific positions",
		logger:      config.Logger,
		messaging:   config.Messaging,
	}, nil
}

// GetName returns the tool name
func (t *ScrollPageTool) GetName() string {
	return t.name
}

// GetDescription returns the tool description
func (t *ScrollPageTool) GetDescription() string {
	return t.description
}

// GetInputSchema returns the tool input schema
func (t *ScrollPageTool) GetInputSchema() interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"action": map[string]interface{}{
				"type":        "string",
				"enum":        []string{"up", "down", "to_element", "to_top", "to_bottom"},
				"description": "Type of scroll action to perform",
			},
			"pixels": map[string]interface{}{
				"type":        "number",
				"description": "Number of pixels to scroll (only for 'up' and 'down' actions)",
				"default":     600,
			},
			"element_index": map[string]interface{}{
				"type":        "number",
				"description": "Index of the element to scroll to (only for 'to_element' action)",
			},
		},
		"required":             []string{"action"},
		"additionalProperties": false,
	}
}

// Execute executes the scroll_page tool
func (t *ScrollPageTool) Execute(args map[string]interface{}) (types.ToolResult, error) {
	t.logger.Info("Executing scroll_page tool with args:", zap.Any("args", args))

	// Extract action from arguments
	action, ok := args["action"].(string)
	if !ok || action == "" {
		return types.ToolResult{}, fmt.Errorf("action is required and must be a string")
	}

	// Validate action
	validActions := map[string]bool{
		"up":         true,
		"down":       true,
		"to_element": true,
		"to_top":     true,
		"to_bottom":  true,
	}
	if !validActions[action] {
		return types.ToolResult{}, fmt.Errorf("invalid action: %s. Valid actions are: up, down, to_element, to_top, to_bottom", action)
	}

	// Prepare RPC parameters
	rpcParams := map[string]interface{}{
		"action": action,
	}

	// Handle action-specific parameters
	switch action {
	case "up", "down":
		// Extract pixels parameter with default value
		pixels := 300.0 // default value
		if pixelsArg, exists := args["pixels"]; exists {
			if pixelsVal, ok := pixelsArg.(float64); ok {
				pixels = pixelsVal
			} else {
				return types.ToolResult{}, fmt.Errorf("pixels must be a number")
			}
		}
		rpcParams["pixels"] = pixels

	case "to_element":
		// Extract element_index parameter (required for this action)
		elementIndex, exists := args["element_index"]
		if !exists {
			return types.ToolResult{}, fmt.Errorf("element_index is required for 'to_element' action")
		}
		if elementIndexVal, ok := elementIndex.(float64); ok {
			rpcParams["element_index"] = int(elementIndexVal)
		} else {
			return types.ToolResult{}, fmt.Errorf("element_index must be a number")
		}

	case "to_top", "to_bottom":
		// No additional parameters needed for these actions
	}

	// Send RPC request to the extension
	resp, err := t.messaging.RpcRequest(types.RpcRequest{
		Method: "scroll_page",
		Params: rpcParams,
	}, types.RpcOptions{Timeout: 10000})

	if err != nil {
		t.logger.Error("Error calling scroll_page", zap.Error(err))
		return types.ToolResult{}, fmt.Errorf("scroll_page RPC failed: %w", err)
	}

	if resp.Error != nil {
		t.logger.Error("RPC error in scroll_page", zap.Any("respError", resp.Error))
		return types.ToolResult{}, fmt.Errorf("RPC error: %s", resp.Error.Message)
	}

	// Create success message based on action
	var message string
	switch action {
	case "up":
		pixels := rpcParams["pixels"].(float64)
		message = fmt.Sprintf("Scrolled up %v pixels", pixels)
	case "down":
		pixels := rpcParams["pixels"].(float64)
		message = fmt.Sprintf("Scrolled down %v pixels", pixels)
	case "to_element":
		elementIndex := rpcParams["element_index"].(int)
		message = fmt.Sprintf("Scrolled to element at index %d", elementIndex)
	case "to_top":
		message = "Scrolled to top of page"
	case "to_bottom":
		message = "Scrolled to bottom of page"
	}

	// Return success result
	return types.ToolResult{
		Content: []types.ToolResultItem{
			{
				Type: "text",
				Text: message,
			},
		},
	}, nil
}
