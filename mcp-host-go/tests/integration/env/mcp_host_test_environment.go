package env

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

type McpHostTestEnvironment struct {
	hostProcess    *exec.Cmd
	mcpClient      *McpSSEClient
	nativeMsg      *NativeMessagingManager
	port           int
	baseURL        string
	logFilePath    string
	testDataDir    string
	logMonitorStop chan struct{}
}

type TestConfig struct {
	Port        int
	LogLevel    string
	TestDataDir string
}

func NewMcpHostTestEnvironment(config *TestConfig) (*McpHostTestEnvironment, error) {
	if config == nil {
		config = &TestConfig{}
	}

	// Use provided port or find an available one
	port := config.Port
	if port == 0 {
		var err error
		port, err = findAvailablePort()
		if err != nil {
			return nil, fmt.Errorf("failed to find available port: %w", err)
		}
	}

	baseURL := fmt.Sprintf("http://localhost:%d/sse", port)

	// Create test data directory
	testDataDir := config.TestDataDir
	if testDataDir == "" {
		testDataDir = filepath.Join(os.TempDir(), "mcp-host-test", fmt.Sprintf("test-%d", time.Now().Unix()))
	}

	if err := os.MkdirAll(testDataDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create test data directory: %w", err)
	}

	return &McpHostTestEnvironment{
		port:           port,
		baseURL:        baseURL,
		testDataDir:    testDataDir,
		logFilePath:    filepath.Join(testDataDir, "mcp-host.log"),
		logMonitorStop: make(chan struct{}),
	}, nil
}

func (env *McpHostTestEnvironment) Setup(ctx context.Context) error {
	// Build the MCP host binary if needed
	if err := env.buildMcpHost(); err != nil {
		return fmt.Errorf("failed to build MCP host: %w", err)
	}

	// Start the MCP host process
	if err := env.startMcpHost(ctx); err != nil {
		return fmt.Errorf("failed to start MCP host: %w", err)
	}

	// Start log monitoring
	if os.Getenv("OUTPUT_MCP_HOST_LOG") == "true" {
		go env.startLogMonitor(ctx)
	}

	// Wait for the host to be ready
	if err := env.waitForHostReady(ctx); err != nil {
		return fmt.Errorf("MCP host failed to become ready: %w", err)
	}

	// Create MCP client
	env.mcpClient = NewMcpSSEClient(env.baseURL)

	return nil
}

func (env *McpHostTestEnvironment) buildMcpHost() error {
	// Build the binary using go build with -mod=mod flag to avoid vendor issues
	cmd := exec.Command("go", "build", "-mod=mod", "-o", "bin/mcp-host", "./cmd/mcp-host")
	cmd.Dir = "../../"
	return cmd.Run()
}

func (env *McpHostTestEnvironment) startMcpHost(ctx context.Context) error {
	// Prepare environment variables
	environ := append(os.Environ(),
		fmt.Sprintf("SSE_PORT=:%d", env.port),
		fmt.Sprintf("SSE_BASE_URL=%s", env.baseURL),
		fmt.Sprintf("LOG_FILE=%s", env.logFilePath),
		"LOG_LEVEL=debug",
		"RUN_MODE=test",
	)

	// Start the MCP host process
	env.hostProcess = exec.CommandContext(ctx, "../../bin/mcp-host")
	env.hostProcess.Env = environ

	// Create pipes for Native Messaging communication
	stdin, err := env.hostProcess.StdinPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdin pipe: %w", err)
	}

	stdout, err := env.hostProcess.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	stderr, err := env.hostProcess.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	// Start the process
	if err := env.hostProcess.Start(); err != nil {
		return fmt.Errorf("failed to start process: %w", err)
	}

	// Store pipes for Native Messaging
	env.nativeMsg = &NativeMessagingManager{
		stdin:       stdin,
		stdout:      stdout,
		stderr:      stderr,
		pid:         env.hostProcess.Process.Pid,
		responses:   make(chan map[string]interface{}, 10),
		errors:      make(chan error, 10),
		rpcHandlers: make(map[string]RpcHandler),
	}

	// Start reading messages from stdout
	env.nativeMsg.startMessageReader(ctx)

	return nil
}

// startLogMonitor starts a goroutine to monitor and output MCP host logs to console
func (env *McpHostTestEnvironment) startLogMonitor(ctx context.Context) {
	log.Printf("[LOG-MONITOR] Starting log monitor for file: %s", env.logFilePath)

	go func() {
		// Wait a moment for the log file to be created
		time.Sleep(500 * time.Millisecond)

		for {
			select {
			case <-ctx.Done():
				log.Printf("[LOG-MONITOR] Context cancelled, stopping log monitor")
				return
			case <-env.logMonitorStop:
				log.Printf("[LOG-MONITOR] Stop signal received, stopping log monitor")
				return
			default:
			}

			// Try to open and read the log file
			if err := env.readAndOutputLogs(); err != nil {
				// Log file might not exist yet, wait and retry
				time.Sleep(1 * time.Second)
				continue
			}

			// Wait a bit before checking for new log entries
			time.Sleep(100 * time.Millisecond)
		}
	}()
}

