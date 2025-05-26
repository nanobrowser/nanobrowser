package resources

import (
	"encoding/json"
	"fmt"
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
		description: `Current DOM state overview with up to 20 interactive elements and page metadata in AI-friendly Markdown format.

This resource provides a quick overview of the page's interactive elements. For pages with more than 20 interactive elements, use the 'get_dom_extra_elements' tool to access additional elements with pagination and filtering options.

The overview includes:
• Page metadata (URL, title, scroll position)
• First 20 interactive elements (buttons, inputs, links, etc.)
• Total count of all interactive elements
• Simplified DOM structure
• Clear indication when more elements are available`,
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

// Read reads the current DOM state overview
func (r *DomStateResource) Read() (types.ResourceContent, error) {
	return r.ReadWithArguments(r.uri, nil)
}

// ReadWithArguments reads the DOM state overview (arguments are ignored for overview mode)
func (r *DomStateResource) ReadWithArguments(uri string, arguments map[string]any) (types.ResourceContent, error) {
	r.logger.Debug("Reading DOM state overview", zap.String("uri", uri))

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

	// Create overview with max 20 elements
	overview := r.createOverview(domStateData)

	// Convert to Markdown format
	markdownContent := r.convertToMarkdown(overview)

	r.logger.Debug("Successfully retrieved DOM state overview",
		zap.Int("totalElements", overview.TotalElements),
		zap.Int("overviewElements", len(overview.OverviewElements)),
		zap.Bool("hasMore", overview.HasMoreElements))

	// Return the DOM state overview as resource content
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

// DomStateData represents the raw DOM state data from Chrome extension
type DomStateData struct {
	FormattedDom        string                   `json:"formattedDom"`
	InteractiveElements []map[string]interface{} `json:"interactiveElements"`
	Meta                interface{}              `json:"meta"`
}

// DomStateOverview represents the overview of DOM state (max 20 elements)
type DomStateOverview struct {
	FormattedDom     string                   `json:"formattedDom"`
	OverviewElements []map[string]interface{} `json:"overviewElements"`
	Meta             interface{}              `json:"meta"`
	TotalElements    int                      `json:"totalElements"`
	HasMoreElements  bool                     `json:"hasMoreElements"`
	OverviewLimit    int                      `json:"overviewLimit"`
}

// createOverview creates an overview with max 20 elements
func (r *DomStateResource) createOverview(data DomStateData) DomStateOverview {
	totalElements := len(data.InteractiveElements)
	overviewLimit := 20
	hasMore := totalElements > overviewLimit

	// Get first 20 elements (or all if less than 20)
	var overviewElements []map[string]interface{}
	if totalElements <= overviewLimit {
		overviewElements = data.InteractiveElements
	} else {
		overviewElements = data.InteractiveElements[:overviewLimit]
	}

	return DomStateOverview{
		FormattedDom:     data.FormattedDom,
		OverviewElements: overviewElements,
		Meta:             data.Meta,
		TotalElements:    totalElements,
		HasMoreElements:  hasMore,
		OverviewLimit:    overviewLimit,
	}
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

// convertToMarkdown converts the DOM state overview to AI-friendly Markdown format
func (r *DomStateResource) convertToMarkdown(overview DomStateOverview) string {
	var builder strings.Builder

	// Header
	builder.WriteString("# DOM State Overview\n\n")

	// Page metadata if available
	if overview.Meta != nil {
		builder.WriteString("## Page Metadata\n")
		if metaMap, ok := overview.Meta.(map[string]interface{}); ok {
			for key, value := range metaMap {
				builder.WriteString(fmt.Sprintf("- **%s:** %v\n", key, value))
			}
		} else {
			builder.WriteString(fmt.Sprintf("- %v\n", overview.Meta))
		}
		builder.WriteString("\n")
	}

	// Overview summary
	builder.WriteString("## Interactive Elements Summary\n")
	builder.WriteString(fmt.Sprintf("- **Total Elements:** %d\n", overview.TotalElements))
	builder.WriteString(fmt.Sprintf("- **Showing:** First %d elements\n", len(overview.OverviewElements)))

	if overview.HasMoreElements {
		remainingElements := overview.TotalElements - len(overview.OverviewElements)
		builder.WriteString(fmt.Sprintf("- **Additional Elements:** %d more elements available\n", remainingElements))
		builder.WriteString("- **Access More:** Use the `get_dom_extra_elements` tool for pagination and filtering\n")
	} else {
		builder.WriteString("- **Status:** All interactive elements shown\n")
	}
	builder.WriteString("\n")

	// Interactive elements section
	if len(overview.OverviewElements) == 0 {
		builder.WriteString("## Interactive Elements\n\n")
		builder.WriteString("*No interactive elements found on this page.*\n\n")
	} else {
		builder.WriteString("## Interactive Elements (Overview)\n\n")

		for i, element := range overview.OverviewElements {
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

	// Additional elements hint
	if overview.HasMoreElements {
		builder.WriteString("---\n\n")
		builder.WriteString("**📋 Need More Elements?**\n\n")
		builder.WriteString("This overview shows the first 20 interactive elements. ")
		builder.WriteString(fmt.Sprintf("There are %d more elements available on this page.\n\n", overview.TotalElements-len(overview.OverviewElements)))
		builder.WriteString("Use the `get_dom_extra_elements` tool to:\n")
		builder.WriteString("- Access elements beyond the first 20\n")
		builder.WriteString("- Filter by element type (button, input, link, etc.)\n")
		builder.WriteString("- Navigate through pages of elements\n")
		builder.WriteString("- Get specific ranges of elements\n\n")
	}

	// Formatted DOM section (simplified)
	if strings.TrimSpace(overview.FormattedDom) != "" {
		builder.WriteString("## DOM Structure\n\n")
		builder.WriteString("```html\n")
		builder.WriteString(overview.FormattedDom)
		builder.WriteString("\n```\n")
	}

	return builder.String()
}
