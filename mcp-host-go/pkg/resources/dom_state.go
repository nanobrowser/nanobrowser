package resources

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/algonius/algonius-browser/mcp-host-go/pkg/logger"
	"github.com/algonius/algonius-browser/mcp-host-go/pkg/types"
	"go.uber.org/zap"
)

// DomStateResource implements the DOM state resource
type DomStateResource struct {
	uri         string
	name        string
	mimeType    string
	description string
	logger      logger.Logger
	messaging   types.Messaging
}

// DomStateConfig contains configuration for DomStateResource
type DomStateConfig struct {
	Logger    logger.Logger
	Messaging types.Messaging
}

// NewDomStateResource creates a new DomStateResource
func NewDomStateResource(config DomStateConfig) (*DomStateResource, error) {
	if config.Logger == nil {
		return nil, fmt.Errorf("logger is required")
	}

	if config.Messaging == nil {
		return nil, fmt.Errorf("messaging is required")
	}

	return &DomStateResource{
		uri:      "browser://dom/state",
		name:     "DOM State",
		mimeType: "text/markdown",
		description: `Current DOM state with interactive elements and page metadata in AI-friendly Markdown format.

Query Parameters:
• page: Page number for pagination (default: 1, min: 1)
• pageSize: Elements per page (default: 100, max: 1000)
• elementType: Filter by type - button|input|link|select|textarea (default: all)

Examples:
- Default: Returns first 100 elements
- ?page=2&pageSize=50: Second page with 50 elements
- ?elementType=button: Only button elements
- ?page=1&pageSize=20&elementType=input: First 20 input elements

Response includes pagination metadata and filtered results in Markdown format.`,
		logger:    config.Logger,
		messaging: config.Messaging,
	}, nil
}

// GetURI returns the resource URI
func (r *DomStateResource) GetURI() string {
	return r.uri
}

// GetName returns the resource name
func (r *DomStateResource) GetName() string {
	return r.name
}

// GetMimeType returns the resource MIME type
func (r *DomStateResource) GetMimeType() string {
	return r.mimeType
}

// GetDescription returns the resource description
func (r *DomStateResource) GetDescription() string {
	return r.description
}

// Read reads the current DOM state (uses default pagination)
func (r *DomStateResource) Read() (types.ResourceContent, error) {
	return r.ReadWithArguments(r.uri, nil)
}

// ReadWithArguments reads the DOM state with optional pagination parameters
func (r *DomStateResource) ReadWithArguments(uri string, arguments map[string]any) (types.ResourceContent, error) {
	r.logger.Debug("Reading DOM state with arguments", zap.Any("arguments", arguments))

	// Parse pagination parameters from arguments
	params := r.parsePaginationParams(arguments)
	r.logger.Debug("Parsed pagination params", zap.Any("params", params))

	// Request DOM state from the extension
	resp, err := r.messaging.RpcRequest(types.RpcRequest{
		Method: "get_dom_state",
	}, types.RpcOptions{Timeout: 5000})

	if err != nil {
		r.logger.Error("Error requesting DOM state", zap.Error(err))
		return types.ResourceContent{}, fmt.Errorf("failed to request DOM state: %w", err)
	}

	if resp.Error != nil {
		r.logger.Error("RPC error getting DOM state", zap.Any("respError", resp.Error))
		return types.ResourceContent{}, fmt.Errorf("RPC error: %s", resp.Error.Message)
	}

	// Parse the raw DOM state data
	var domStateData DomStateData
	if err := r.parseResponseToStruct(resp.Result, &domStateData); err != nil {
		r.logger.Error("Error parsing DOM state data", zap.Error(err))
		return types.ResourceContent{}, fmt.Errorf("failed to parse DOM state data: %w", err)
	}

	// Apply pagination and filtering
	paginatedState := r.applyPaginationAndFiltering(domStateData, params)

	// Convert to Markdown format
	markdownContent := r.convertToMarkdown(paginatedState)

	r.logger.Debug("Successfully retrieved and paginated DOM state",
		zap.Int("responseSize", len(markdownContent)),
		zap.Int("totalElements", paginatedState.Pagination.TotalElements),
		zap.Int("pageElements", len(paginatedState.InteractiveElements)))

	// Return the paginated DOM state as resource content
	return types.ResourceContent{
		Contents: []types.ResourceItem{
			{
				URI:      uri,
				MimeType: r.mimeType,
				Text:     markdownContent,
			},
		},
	}, nil
}

// NotifyStateChange notifies that the DOM state has changed
func (r *DomStateResource) NotifyStateChange(state interface{}) {
	r.logger.Debug("Notifying DOM state change")

	// Send resource_updated message
	err := r.messaging.SendMessage(types.Message{
		Type: "resource_updated",
		Data: map[string]interface{}{
			"uri":       r.uri,
			"timestamp": getCurrentTimestamp(),
		},
	})

	if err != nil {
		r.logger.Error("Error sending resource_updated message for DOM state", zap.Error(err))
	}
}