// readAndOutputLogs reads the log file and outputs new lines to console
func (env *McpHostTestEnvironment) readAndOutputLogs() error {
	file, err := os.Open(env.logFilePath)
	if err != nil {
		return err
	}
	defer file.Close()

	// Keep track of the last read position
	// For simplicity, we'll read from the end and follow new content
	// In a more sophisticated implementation, we could track the last read position

	scanner := bufio.NewScanner(file)
	var lines []string

	// Read all lines first
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}

	if err := scanner.Err(); err != nil {
		return err
	}

	// Output recent lines (last 10 or all if fewer than 10)
	start := 0
	if len(lines) > 10 {
		start = len(lines) - 10
	}

	for i := start; i < len(lines); i++ {
		log.Printf("[MCP-HOST] %s", lines[i])
	}

	return nil
}

// tailLogFile continuously tails the log file and outputs new lines
func (env *McpHostTestEnvironment) tailLogFile(ctx context.Context) error {
	file, err := os.Open(env.logFilePath)
	if err != nil {
		return err
	}
	defer file.Close()

	// Seek to end of file
	file.Seek(0, io.SeekEnd)

	reader := bufio.NewReader(file)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-env.logMonitorStop:
			return nil
		default:
		}

		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				// No new data, wait a bit
				time.Sleep(100 * time.Millisecond)
				continue
			}
			return err
		}

		// Output the log line with prefix
		log.Printf("[MCP-HOST] %s", line[:len(line)-1]) // Remove trailing newline
	}
}

func (env *McpHostTestEnvironment) waitForHostReady(ctx context.Context) error {
	// Wait for SSE server to be ready by trying to connect to a basic endpoint
	client := &http.Client{Timeout: 1 * time.Second}

	for i := 0; i < 30; i++ { // Wait up to 30 seconds
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Try to connect to the base URL
		resp, err := client.Get(env.baseURL + "/")
		if err == nil {
			resp.Body.Close()
			log.Printf("[LOG-MONITOR] MCP host is ready at %s", env.baseURL)
			return nil
		}
		if resp != nil {
			resp.Body.Close()
		}

		time.Sleep(1 * time.Second)
	}

	return fmt.Errorf("MCP host did not become ready within timeout")
}

func (env *McpHostTestEnvironment) IsHostRunning() bool {
	if env.hostProcess == nil || env.hostProcess.Process == nil {
		return false
	}

	// Check if process is still running by trying to send signal 0
	// This is a common Unix way to check if a process exists
	return env.hostProcess.ProcessState == nil
}

// Accessor methods for private fields
func (env *McpHostTestEnvironment) GetMcpClient() *McpSSEClient {
	return env.mcpClient
}

func (env *McpHostTestEnvironment) GetNativeMsg() *NativeMessagingManager {
	return env.nativeMsg
}

func (env *McpHostTestEnvironment) GetHostProcess() *exec.Cmd {
	return env.hostProcess
}

func (env *McpHostTestEnvironment) Cleanup() error {
	var errors []error

	// Stop log monitor
	log.Printf("[LOG-MONITOR] Stopping log monitor")
	close(env.logMonitorStop)

	// Shutdown the host process
	if env.hostProcess != nil && env.hostProcess.Process != nil {
		log.Printf("[LOG-MONITOR] Shutting down MCP host process")
		if err := env.hostProcess.Process.Signal(os.Interrupt); err != nil {
			errors = append(errors, fmt.Errorf("failed to send interrupt signal: %w", err))
		}

		// Wait for graceful shutdown
		done := make(chan error, 1)
		go func() {
			done <- env.hostProcess.Wait()
		}()

		select {
		case err := <-done:
			if err != nil {
				errors = append(errors, fmt.Errorf("process exited with error: %w", err))
			}
			log.Printf("[LOG-MONITOR] MCP host process exited")
		case <-time.After(10 * time.Second):
			// Force kill if graceful shutdown takes too long
			log.Printf("[LOG-MONITOR] Force killing MCP host process")
			if err := env.hostProcess.Process.Kill(); err != nil {
				errors = append(errors, fmt.Errorf("failed to kill process: %w", err))
			}
		}
	}

	// Close MCP client
	if env.mcpClient != nil {
		if err := env.mcpClient.Close(); err != nil {
			errors = append(errors, fmt.Errorf("failed to close MCP client: %w", err))
		}
	}

	// Close Native Messaging
	if env.nativeMsg != nil {
		if err := env.nativeMsg.Close(); err != nil {
			errors = append(errors, fmt.Errorf("failed to close native messaging: %w", err))
		}
	}

	// Clean up test data directory
	if env.testDataDir != "" {
		if err := os.RemoveAll(env.testDataDir); err != nil {
			errors = append(errors, fmt.Errorf("failed to remove test data directory: %w", err))
		}
	}

	if len(errors) > 0 {
		return fmt.Errorf("cleanup errors: %v", errors)
	}

	return nil
}

func findAvailablePort() (int, error) {
	listener, err := net.Listen("tcp", ":0")
	if err != nil {
		return 0, err
	}
	defer listener.Close()

	addr := listener.Addr().(*net.TCPAddr)
	return addr.Port, nil
}
