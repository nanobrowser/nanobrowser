package resources

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/algonius/algonius-browser/mcp-host-go/pkg/logger"
	"github.com/algonius/algonius-browser/mcp-host-go/pkg/types"
	"go.uber.org/zap"
)

// CurrentStateResource implements the current browser state resource
type CurrentStateResource struct {
	uri         string
	name        string
	mimeType    string
	description string
	logger      logger.Logger
	messaging   types.Messaging
}

// CurrentStateConfig contains configuration for CurrentStateResource
type CurrentStateConfig struct {
	Logger    logger.Logger
	Messaging types.Messaging
}

// BrowserStateData represents the browser state data from Chrome extension
type BrowserStateData struct {
	ActiveTab interface{} `json:"activeTab"`
	Tabs      []TabInfo   `json:"tabs"`
}

// TabInfo represents information about a browser tab
type TabInfo struct {
	ID     interface{} `json:"id"`
	URL    string      `json:"url"`
	Title  string      `json:"title"`
	Active bool        `json:"active"`
}

// NewCurrentStateResource creates a new CurrentStateResource
func NewCurrentStateResource(config CurrentStateConfig) (*CurrentStateResource, error) {
	if config.Logger == nil {
		return nil, fmt.Errorf("logger is required")
	}

	if config.Messaging == nil {
		return nil, fmt.Errorf("messaging is required")
	}

	return &CurrentStateResource{
		uri:         "browser://current/state",
		name:        "Current Browser State",
		mimeType:    "text/markdown",
		description: "Complete state of the current active page and all tabs in AI-friendly Markdown format",
		logger:      config.Logger,
		messaging:   config.Messaging,
	}, nil
}

// GetURI returns the resource URI
func (r *CurrentStateResource) GetURI() string {
	return r.uri
}

// GetName returns the resource name
func (r *CurrentStateResource) GetName() string {
	return r.name
}

// GetMimeType returns the resource MIME type
func (r *CurrentStateResource) GetMimeType() string {
	return r.mimeType
}

// GetDescription returns the resource description
func (r *CurrentStateResource) GetDescription() string {
	return r.description
}

// Read reads the current browser state
func (r *CurrentStateResource) Read() (types.ResourceContent, error) {
	return r.ReadWithArguments(r.uri, nil)
}

// ReadWithArguments reads the current browser state (ignores arguments for compatibility)
func (r *CurrentStateResource) ReadWithArguments(uri string, arguments map[string]any) (types.ResourceContent, error) {
	r.logger.Info("Reading current browser state")

	// Request browser state from the extension
	resp, err := r.messaging.RpcRequest(types.RpcRequest{
		Method: "get_browser_state",
	}, types.RpcOptions{Timeout: 5000})

	if err != nil {
		r.logger.Error("Error requesting browser state", zap.Error(err))
		return types.ResourceContent{}, fmt.Errorf("failed to request browser state: %w", err)
	}

	if resp.Error != nil {
		r.logger.Error("RPC error getting browser state", zap.Any("respError", resp.Error))
		return types.ResourceContent{}, fmt.Errorf("RPC error: %s", resp.Error.Message)
	}

	r.logger.Info("Reading current browser state ok", zap.Any("resp", resp))

	// Parse the raw browser state data
	var browserStateData BrowserStateData
	if err := r.parseResponseToStruct(resp.Result, &browserStateData); err != nil {
		r.logger.Error("Error parsing browser state data", zap.Error(err))
		return types.ResourceContent{}, fmt.Errorf("failed to parse browser state data: %w", err)
	}

	// Convert to Markdown format
	markdownContent := r.convertToMarkdown(browserStateData)

	r.logger.Debug("Successfully retrieved browser state",
		zap.Int("responseSize", len(markdownContent)),
		zap.Int("totalTabs", len(browserStateData.Tabs)))

	// Return the browser state as resource content
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

// NotifyStateChange notifies that the state has changed
func (r *CurrentStateResource) NotifyStateChange(state interface{}) {
	r.logger.Debug("Notifying state change")

	// Send resource_updated message
	err := r.messaging.SendMessage(types.Message{
		Type: "resource_updated",
		Data: map[string]interface{}{
			"uri":       r.uri,
			"timestamp": getCurrentTimestamp(),
		},
	})

	if err != nil {
		r.logger.Error("Error sending resource_updated message", zap.Error(err))
	}
}

// parseResponseToStruct converts response result to a struct
func (r *CurrentStateResource) parseResponseToStruct(result interface{}, target interface{}) error {
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

// convertToMarkdown converts the browser state to AI-friendly Markdown format
func (r *CurrentStateResource) convertToMarkdown(state BrowserStateData) string {
	var builder strings.Builder

	// Header
	builder.WriteString("# Browser State\n\n")

	// Active Tab Information
	builder.WriteString("## Active Tab\n")
	if state.ActiveTab != nil {
		if activeTabMap, ok := state.ActiveTab.(map[string]interface{}); ok {
			for key, value := range activeTabMap {
				if value != nil {
					builder.WriteString(fmt.Sprintf("- **%s:** %v\n", strings.Title(key), value))
				}
			}
		} else {
			builder.WriteString(fmt.Sprintf("- **ID:** %v\n", state.ActiveTab))
		}
	} else {
		builder.WriteString("- *No active tab information available*\n")
	}
	builder.WriteString("\n")

	// Browser Tabs Information
	builder.WriteString("## Browser Tabs\n")
	builder.WriteString(fmt.Sprintf("- **Total Tabs:** %d\n\n", len(state.Tabs)))

	if len(state.Tabs) == 0 {
		builder.WriteString("*No tabs found.*\n\n")
	} else {
		for i, tab := range state.Tabs {
			builder.WriteString(fmt.Sprintf("### Tab %d\n", i+1))

			// Tab ID
			if tab.ID != nil {
				builder.WriteString(fmt.Sprintf("- **ID:** %v\n", tab.ID))
			}

			// Tab URL
			if strings.TrimSpace(tab.URL) != "" {
				builder.WriteString(fmt.Sprintf("- **URL:** %s\n", tab.URL))
			}

			// Tab Title
			if strings.TrimSpace(tab.Title) != "" {
				builder.WriteString(fmt.Sprintf("- **Title:** %s\n", tab.Title))
			}

			// Active status
			builder.WriteString(fmt.Sprintf("- **Active:** %t\n", tab.Active))

			// Status indicator
			if tab.Active {
				builder.WriteString("- **Status:** 🟢 Currently Active\n")
			} else {
				builder.WriteString("- **Status:** ⚪ Background Tab\n")
			}

			builder.WriteString("\n")
		}
	}

	// Summary Statistics
	builder.WriteString("## Summary\n")
	activeTabs := 0
	for _, tab := range state.Tabs {
		if tab.Active {
			activeTabs++
		}
	}
	builder.WriteString(fmt.Sprintf("- **Total Browser Tabs:** %d\n", len(state.Tabs)))
	builder.WriteString(fmt.Sprintf("- **Active Tabs:** %d\n", activeTabs))
	builder.WriteString(fmt.Sprintf("- **Background Tabs:** %d\n", len(state.Tabs)-activeTabs))

	return builder.String()
}

// getCurrentTimestamp returns the current timestamp in milliseconds
func getCurrentTimestamp() int64 {
	return timeNow().UnixNano() / int64(1e6)
}

// timeNow is a variable to allow testing with a mock time
var timeNow = func() time.Time {
	return time.Now()
}
