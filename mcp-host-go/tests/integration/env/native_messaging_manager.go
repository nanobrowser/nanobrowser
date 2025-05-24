package env

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
)

// RpcHandler defines the signature for RPC method handlers
type RpcHandler func(params map[string]interface{}) (interface{}, error)

// NativeMessagingManager handles communication with the MCP host process via Native Messaging protocol
type NativeMessagingManager struct {
	stdin         io.WriteCloser
	stdout        io.ReadCloser
	stderr        io.ReadCloser
	pid           int
	responses     chan map[string]interface{}
	errors        chan error
	actionHandler func(action string, params map[string]interface{}) map[string]interface{}
	rpcHandlers   map[string]RpcHandler // method name -> handler
}

func (nm *NativeMessagingManager) SendMessage(ctx context.Context, message map[string]interface{}) error {
	// Serialize message to JSON
	jsonData, err := json.Marshal(message)
	if err != nil {
		return fmt.Errorf("failed to marshal message: %w", err)
	}

	// Write length prefix (4 bytes, little endian)
	length := uint32(len(jsonData))
	if err := binary.Write(nm.stdin, binary.LittleEndian, length); err != nil {
		return fmt.Errorf("failed to write message length: %w", err)
	}

	// Write JSON data
	if _, err := nm.stdin.Write(jsonData); err != nil {
		return fmt.Errorf("failed to write message data: %w", err)
	}

	return nil
}

func (nm *NativeMessagingManager) SetActionHandler(handler func(action string, params map[string]interface{}) map[string]interface{}) {
	nm.actionHandler = handler
}

// RegisterRpcHandler registers a single RPC method handler
func (nm *NativeMessagingManager) RegisterRpcHandler(method string, handler RpcHandler) {
	if nm.rpcHandlers == nil {
		nm.rpcHandlers = make(map[string]RpcHandler)
	}
	nm.rpcHandlers[method] = handler
}

// RegisterRpcHandlers registers multiple RPC method handlers at once
func (nm *NativeMessagingManager) RegisterRpcHandlers(handlers map[string]RpcHandler) {
	if nm.rpcHandlers == nil {
		nm.rpcHandlers = make(map[string]RpcHandler)
	}
	for method, handler := range handlers {
		nm.rpcHandlers[method] = handler
	}
}

// UnregisterRpcHandler removes an RPC method handler
func (nm *NativeMessagingManager) UnregisterRpcHandler(method string) {
	if nm.rpcHandlers != nil {
		delete(nm.rpcHandlers, method)
	}
}

func (nm *NativeMessagingManager) startMessageReader(ctx context.Context) {
	go func() {
		defer close(nm.responses)
		defer close(nm.errors)

		reader := bufio.NewReader(nm.stdout)
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}

			// Read length prefix (4 bytes, little endian)
			var length uint32
			if err := binary.Read(reader, binary.LittleEndian, &length); err != nil {
				if err == io.EOF {
					return // Process ended normally
				}
				nm.errors <- fmt.Errorf("failed to read message length: %w", err)
				return
			}

			// Read JSON data
			jsonData := make([]byte, length)
			if _, err := io.ReadFull(reader, jsonData); err != nil {
				nm.errors <- fmt.Errorf("failed to read message data: %w", err)
				return
			}

			// Parse JSON
			var message map[string]interface{}
			if err := json.Unmarshal(jsonData, &message); err != nil {
				nm.errors <- fmt.Errorf("failed to unmarshal message: %w", err)
				return
			}

			// Handle RPC requests
			if nm.handleRpcRequest(ctx, message) {
				continue
			}

			// Handle action messages
			if actionType, ok := message["action"].(string); ok && nm.actionHandler != nil {
				params, _ := message["params"].(map[string]interface{})
				response := nm.actionHandler(actionType, params)
				nm.responses <- response
				continue
			}

			// Regular response message
			nm.responses <- message
		}
	}()

	// Also read stderr for debugging
	go func() {
		scanner := bufio.NewScanner(nm.stderr)
		for scanner.Scan() {
			// Log stderr output for debugging
			fmt.Fprintf(os.Stderr, "[mcp-host stderr]: %s\n", scanner.Text())
		}
	}()
}

// handleRpcRequest processes RPC requests and returns true if the message was handled
func (nm *NativeMessagingManager) handleRpcRequest(ctx context.Context, message map[string]interface{}) bool {
	// Check if this is an RPC request (type: "rpc_request")
	msgType, hasType := message["type"].(string)
	if !hasType || msgType != "rpc_request" {
		return false // Not an RPC request
	}

	// Extract method and id from the RPC request
	method, hasMethod := message["method"].(string)
	id, hasId := message["id"]

	if !hasMethod || !hasId {
		return false // Invalid RPC request
	}

	// Look up the handler
	handler, exists := nm.rpcHandlers[method]
	if !exists {
		// Send error response for unknown method
		nm.sendRpcResponse(ctx, id, nil, fmt.Errorf("unknown RPC method: %s", method))
		return true
	}

	// Extract parameters
	params, _ := message["params"].(map[string]interface{})
	if params == nil {
		params = make(map[string]interface{})
	}

	// Execute the handler
	result, err := handler(params)

	// Send response
	nm.sendRpcResponse(ctx, id, result, err)
	return true
}

// sendRpcResponse sends an RPC response back to the MCP host
func (nm *NativeMessagingManager) sendRpcResponse(ctx context.Context, id interface{}, result interface{}, err error) {
	response := map[string]interface{}{
		"id": id,
	}

	if err != nil {
		response["error"] = map[string]interface{}{
			"message": err.Error(),
		}
	} else {
		response["result"] = result
	}

	// Send response asynchronously to avoid blocking
	go func() {
		if sendErr := nm.SendMessage(ctx, response); sendErr != nil {
			nm.errors <- fmt.Errorf("failed to send RPC response: %w", sendErr)
		}
	}()
}

func (nm *NativeMessagingManager) Close() error {
	var errors []error

	if nm.stdin != nil {
		if err := nm.stdin.Close(); err != nil {
			errors = append(errors, fmt.Errorf("failed to close stdin: %w", err))
		}
	}

	if nm.stdout != nil {
		if err := nm.stdout.Close(); err != nil {
			errors = append(errors, fmt.Errorf("failed to close stdout: %w", err))
		}
	}

	if nm.stderr != nil {
		if err := nm.stderr.Close(); err != nil {
			errors = append(errors, fmt.Errorf("failed to close stderr: %w", err))
		}
	}

	if len(errors) > 0 {
		return fmt.Errorf("close errors: %v", errors)
	}

	return nil
}
