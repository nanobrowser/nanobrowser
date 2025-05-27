package tools

import (
	"fmt"
	"time"

	"github.com/algonius/algonius-browser/mcp-host-go/pkg/logger"
	"github.com/algonius/algonius-browser/mcp-host-go/pkg/types"
	"go.uber.org/zap"
)

// SetValueTool implements a tool for setting values on interactive elements
type SetValueTool struct {
	name        string
	description string
	logger      logger.Logger
	messaging   types.Messaging
}

// SetValueConfig contains configuration for SetValueTool
type SetValueConfig struct {
	Logger    logger.Logger
	Messaging types.Messaging
}

// NewSetValueTool creates a new SetValueTool
func NewSetValueTool(config SetValueConfig) (*SetValueTool, error) {
	if config.Logger == nil {
		return nil, fmt.Errorf("logger is required")
	}

	if config.Messaging == nil {
		return nil, fmt.Errorf("messaging is required")
	}

	return &SetValueTool{
		name:        "set_value",
		description: "Set values on interactive elements (text inputs, selects, checkboxes, etc.) using flexible targeting",
		logger:      config.Logger,
		messaging:   config.Messaging,
	}, nil
}

// GetName returns the tool name
func (t *SetValueTool) GetName() string {
	return t.name
}

// GetDescription returns the tool description
func (t *SetValueTool) GetDescription() string {
	return t.description
}

// GetInputSchema returns the tool input schema
func (t *SetValueTool) GetInputSchema() interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"target": map[string]interface{}{
				"oneOf": []map[string]interface{}{
					{
						"type":        "number",
						"description": "Element index from DOM state",
						"minimum":     0,
					},
					{
						"type":        "string",
						"description": "Element description, label text, or identifier",
						"minLength":   1,
					},
				},
				"description": "Target element (index or text description)",
			},
			"value": map[string]interface{}{
				"description": "Value to set (string, number, boolean, or array for multi-select)",
			},
			"options": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"clear_first": map[string]interface{}{
						"type":        "boolean",
						"description": "Whether to clear existing content first",
						"default":     true,
					},
					"submit": map[string]interface{}{
						"type":        "boolean",
						"description": "Whether to submit form after setting value",
						"default":     false,
					},
					"wait_after": map[string]interface{}{
						"type":        "number",
						"description": "Time to wait after setting value (seconds)",
						"minimum":     0,
						"maximum":     30,
						"default":     1,
					},
				},
				"additionalProperties": false,
			},
		},
		"required":             []string{"target", "value"},
		"additionalProperties": false,
	}
}

