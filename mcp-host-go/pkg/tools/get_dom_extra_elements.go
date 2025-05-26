package tools

import (
	"encoding/json"
	"fmt"

	"github.com/algonius/algonius-browser/mcp-host-go/pkg/logger"
	"github.com/algonius/algonius-browser/mcp-host-go/pkg/types"
	"go.uber.org/zap"
)

// GetDomExtraElementsTool implements the get_dom_extra_elements MCP tool
type GetDomExtraElementsTool struct {
	logger    logger.Logger
	messaging types.Messaging
}

// GetDomExtraElementsConfig contains configuration for GetDomExtraElementsTool
type GetDomExtraElementsConfig struct {
	Logger    logger.Logger
	Messaging types.Messaging
}

// NewGetDomExtraElementsTool creates a new GetDomExtraElementsTool
func NewGetDomExtraElementsTool(config GetDomExtraElementsConfig) (*GetDomExtraElementsTool, error) {
	if config.Logger == nil {
		return nil, fmt.Errorf("logger is required")
	}

	if config.Messaging == nil {
		return nil, fmt.Errorf("messaging is required")
	}

	return &GetDomExtraElementsTool{
		logger:    config.Logger,
		messaging: config.Messaging,
	}, nil
}

// GetName returns the tool name
func (t *GetDomExtraElementsTool) GetName() string {
	return "get_dom_extra_elements"
}

// GetDescription returns the tool description
func (t *GetDomExtraElementsTool) GetDescription() string {
	return `Get additional DOM interactive elements beyond the overview with pagination and filtering options.

This tool provides access to all interactive elements on the page with advanced options:
• Pagination: Navigate through pages of elements
• Filtering: Filter by element type (button, input, link, select, textarea, all)
• Flexible access: Get specific ranges or pages of elements

Use this tool when the DOM state overview (browser://dom/state) indicates there are more than 20 interactive elements available.`
}

// GetInputSchema returns the tool input schema
func (t *GetDomExtraElementsTool) GetInputSchema() interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"page": map[string]interface{}{
				"type":        "integer",
				"description": "Page number for pagination (default: 1, min: 1)",
				"minimum":     1,
				"default":     1,
			},
			"pageSize": map[string]interface{}{
				"type":        "integer",
				"description": "Number of elements per page (default: 20, max: 100)",
				"minimum":     1,
				"maximum":     100,
				"default":     20,
			},
			"elementType": map[string]interface{}{
				"type":        "string",
				"description": "Filter by element type (default: all)",
				"enum":        []string{"button", "input", "link", "select", "textarea", "all"},
				"default":     "all",
			},
			"startIndex": map[string]interface{}{
				"type":        "integer",
				"description": "Optional: Start from specific element index (1-based, overrides page parameter)",
				"minimum":     1,
			},
		},
		"additionalProperties": false,
	}
}

// Execute executes the get_dom_extra_elements tool
func (t *GetDomExtraElementsTool) Execute(arguments map[string]interface{}) (types.ToolResult, error) {
	t.logger.Debug("Executing get_dom_extra_elements tool", zap.Any("arguments", arguments))

	// Parse and validate parameters
	params, err := t.parseArguments(arguments)
	if err != nil {
		t.logger.Error("Invalid arguments for get_dom_extra_elements", zap.Error(err))
		return types.ToolResult{}, fmt.Errorf("invalid arguments: %w", err)
	}

	t.logger.Debug("Parsed parameters", zap.Any("params", params))

	// Request DOM state from the extension
	resp, err := t.messaging.RpcRequest(types.RpcRequest{
		Method: "get_dom_state",
	}, types.RpcOptions{Timeout: 5000})

	if err != nil {
		t.logger.Error("Error requesting DOM state for extra elements", zap.Error(err))
		return types.ToolResult{}, fmt.Errorf("failed to request DOM state: %w", err)
	}

	if resp.Error != nil {
		t.logger.Error("RPC error getting DOM state for extra elements", zap.Any("respError", resp.Error))
		return types.ToolResult{}, fmt.Errorf("RPC error: %s", resp.Error.Message)
	}

	// Parse the raw DOM state data
	var domStateData DomStateData
	if err := t.parseResponseToStruct(resp.Result, &domStateData); err != nil {
		t.logger.Error("Error parsing DOM state data for extra elements", zap.Error(err))
		return types.ToolResult{}, fmt.Errorf("failed to parse DOM state data: %w", err)
	}

	// Apply pagination and filtering
	result := t.applyPaginationAndFiltering(domStateData, params)

	t.logger.Debug("Successfully retrieved extra DOM elements",
		zap.Int("totalElements", result.Pagination.TotalElements),
		zap.Int("returnedElements", len(result.Elements)),
		zap.Int("currentPage", result.Pagination.CurrentPage))

	// Convert result to JSON string for the ToolResult
	resultJSON, err := json.Marshal(result)
	if err != nil {
		t.logger.Error("Error marshaling result to JSON", zap.Error(err))
		return types.ToolResult{}, fmt.Errorf("failed to marshal result: %w", err)
	}

	return types.ToolResult{
		Content: []types.ToolResultItem{
			{
				Type: "text",
				Text: string(resultJSON),
			},
		},
	}, nil
}

