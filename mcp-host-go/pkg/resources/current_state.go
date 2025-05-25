package resources

import (
	"encoding/json"
	"fmt"
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
		mimeType:    "application/json",
		description: "Complete state of the current active page and all tabs",
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

	// Convert result to JSON
	jsonBytes, err := json.MarshalIndent(resp.Result, "", "  ")
	if err != nil {
		r.logger.Error("Error marshaling browser state", zap.Error(err))
		return types.ResourceContent{}, fmt.Errorf("failed to marshal browser state: %w", err)
	}

	// Return the browser state as resource content
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

// getCurrentTimestamp returns the current timestamp in milliseconds
func getCurrentTimestamp() int64 {
	return timeNow().UnixNano() / int64(1e6)
}

// timeNow is a variable to allow testing with a mock time
var timeNow = func() time.Time {
	return time.Now()
}
