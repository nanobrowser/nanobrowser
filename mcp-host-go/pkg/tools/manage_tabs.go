package tools

import (
	"fmt"

	"github.com/algonius/algonius-browser/mcp-host-go/pkg/logger"
	"github.com/algonius/algonius-browser/mcp-host-go/pkg/types"
	"go.uber.org/zap"
)

// ManageTabsTool implements a tool for managing browser tabs
type ManageTabsTool struct {
	name        string
	description string
	logger      logger.Logger
	messaging   types.Messaging
}

// ManageTabsConfig contains configuration for ManageTabsTool
type ManageTabsConfig struct {
	Logger    logger.Logger
	Messaging types.Messaging
}

// NewManageTabsTool creates a new ManageTabsTool
func NewManageTabsTool(config ManageTabsConfig) (*ManageTabsTool, error) {
	if config.Logger == nil {
		return nil, fmt.Errorf("logger is required")
	}

	if config.Messaging == nil {
		return nil, fmt.Errorf("messaging is required")
	}

	return &ManageTabsTool{
		name:        "manage_tabs",
		description: "Manage browser tabs - switch, open, and close operations",
		logger:      config.Logger,
		messaging:   config.Messaging,
	}, nil
}

// GetName returns the tool name
func (t *ManageTabsTool) GetName() string {
	return t.name
}

// GetDescription returns the tool description
func (t *ManageTabsTool) GetDescription() string {
	return t.description
}

// GetInputSchema returns the tool input schema
func (t *ManageTabsTool) GetInputSchema() interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"action": map[string]interface{}{
				"type":        "string",
				"enum":        []string{"switch", "open", "close"},
				"description": "The tab operation to perform",
			},
			"tab_id": map[string]interface{}{
				"type":        "string",
				"description": "Target tab ID (required for switch and close actions)",
			},
			"url": map[string]interface{}{
				"type":        "string",
				"description": "URL to open (required for open action)",
			},
			"background": map[string]interface{}{
				"type":        "boolean",
				"default":     false,
				"description": "Open tab in background without switching focus (for open action)",
			},
		},
		"required":             []string{"action"},
		"additionalProperties": false,
	}
}

// Execute executes the manage_tabs tool
func (t *ManageTabsTool) Execute(args map[string]interface{}) (types.ToolResult, error) {
	t.logger.Info("Executing manage_tabs tool with args:", zap.Any("args", args))

	// Extract action from arguments
	action, ok := args["action"].(string)
	if !ok || action == "" {
		return types.ToolResult{}, fmt.Errorf("action is required and must be a string")
	}

	// Validate action
	validActions := map[string]bool{"switch": true, "open": true, "close": true}
	if !validActions[action] {
		return types.ToolResult{}, fmt.Errorf("invalid action: %s. Must be one of: switch, open, close", action)
	}

	// Route to appropriate handler based on action
	switch action {
	case "switch":
		return t.handleSwitchTab(args)
	case "open":
		return t.handleOpenTab(args)
	case "close":
		return t.handleCloseTab(args)
	default:
		return types.ToolResult{}, fmt.Errorf("unsupported action: %s", action)
	}
}

// handleSwitchTab handles switching to a specific tab
func (t *ManageTabsTool) handleSwitchTab(args map[string]interface{}) (types.ToolResult, error) {
	// Extract tab_id
	tabID, ok := args["tab_id"].(string)
	if !ok || tabID == "" {
		return types.ToolResult{}, fmt.Errorf("tab_id is required for switch action")
	}

	t.logger.Info("Switching to tab", zap.String("tab_id", tabID))

	// Send RPC request to the extension
	resp, err := t.messaging.RpcRequest(types.RpcRequest{
		Method: "manage_tabs",
		Params: map[string]interface{}{
			"action": "switch",
			"tab_id": tabID,
		},
	}, types.RpcOptions{Timeout: 15000}) // 15 second timeout

	if err != nil {
		t.logger.Error("Error calling manage_tabs (switch)", zap.Error(err))
		return types.ToolResult{}, fmt.Errorf("manage_tabs (switch) RPC failed: %w", err)
	}

	if resp.Error != nil {
		t.logger.Error("RPC error in manage_tabs (switch)", zap.Any("respError", resp.Error))
		return types.ToolResult{}, fmt.Errorf("RPC error: %s", resp.Error.Message)
	}

	// Return enhanced result
	return types.ToolResult{
		Content: []types.ToolResultItem{
			{
				Type: "text",
				Text: fmt.Sprintf("Successfully switched to tab %s", tabID),
			},
		},
	}, nil
}

