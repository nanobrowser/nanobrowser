package messaging

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sync"
	"time"

	"github.com/algonius/algonius-browser/mcp-host-go/pkg/logger"
	"github.com/algonius/algonius-browser/mcp-host-go/pkg/types"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// NativeMessaging implements the types.Messaging interface for Chrome native messaging
type NativeMessaging struct {
	logger          logger.Logger
	stdin           io.Reader
	stdout          io.Writer
	buffer          []byte
	messageHandlers map[string]types.MessageHandler
	rpcHandlers     map[string]types.RpcHandler
	pendingRequests map[string]*pendingRequest
	mutex           sync.Mutex
}

// pendingRequest represents a pending RPC request
type pendingRequest struct {
	done     chan struct{}
	response types.RpcResponse
	err      error
	timer    *time.Timer
}

// NativeMessagingConfig contains configuration for NativeMessaging
type NativeMessagingConfig struct {
	Logger logger.Logger
	Stdin  io.Reader
	Stdout io.Writer
}

// NewNativeMessaging creates a new NativeMessaging instance
func NewNativeMessaging(config NativeMessagingConfig) (*NativeMessaging, error) {
	if config.Logger == nil {
		return nil, fmt.Errorf("logger is required")
	}

	stdin := config.Stdin
	if stdin == nil {
		stdin = os.Stdin
	}

	stdout := config.Stdout
	if stdout == nil {
		stdout = os.Stdout
	}

	nm := &NativeMessaging{
		logger:          config.Logger,
		stdin:           stdin,
		stdout:          stdout,
		buffer:          make([]byte, 0),
		messageHandlers: make(map[string]types.MessageHandler),
		rpcHandlers:     make(map[string]types.RpcHandler),
		pendingRequests: make(map[string]*pendingRequest),
	}

	nm.registerRpcResponseHandler()

	return nm, nil
}

// Start begins processing messages from stdin
func (nm *NativeMessaging) Start() error {
	nm.logger.Info("Starting native messaging processing")

	go func() {
		buffer := make([]byte, 4096)
		for {
			n, err := nm.stdin.Read(buffer)
			if err != nil {
				if err == io.EOF {
					nm.logger.Info("Native messaging: stdin closed")
					return
				}
				nm.logger.Error("Error reading from stdin", zap.Error(err))
				return
			}

			if n > 0 {
				nm.buffer = append(nm.buffer, buffer[:n]...)
				nm.processBuffer()
			}
		}
	}()

	return nil
}

// processBuffer processes the buffer for messages
func (nm *NativeMessaging) processBuffer() {
	// Need at least 4 bytes for the message length
	for len(nm.buffer) >= 4 {
		// Read message length (first 4 bytes, little-endian uint32)
		messageLength := binary.LittleEndian.Uint32(nm.buffer[:4])

		// Check if we have the complete message
		if uint32(len(nm.buffer)) < messageLength+4 {
			return // Need more data
		}

		// Extract message JSON
		messageJSON := nm.buffer[4 : messageLength+4]

		// Remove processed message from buffer
		nm.buffer = nm.buffer[messageLength+4:]

		// Process the message
		var message types.Message
		if err := json.Unmarshal(messageJSON, &message); err != nil {
			nm.logger.Error("Error parsing message JSON", zap.Error(err), zap.String("json", string(messageJSON)))
			continue
		}

		// Handle the message asynchronously
		go func(msg types.Message) {
			if err := nm.handleMessage(msg); err != nil {
				nm.logger.Error("Error handling message", zap.Error(err), zap.Any("message", msg))
			}
		}(message)
	}
}

// handleMessage processes a received message
func (nm *NativeMessaging) handleMessage(message types.Message) error {
	nm.logger.Info("Received message", zap.Any("message", message))

	handler, ok := nm.messageHandlers[message.Type]
	if !ok {
		nm.logger.Warn("No handler registered for message type", zap.String("type", message.Type))
		return nm.SendMessage(types.Message{
			Type:  "error",
			Error: &types.ErrorInfo{Message: fmt.Sprintf("Unknown message type: %s", message.Type)},
		})
	}

	var data interface{}
	switch message.Type {
	case "rpc_request":
		data = types.RpcRequest{
			ID:     message.ID,
			Method: message.Method,
			Params: message.Params,
		}
	case "rpc_response":
		data = types.RpcResponse{
			ID:     message.ID,
			Result: message.Result,
			Error:  message.Error,
		}
	default:
		data = message.Data
	}

	return handler(data)
}

// RegisterHandler registers a handler for a specific message type
func (nm *NativeMessaging) RegisterHandler(messageType string, handler types.MessageHandler) {
	nm.logger.Debug("Registering handler for message type", zap.String("type", messageType))
	nm.messageHandlers[messageType] = handler
}

// RegisterRpcMethod registers a handler for an RPC method
func (nm *NativeMessaging) RegisterRpcMethod(method string, handler types.RpcHandler) {
	nm.logger.Debug("Registering RPC handler for method", zap.String("method", method))
	nm.rpcHandlers[method] = handler

	// Register the RPC request handler if not already registered
	if _, exists := nm.messageHandlers["rpc_request"]; !exists {
		nm.registerRpcRequestHandler()
	}
}

