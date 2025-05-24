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

// NativeMessagingManager handles communication with the MCP host process via Native Messaging protocol
type NativeMessagingManager struct {
	stdin         io.WriteCloser
	stdout        io.ReadCloser
	stderr        io.ReadCloser
	pid           int
	responses     chan map[string]interface{}
	errors        chan error
	actionHandler func(action string, params map[string]interface{}) map[string]interface{}
}

func (nm *NativeMessagingManager) SendMessage(ctx context.Context, message map[string]interface{}) (map[string]interface{}, error) {
	// Serialize message to JSON
	jsonData, err := json.Marshal(message)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal message: %w", err)
	}

	// Write length prefix (4 bytes, little endian)
	length := uint32(len(jsonData))
	if err := binary.Write(nm.stdin, binary.LittleEndian, length); err != nil {
		return nil, fmt.Errorf("failed to write message length: %w", err)
	}

	// Write JSON data
	if _, err := nm.stdin.Write(jsonData); err != nil {
		return nil, fmt.Errorf("failed to write message data: %w", err)
	}

	// Wait for response or timeout
	select {
	case response := <-nm.responses:
		return response, nil
	case err := <-nm.errors:
		return nil, fmt.Errorf("error reading response: %w", err)
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (nm *NativeMessagingManager) SetActionHandler(handler func(action string, params map[string]interface{}) map[string]interface{}) {
	nm.actionHandler = handler
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