// handleOpenTab handles opening a new tab
func (t *ManageTabsTool) handleOpenTab(args map[string]interface{}) (types.ToolResult, error) {
	// Extract url
	url, ok := args["url"].(string)
	if !ok || url == "" {
		return types.ToolResult{}, fmt.Errorf("url is required for open action")
	}

	// Extract background flag (optional, defaults to false)
	background := false
	if backgroundArg, exists := args["background"]; exists {
		if backgroundBool, ok := backgroundArg.(bool); ok {
			background = backgroundBool
		}
	}

	t.logger.Info("Opening new tab", zap.String("url", url), zap.Bool("background", background))

	// Send RPC request to the extension
	resp, err := t.messaging.RpcRequest(types.RpcRequest{
		Method: "manage_tabs",
		Params: map[string]interface{}{
			"action":     "open",
			"url":        url,
			"background": background,
		},
	}, types.RpcOptions{Timeout: 30000}) // 30 second timeout for navigation

	if err != nil {
		t.logger.Error("Error calling manage_tabs (open)", zap.Error(err))
		return types.ToolResult{}, fmt.Errorf("manage_tabs (open) RPC failed: %w", err)
	}

	if resp.Error != nil {
		t.logger.Error("RPC error in manage_tabs (open)", zap.Any("respError", resp.Error))
		return types.ToolResult{}, fmt.Errorf("RPC error: %s", resp.Error.Message)
	}

	// Extract result data
	result, ok := resp.Result.(map[string]interface{})
	if !ok {
		return types.ToolResult{}, fmt.Errorf("invalid response format from manage_tabs (open)")
	}

	// Extract new tab ID if available
	newTabID := "unknown"
	if tabID, exists := result["new_tab_id"]; exists {
		if tabIDStr, ok := tabID.(string); ok {
			newTabID = tabIDStr
		}
	}

	backgroundStr := "foreground"
	if background {
		backgroundStr = "background"
	}

	// Return enhanced result
	return types.ToolResult{
		Content: []types.ToolResultItem{
			{
				Type: "text",
				Text: fmt.Sprintf("Successfully opened new tab (%s) with URL: %s (Tab ID: %s)", backgroundStr, url, newTabID),
			},
		},
	}, nil
}

// handleCloseTab handles closing a specific tab
func (t *ManageTabsTool) handleCloseTab(args map[string]interface{}) (types.ToolResult, error) {
	// Extract tab_id
	tabID, ok := args["tab_id"].(string)
	if !ok || tabID == "" {
		return types.ToolResult{}, fmt.Errorf("tab_id is required for close action")
	}

	t.logger.Info("Closing tab", zap.String("tab_id", tabID))

	// Send RPC request to the extension
	resp, err := t.messaging.RpcRequest(types.RpcRequest{
		Method: "manage_tabs",
		Params: map[string]interface{}{
			"action": "close",
			"tab_id": tabID,
		},
	}, types.RpcOptions{Timeout: 10000}) // 10 second timeout

	if err != nil {
		t.logger.Error("Error calling manage_tabs (close)", zap.Error(err))
		return types.ToolResult{}, fmt.Errorf("manage_tabs (close) RPC failed: %w", err)
	}

	if resp.Error != nil {
		t.logger.Error("RPC error in manage_tabs (close)", zap.Any("respError", resp.Error))
		return types.ToolResult{}, fmt.Errorf("RPC error: %s", resp.Error.Message)
	}

	// Return enhanced result
	return types.ToolResult{
		Content: []types.ToolResultItem{
			{
				Type: "text",
				Text: fmt.Sprintf("Successfully closed tab %s", tabID),
			},
		},
	}, nil
}