// PaginationParams represents pagination parameters
type PaginationParams struct {
	Page        int    // Page number, starting from 1
	PageSize    int    // Number of elements per page
	ElementType string // Element type filter (optional)
}

// DomStateData represents the raw DOM state data from Chrome extension
type DomStateData struct {
	FormattedDom        string                   `json:"formattedDom"`
	InteractiveElements []map[string]interface{} `json:"interactiveElements"`
	Meta                interface{}              `json:"meta"`
}

// PaginatedDomState represents the paginated DOM state
type PaginatedDomState struct {
	FormattedDom        string                   `json:"formattedDom"`
	InteractiveElements []map[string]interface{} `json:"interactiveElements"`
	Meta                interface{}              `json:"meta"`
	Pagination          PaginationInfo           `json:"pagination"`
	Filter              *FilterInfo              `json:"filter,omitempty"`
}

// PaginationInfo contains pagination metadata
type PaginationInfo struct {
	CurrentPage     int  `json:"currentPage"`
	PageSize        int  `json:"pageSize"`
	TotalElements   int  `json:"totalElements"`
	TotalPages      int  `json:"totalPages"`
	HasNextPage     bool `json:"hasNextPage"`
	HasPreviousPage bool `json:"hasPreviousPage"`
}

// FilterInfo contains filter metadata
type FilterInfo struct {
	ElementType *string `json:"elementType,omitempty"`
}

// parsePaginationParams parses pagination parameters from arguments map
func (r *DomStateResource) parsePaginationParams(arguments map[string]any) PaginationParams {
	params := PaginationParams{
		Page:     1,  // Default to page 1
		PageSize: 20, // Default page size
	}

	if arguments == nil {
		return params
	}

	// Parse page parameter
	if pageVal, exists := arguments["page"]; exists {
		if pageStr, ok := pageVal.(string); ok {
			if page, err := strconv.Atoi(pageStr); err == nil && page > 0 {
				params.Page = page
			}
		} else if pageFloat, ok := pageVal.(float64); ok && pageFloat > 0 {
			params.Page = int(pageFloat)
		}
	}

	// Parse pageSize parameter
	if pageSizeVal, exists := arguments["pageSize"]; exists {
		if pageSizeStr, ok := pageSizeVal.(string); ok {
			if pageSize, err := strconv.Atoi(pageSizeStr); err == nil && pageSize > 0 && pageSize <= 1000 {
				params.PageSize = pageSize
			}
		} else if pageSizeFloat, ok := pageSizeVal.(float64); ok && pageSizeFloat > 0 && pageSizeFloat <= 1000 {
			params.PageSize = int(pageSizeFloat)
		}
	}

	// Parse elementType parameter
	if elementTypeVal, exists := arguments["elementType"]; exists {
		if elementTypeStr, ok := elementTypeVal.(string); ok && elementTypeStr != "" {
			params.ElementType = elementTypeStr
		}
	}

	return params
}