// Execute executes the set_value tool
func (t *SetValueTool) Execute(args map[string]interface{}) (types.ToolResult, error) {
	startTime := time.Now()
	t.logger.Info("Executing set_value tool", zap.Any("args", args))

	// Extract and validate target
	targetArg, exists := args["target"]
	if !exists {
		return types.ToolResult{}, fmt.Errorf("target is required")
	}

	// Extract and validate value
	valueArg, exists := args["value"]
	if !exists {
		return types.ToolResult{}, fmt.Errorf("value is required")
	}

	// Extract options with defaults
	options := map[string]interface{}{
		"clear_first": true,
		"submit":      false,
		"wait_after":  1.0,
	}

	if optionsArg, exists := args["options"]; exists {
		if optionsMap, ok := optionsArg.(map[string]interface{}); ok {
			// Merge user options with defaults
			for key, value := range optionsMap {
				switch key {
				case "clear_first":
					if boolVal, ok := value.(bool); ok {
						options[key] = boolVal
					} else {
						return types.ToolResult{}, fmt.Errorf("options.clear_first must be a boolean")
					}
				case "submit":
					if boolVal, ok := value.(bool); ok {
						options[key] = boolVal
					} else {
						return types.ToolResult{}, fmt.Errorf("options.submit must be a boolean")
					}
				case "wait_after":
					if floatVal, ok := value.(float64); ok {
						if floatVal < 0 || floatVal > 30 {
							return types.ToolResult{}, fmt.Errorf("options.wait_after must be between 0 and 30 seconds")
						}
						options[key] = floatVal
					} else {
						return types.ToolResult{}, fmt.Errorf("options.wait_after must be a number")
					}
				default:
					return types.ToolResult{}, fmt.Errorf("unknown option: %s", key)
				}
			}
		} else {
			return types.ToolResult{}, fmt.Errorf("options must be an object")
		}
	}

	// Validate target parameter
	var targetType string
	switch target := targetArg.(type) {
	case float64:
		if target < 0 {
			return types.ToolResult{}, fmt.Errorf("target index must be non-negative")
		}
		targetType = "index"
	case int:
		if target < 0 {
			return types.ToolResult{}, fmt.Errorf("target index must be non-negative")
		}
		targetType = "index"
	case string:
		if len(target) == 0 {
			return types.ToolResult{}, fmt.Errorf("target description cannot be empty")
		}
		targetType = "description"
	default:
		return types.ToolResult{}, fmt.Errorf("target must be a number (index) or string (description)")
	}

	// Prepare RPC parameters
	rpcParams := map[string]interface{}{
		"target":      targetArg,
		"value":       valueArg,
		"options":     options,
		"target_type": targetType,
	}

	t.logger.Debug("Sending set_value RPC request",
		zap.Any("target", targetArg),
		zap.String("target_type", targetType),
		zap.Any("value", valueArg),
		zap.Any("options", options))

	// Send RPC request to the extension
	resp, err := t.messaging.RpcRequest(types.RpcRequest{
		Method: "set_value",
		Params: rpcParams,
	}, types.RpcOptions{Timeout: 15000}) // 15 second timeout

	if err != nil {
		executionTime := time.Since(startTime).Seconds()
		t.logger.Error("Error calling set_value RPC", zap.Error(err), zap.Float64("execution_time", executionTime))
		return types.ToolResult{}, fmt.Errorf("set_value RPC failed: %w", err)
	}

	if resp.Error != nil {
		executionTime := time.Since(startTime).Seconds()
		t.logger.Error("RPC error in set_value",
			zap.Any("rpc_error", resp.Error),
			zap.Float64("execution_time", executionTime))
		return types.ToolResult{}, fmt.Errorf("RPC error: %s", resp.Error.Message)
	}

	executionTime := time.Since(startTime).Seconds()

	// Parse response data
	var resultData map[string]interface{}
	if resp.Result != nil {
		if data, ok := resp.Result.(map[string]interface{}); ok {
			resultData = data
		}
	}

	// Check if the operation was successful
	success := false
	if successVal, exists := resultData["success"]; exists {
		if successBool, ok := successVal.(bool); ok {
			success = successBool
		}
	}

	if !success {
		// Handle failure case
		message := fmt.Sprintf("Failed to set value on target: %v", targetArg)
		if msgVal, exists := resultData["message"]; exists {
			if msgStr, ok := msgVal.(string); ok {
				message = msgStr
			}
		}

		errorCode := "SET_VALUE_FAILED"
		if codeVal, exists := resultData["error_code"]; exists {
			if codeStr, ok := codeVal.(string); ok {
				errorCode = codeStr
			}
		}

		t.logger.Warn("Set value failed",
			zap.Any("target", targetArg),
			zap.String("error_code", errorCode),
			zap.String("message", message),
			zap.Float64("execution_time", executionTime))

		return types.ToolResult{}, fmt.Errorf("%s (%s)", message, errorCode)
	}

	// Handle success case
	message := fmt.Sprintf("Successfully set value on target: %v", targetArg)
	if msgVal, exists := resultData["message"]; exists {
		if msgStr, ok := msgVal.(string); ok {
			message = msgStr
		}
	}

	// Extract additional result information
	var elementInfo map[string]interface{}
	if infoVal, exists := resultData["element_info"]; exists {
		if info, ok := infoVal.(map[string]interface{}); ok {
			elementInfo = info
		}
	}

	var actualValue interface{}
	if valueVal, exists := resultData["actual_value"]; exists {
		actualValue = valueVal
	}

	var elementType string
	if typeVal, exists := resultData["element_type"]; exists {
		if typeStr, ok := typeVal.(string); ok {
			elementType = typeStr
		}
	}

	var inputMethod string
	if methodVal, exists := resultData["input_method"]; exists {
		if methodStr, ok := methodVal.(string); ok {
			inputMethod = methodStr
		}
	}

	var elementIndex interface{}
	if indexVal, exists := resultData["element_index"]; exists {
		elementIndex = indexVal
	}

	t.logger.Info("Set value successful",
		zap.Any("target", targetArg),
		zap.String("element_type", elementType),
		zap.String("input_method", inputMethod),
		zap.Any("actual_value", actualValue),
		zap.Any("element_index", elementIndex),
		zap.Float64("execution_time", executionTime))

	// Create detailed success response
	responseText := fmt.Sprintf(`Set Value Result:
- Status: Success
- Message: %s
- Target: %v
- Value Set: %v
- Element Type: %s
- Input Method: %s
- Execution Time: %.2f seconds`, message, targetArg, actualValue, elementType, inputMethod, executionTime)

	if elementIndex != nil {
		responseText += fmt.Sprintf("\n- Element Index: %v", elementIndex)
	}

	if elementInfo != nil {
		if text, exists := elementInfo["text"]; exists && text != nil && text != "" {
			responseText += fmt.Sprintf("\n- Element Text: %v", text)
		}
		if tagName, exists := elementInfo["tag_name"]; exists {
			responseText += fmt.Sprintf("\n- Element Tag: %v", tagName)
		}
		if placeholder, exists := elementInfo["placeholder"]; exists && placeholder != nil && placeholder != "" {
			responseText += fmt.Sprintf("\n- Placeholder: %v", placeholder)
		}
	}

	return types.ToolResult{
		Content: []types.ToolResultItem{
			{
				Type: "text",
				Text: responseText,
			},
		},
	}, nil
}