// SendMessage sends a message to stdout
func (nm *NativeMessaging) SendMessage(message types.Message) error {
	nm.logger.Debug("Sending message", zap.Any("message", message))

	// Convert message to JSON
	messageJSON, err := json.Marshal(message)
	if err != nil {
		return fmt.Errorf("error marshaling message: %w", err)
	}

	// Get message length
	messageLength := uint32(len(messageJSON))

	// Create buffer with length prefix (4 bytes) + message
	buffer := make([]byte, 4+messageLength)
	binary.LittleEndian.PutUint32(buffer, messageLength)
	copy(buffer[4:], messageJSON)

	// Write to stdout
	nm.mutex.Lock()
	defer nm.mutex.Unlock()
	_, err = nm.stdout.Write(buffer)
	if err != nil {
		return fmt.Errorf("error writing message: %w", err)
	}

	return nil
}

// RpcRequest sends an RPC request and waits for the response
func (nm *NativeMessaging) RpcRequest(request types.RpcRequest, options types.RpcOptions) (types.RpcResponse, error) {
	id := request.ID
	if id == "" {
		id = uuid.New().String()
		request.ID = id
	}

	nm.logger.Info("Sending RPC request", zap.String("method", request.Method), zap.String("id", id))

	timeout := 5000 // Default 5 seconds
	if options.Timeout > 0 {
		timeout = options.Timeout
	}

	// Create pending request
	pending := &pendingRequest{
		done: make(chan struct{}),
	}

	// Set timeout
	pending.timer = time.AfterFunc(time.Duration(timeout)*time.Millisecond, func() {
		nm.mutex.Lock()
		defer nm.mutex.Unlock()
		if _, exists := nm.pendingRequests[id]; exists {
			pending.err = fmt.Errorf("RPC request timeout: %s (id: %s)", request.Method, id)
			close(pending.done)
			delete(nm.pendingRequests, id)
		}
	})

	// Register pending request
	nm.mutex.Lock()
	nm.pendingRequests[id] = pending
	nm.mutex.Unlock()

	// Send the request
	if err := nm.SendMessage(types.Message{
		Type:   "rpc_request",
		ID:     id,
		Method: request.Method,
		Params: request.Params,
	}); err != nil {
		nm.mutex.Lock()
		delete(nm.pendingRequests, id)
		nm.mutex.Unlock()
		pending.timer.Stop()
		return types.RpcResponse{}, err
	}

	// Wait for response or timeout
	<-pending.done

	nm.logger.Info("RPC request Done", zap.Any("response", pending.response), zap.Any("err", pending.err))

	return pending.response, pending.err
}

// registerRpcResponseHandler registers a handler for RPC responses
func (nm *NativeMessaging) registerRpcResponseHandler() {
	nm.RegisterHandler("rpc_response", func(data interface{}) error {
		response, ok := data.(types.RpcResponse)
		if !ok {
			return fmt.Errorf("invalid RPC response format")
		}

		id := response.ID
		nm.logger.Debug("Received RPC response for ID", zap.String("id", id))

		nm.mutex.Lock()
		defer nm.mutex.Unlock()

		pending, exists := nm.pendingRequests[id]
		if !exists {
			nm.logger.Warn("No pending request found for RPC response ID", zap.String("id", id))
			return nil
		}

		// Stop the timer
		pending.timer.Stop()

		// Set the response
		pending.response = response

		// Signal completion
		close(pending.done)

		// Remove from pending requests
		delete(nm.pendingRequests, id)

		return nil
	})
}

// registerRpcRequestHandler registers a handler for RPC requests
func (nm *NativeMessaging) registerRpcRequestHandler() {
	nm.RegisterHandler("rpc_request", func(data interface{}) error {
		request, ok := data.(types.RpcRequest)
		if !ok {
			return fmt.Errorf("invalid RPC request format")
		}

		method := request.Method
		nm.logger.Debug("Handling RPC request", zap.String("method", method))

		handler, exists := nm.rpcHandlers[method]
		if !exists {
			nm.logger.Warn("No handler registered for RPC method", zap.String("method", method))
			return nm.SendMessage(types.Message{
				Type: "rpc_response",
				ID:   request.ID,
				Error: &types.ErrorInfo{
					Code:    -32601, // Method not found (JSON-RPC spec)
					Message: fmt.Sprintf("Method not found: %s", method),
				},
			})
		}

		// Handle the request
		response, err := handler(request)
		if err != nil {
			nm.logger.Error("Error in RPC handler", zap.Error(err))
			return nm.SendMessage(types.Message{
				Type: "rpc_response",
				ID:   request.ID,
				Error: &types.ErrorInfo{
					Code:    -32000, // Server error (JSON-RPC spec)
					Message: fmt.Sprintf("Server error: %s", err.Error()),
				},
			})
		}

		// Ensure ID is set correctly
		response.ID = request.ID

		// Send response
		return nm.SendMessage(types.Message{
			Type:   "rpc_response",
			ID:     response.ID,
			Result: response.Result,
			Error:  response.Error,
		})
	})
}