// parseResponseToStruct converts response result to a struct
func (r *DomStateResource) parseResponseToStruct(result interface{}, target interface{}) error {
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
func (r *DomStateResource) applyPaginationAndFiltering(data DomStateData, params PaginationParams) PaginatedDomState {
	// Start with all interactive elements
	elements := data.InteractiveElements

	// Apply element type filtering if specified
	var filterInfo *FilterInfo
	if params.ElementType != "" {
		filteredElements := make([]map[string]interface{}, 0)
		for _, element := range elements {
			if elementType, exists := element["type"]; exists {
				if typeStr, ok := elementType.(string); ok && typeStr == params.ElementType {
					filteredElements = append(filteredElements, element)
				}
			}
		}
		elements = filteredElements
		filterInfo = &FilterInfo{ElementType: &params.ElementType}
	}

	totalElements := len(elements)
	totalPages := r.calculateTotalPages(totalElements, params.PageSize)

	// Ensure page is within valid range
	if params.Page > totalPages && totalPages > 0 {
		params.Page = totalPages
	}

	// Calculate pagination bounds
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

	// Build pagination info
	paginationInfo := PaginationInfo{
		CurrentPage:     params.Page,
		PageSize:        params.PageSize,
		TotalElements:   totalElements,
		TotalPages:      totalPages,
		HasNextPage:     params.Page < totalPages,
		HasPreviousPage: params.Page > 1,
	}

	return PaginatedDomState{
		FormattedDom:        data.FormattedDom,
		InteractiveElements: paginatedElements,
		Meta:                data.Meta,
		Pagination:          paginationInfo,
		Filter:              filterInfo,
	}
}

// calculateTotalPages calculates total pages based on total elements and page size
func (r *DomStateResource) calculateTotalPages(totalElements, pageSize int) int {
	if pageSize <= 0 {
		return 0
	}
	// Manual ceiling calculation: (totalElements + pageSize - 1) / pageSize
	return (totalElements + pageSize - 1) / pageSize
}

// convertToMarkdown converts the paginated DOM state to AI-friendly Markdown format
func (r *DomStateResource) convertToMarkdown(state PaginatedDomState) string {
	var builder strings.Builder

	// Header with pagination info
	builder.WriteString("# DOM State\n\n")

	// Pagination information
	builder.WriteString("## Pagination\n")
	builder.WriteString(fmt.Sprintf("- **Current Page:** %d of %d\n", state.Pagination.CurrentPage, state.Pagination.TotalPages))
	builder.WriteString(fmt.Sprintf("- **Page Size:** %d elements\n", state.Pagination.PageSize))
	builder.WriteString(fmt.Sprintf("- **Total Elements:** %d\n", state.Pagination.TotalElements))
	builder.WriteString(fmt.Sprintf("- **Has Next Page:** %t\n", state.Pagination.HasNextPage))
	builder.WriteString(fmt.Sprintf("- **Has Previous Page:** %t\n", state.Pagination.HasPreviousPage))

	// Filter information if applied
	if state.Filter != nil && state.Filter.ElementType != nil {
		builder.WriteString(fmt.Sprintf("- **Filtered by Element Type:** %s\n", *state.Filter.ElementType))
	}
	builder.WriteString("\n")

	// Page metadata if available
	if state.Meta != nil {
		builder.WriteString("## Page Metadata\n")
		if metaMap, ok := state.Meta.(map[string]interface{}); ok {
			for key, value := range metaMap {
				builder.WriteString(fmt.Sprintf("- **%s:** %v\n", key, value))
			}
		} else {
			builder.WriteString(fmt.Sprintf("- %v\n", state.Meta))
		}
		builder.WriteString("\n")
	}

	// Interactive elements section
	builder.WriteString("## Interactive Elements\n\n")

	if len(state.InteractiveElements) == 0 {
		builder.WriteString("*No interactive elements found on this page.*\n\n")
	} else {
		for i, element := range state.InteractiveElements {
			builder.WriteString(fmt.Sprintf("### Element %d\n", i+1))

			// Element properties in a structured format
			for key, value := range element {
				if value != nil {
					switch key {
					case "type":
						builder.WriteString(fmt.Sprintf("- **Type:** %v\n", value))
					case "text":
						if str, ok := value.(string); ok && strings.TrimSpace(str) != "" {
							builder.WriteString(fmt.Sprintf("- **Text:** %s\n", str))
						}
					case "id":
						if str, ok := value.(string); ok && strings.TrimSpace(str) != "" {
							builder.WriteString(fmt.Sprintf("- **ID:** %s\n", str))
						}
					case "class":
						if str, ok := value.(string); ok && strings.TrimSpace(str) != "" {
							builder.WriteString(fmt.Sprintf("- **Class:** %s\n", str))
						}
					case "href":
						if str, ok := value.(string); ok && strings.TrimSpace(str) != "" {
							builder.WriteString(fmt.Sprintf("- **URL:** %s\n", str))
						}
					case "value":
						if str, ok := value.(string); ok && strings.TrimSpace(str) != "" {
							builder.WriteString(fmt.Sprintf("- **Value:** %s\n", str))
						}
					case "placeholder":
						if str, ok := value.(string); ok && strings.TrimSpace(str) != "" {
							builder.WriteString(fmt.Sprintf("- **Placeholder:** %s\n", str))
						}
					case "selector":
						if str, ok := value.(string); ok && strings.TrimSpace(str) != "" {
							builder.WriteString(fmt.Sprintf("- **Selector:** `%s`\n", str))
						}
					case "xpath":
						if str, ok := value.(string); ok && strings.TrimSpace(str) != "" {
							builder.WriteString(fmt.Sprintf("- **XPath:** `%s`\n", str))
						}
					default:
						// Handle other properties
						if str, ok := value.(string); ok && strings.TrimSpace(str) != "" {
							builder.WriteString(fmt.Sprintf("- **%s:** %s\n", strings.Title(key), str))
						} else if value != "" {
							builder.WriteString(fmt.Sprintf("- **%s:** %v\n", strings.Title(key), value))
						}
					}
				}
			}
			builder.WriteString("\n")
		}
	}

	// Formatted DOM section
	if strings.TrimSpace(state.FormattedDom) != "" {
		builder.WriteString("## DOM Structure\n\n")
		builder.WriteString("```html\n")
		builder.WriteString(state.FormattedDom)
		builder.WriteString("\n```\n")
	}

	return builder.String()
}