// ExtraElementsParams represents the parsed parameters for the tool
type ExtraElementsParams struct {
	Page        int    // Page number, starting from 1
	PageSize    int    // Number of elements per page
	ElementType string // Element type filter
	StartIndex  int    // Optional: start from specific index (1-based)
}

// DomStateData represents the raw DOM state data from Chrome extension
type DomStateData struct {
	FormattedDom        string                   `json:"formattedDom"`
	InteractiveElements []map[string]interface{} `json:"interactiveElements"`
	Meta                interface{}              `json:"meta"`
}

// ExtraElementsResult represents the result of the extra elements tool
type ExtraElementsResult struct {
	Elements   []map[string]interface{} `json:"elements"`
	Pagination PaginationInfo           `json:"pagination"`
	Filter     *FilterInfo              `json:"filter,omitempty"`
}

// PaginationInfo contains pagination metadata
type PaginationInfo struct {
	CurrentPage     int  `json:"currentPage"`
	PageSize        int  `json:"pageSize"`
	TotalElements   int  `json:"totalElements"`
	TotalPages      int  `json:"totalPages"`
	HasNextPage     bool `json:"hasNextPage"`
	HasPreviousPage bool `json:"hasPreviousPage"`
	StartIndex      int  `json:"startIndex"` // 1-based start index of current page
	EndIndex        int  `json:"endIndex"`   // 1-based end index of current page
}

// FilterInfo contains filter metadata
type FilterInfo struct {
	ElementType string `json:"elementType"`
}

// parseArguments parses and validates the tool arguments
func (t *GetDomExtraElementsTool) parseArguments(arguments map[string]interface{}) (ExtraElementsParams, error) {
	params := ExtraElementsParams{
		Page:        1,     // Default to page 1
		PageSize:    20,    // Default page size
		ElementType: "all", // Default to all elements
	}

	if arguments == nil {
		return params, nil
	}

	// Parse page parameter
	if pageVal, exists := arguments["page"]; exists && pageVal != nil {
		if pageFloat, ok := pageVal.(float64); ok {
			page := int(pageFloat)
			if page < 1 {
				return params, fmt.Errorf("page must be >= 1, got %d", page)
			}
			params.Page = page
		} else {
			return params, fmt.Errorf("page must be an integer, got %T", pageVal)
		}
	}

	// Parse pageSize parameter
	if pageSizeVal, exists := arguments["pageSize"]; exists && pageSizeVal != nil {
		if pageSizeFloat, ok := pageSizeVal.(float64); ok {
			pageSize := int(pageSizeFloat)
			if pageSize < 1 || pageSize > 100 {
				return params, fmt.Errorf("pageSize must be between 1 and 100, got %d", pageSize)
			}
			params.PageSize = pageSize
		} else {
			return params, fmt.Errorf("pageSize must be an integer, got %T", pageSizeVal)
		}
	}

	// Parse elementType parameter
	if elementTypeVal, exists := arguments["elementType"]; exists && elementTypeVal != nil {
		if elementTypeStr, ok := elementTypeVal.(string); ok {
			if !t.isValidElementType(elementTypeStr) {
				return params, fmt.Errorf("invalid elementType: %s, must be one of: button, input, link, select, textarea, all", elementTypeStr)
			}
			params.ElementType = elementTypeStr
		} else {
			return params, fmt.Errorf("elementType must be a string, got %T", elementTypeVal)
		}
	}

	// Parse startIndex parameter (optional)
	if startIndexVal, exists := arguments["startIndex"]; exists && startIndexVal != nil {
		if startIndexFloat, ok := startIndexVal.(float64); ok {
			startIndex := int(startIndexFloat)
			if startIndex < 1 {
				return params, fmt.Errorf("startIndex must be >= 1, got %d", startIndex)
			}
			params.StartIndex = startIndex
		} else {
			return params, fmt.Errorf("startIndex must be an integer, got %T", startIndexVal)
		}
	}

	return params, nil
}

