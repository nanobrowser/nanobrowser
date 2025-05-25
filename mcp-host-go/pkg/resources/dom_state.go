package resources

import (
	"encoding/json"
	"fmt"

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
		uri:         "browser://dom/state",
		name:        "DOM State",
		mimeType:    "application/json",
		description: "Current DOM state with interactive elements and page metadata",
		logger:      config.Logger,
		messaging:   config.Messaging,
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

// Read reads the current DOM state
func (r *DomStateResource) Read() (types.ResourceContent, error) {
	r.logger.Debug("Reading DOM state")

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

	// Convert result to JSON
	jsonBytes, err := json.MarshalIndent(resp.Result, "", "  ")
	if err != nil {
		r.logger.Error("Error marshaling DOM state", zap.Error(err))
		return types.ResourceContent{}, fmt.Errorf("failed to marshal DOM state: %w", err)
	}

	r.logger.Debug("Successfully retrieved DOM state", zap.Int("responseSize", len(jsonBytes)))

	// Return the DOM state as resource content
	return types.ResourceContent{
		Contents: []types.ResourceItem{
			{
				URI:      r.uri,
				MimeType: r.mimeType,
				Text:     string(jsonBytes),
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