// isValidElementType checks if element type is valid
func (t *GetDomExtraElementsTool) isValidElementType(elementType string) bool {
	validTypes := []string{"button", "input", "link", "select", "textarea", "all"}
	for _, validType := range validTypes {
		if validType == elementType {
			return true
		}
	}
	return false
}

// parseResponseToStruct converts response result to a struct
func (t *GetDomExtraElementsTool) parseResponseToStruct(result interface{}, target interface{}) error {
	// Convert to JSON first, then unmarshal to target struct
	jsonBytes, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("failed to marshal response: %w", err)
	}

	if err := json.Unmarshal(jsonBytes, target); err != nil {
		return fmt.Errorf("failed to unmarshal to target struct: %w", err)
	}

	return nil
}

// applyPaginationAndFiltering applies pagination and filtering to DOM state data
func (t *GetDomExtraElementsTool) applyPaginationAndFiltering(data DomStateData, params ExtraElementsParams) ExtraElementsResult {
	// Start with all interactive elements
	elements := data.InteractiveElements

	// Apply element type filtering if specified and not "all"
	var filterInfo *FilterInfo
	if params.ElementType != "all" {
		filteredElements := make([]map[string]interface{}, 0)
		for _, element := range elements {
			if elementType, exists := element["type"]; exists {
				if typeStr, ok := elementType.(string); ok && typeStr == params.ElementType {
					filteredElements = append(filteredElements, element)
				}
			}
		}
		elements = filteredElements
		filterInfo = &FilterInfo{ElementType: params.ElementType}
	}

	totalElements := len(elements)

	// Handle startIndex parameter - if provided, calculate which page it would be on
	if params.StartIndex > 0 {
		// Convert 1-based startIndex to 0-based and calculate page
		zeroBasedStart := params.StartIndex - 1
		params.Page = (zeroBasedStart / params.PageSize) + 1
	}

	totalPages := t.calculateTotalPages(totalElements, params.PageSize)

	// Ensure page is within valid range
	if params.Page > totalPages && totalPages > 0 {
		params.Page = totalPages
	}

	// Calculate pagination bounds (0-based internally)
	startIndex := (params.Page - 1) * params.PageSize
	endIndex := startIndex + params.PageSize

	// Apply bounds checking
	if startIndex >= totalElements {
		startIndex = totalElements
	}
	if endIndex > totalElements {
		endIndex = totalElements
	}

	// Get paginated elements
	var paginatedElements []map[string]interface{}
	if startIndex < endIndex {
		paginatedElements = elements[startIndex:endIndex]
	} else {
		paginatedElements = make([]map[string]interface{}, 0)
	}

	// Build pagination info (convert back to 1-based for API)
	paginationInfo := PaginationInfo{
		CurrentPage:     params.Page,
		PageSize:        params.PageSize,
		TotalElements:   totalElements,
		TotalPages:      totalPages,
		HasNextPage:     params.Page < totalPages,
		HasPreviousPage: params.Page > 1,
		StartIndex:      startIndex + 1, // Convert to 1-based
		EndIndex:        endIndex,       // Already 1-based (exclusive end)
	}

	return ExtraElementsResult{
		Elements:   paginatedElements,
		Pagination: paginationInfo,
		Filter:     filterInfo,
	}
}

// calculateTotalPages calculates total pages based on total elements and page size
func (t *GetDomExtraElementsTool) calculateTotalPages(totalElements, pageSize int) int {
	if pageSize <= 0 {
		return 0
	}
	// Manual ceiling calculation: (totalElements + pageSize - 1) / pageSize
	return (totalElements + pageSize - 1) / pageSize
}
