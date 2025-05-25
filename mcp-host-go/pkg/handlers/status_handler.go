package handlers

import (
	"fmt"
	"runtime"
	"time"

	"github.com/algonius/algonius-browser/mcp-host-go/pkg/logger"
	"github.com/algonius/algonius-browser/mcp-host-go/pkg/types"
	"go.uber.org/zap"
)

// Build information variables - these will be set at build time via ldflags
var (
	Version   = "dev"             // Version of the MCP host
	BuildTime = "unknown"         // Build timestamp
	GitCommit = "unknown"         // Git commit hash
	GoVersion = runtime.Version() // Go version used to build
)

// StatusHandler handles status requests from the browser extension
type StatusHandler struct {
	logger      logger.Logger
	startTime   time.Time
	ssePort     string
	sseBaseURL  string
	sseBasePath string
}

// StatusHandlerConfig contains configuration for the StatusHandler
type StatusHandlerConfig struct {
	Logger      logger.Logger
	StartTime   time.Time
	SSEPort     string
	SSEBaseURL  string
	SSEBasePath string
}

// StatusResponse represents the response structure for status requests
type StatusResponse struct {
	Version     string    `json:"version"`
	SSEPort     string    `json:"sse_port"`
	SSEBaseURL  string    `json:"sse_base_url"`
	SSEBasePath string    `json:"sse_base_path"`
	StartTime   time.Time `json:"start_time"`
	CurrentTime time.Time `json:"current_time"`
	Uptime      string    `json:"uptime"`
	BuildInfo   BuildInfo `json:"build_info"`
}

// BuildInfo contains build-time information
type BuildInfo struct {
	GoVersion string `json:"go_version"`
	BuildTime string `json:"build_time"`
	GitCommit string `json:"git_commit"`
}

// NewStatusHandler creates a new StatusHandler instance
func NewStatusHandler(config StatusHandlerConfig) (*StatusHandler, error) {
	if config.Logger == nil {
		return nil, fmt.Errorf("logger is required")
	}

	return &StatusHandler{
		logger:      config.Logger,
		startTime:   config.StartTime,
		ssePort:     config.SSEPort,
		sseBaseURL:  config.SSEBaseURL,
		sseBasePath: config.SSEBasePath,
	}, nil
}

// HandleStatus handles the status RPC request
func (sh *StatusHandler) HandleStatus(request types.RpcRequest) (types.RpcResponse, error) {
	sh.logger.Debug("Handling status request", zap.String("id", request.ID))

	// Calculate uptime
	uptime := time.Since(sh.startTime)
	uptimeStr := formatDuration(uptime)

	// Create status response
	status := StatusResponse{
		Version:     Version,
		SSEPort:     sh.ssePort,
		SSEBaseURL:  sh.sseBaseURL,
		SSEBasePath: sh.sseBasePath,
		StartTime:   sh.startTime,
		CurrentTime: time.Now(),
		Uptime:      uptimeStr,
		BuildInfo: BuildInfo{
			GoVersion: GoVersion,
			BuildTime: BuildTime,
			GitCommit: GitCommit,
		},
	}

	sh.logger.Debug("Status response prepared",
		zap.String("version", status.Version),
		zap.String("uptime", status.Uptime),
		zap.Time("start_time", status.StartTime),
		zap.Time("current_time", status.CurrentTime))

	return types.RpcResponse{
		ID:     request.ID,
		Result: status,
	}, nil
}

// formatDuration formats a duration into a human-readable string
func formatDuration(d time.Duration) string {
	if d < time.Minute {
		return fmt.Sprintf("%.0fs", d.Seconds())
	} else if d < time.Hour {
		minutes := int(d.Minutes())
		seconds := int(d.Seconds()) % 60
		if seconds == 0 {
			return fmt.Sprintf("%dm", minutes)
		}
		return fmt.Sprintf("%dm%ds", minutes, seconds)
	} else if d < 24*time.Hour {
		hours := int(d.Hours())
		minutes := int(d.Minutes()) % 60
		if minutes == 0 {
			return fmt.Sprintf("%dh", hours)
		}
		return fmt.Sprintf("%dh%dm", hours, minutes)
	} else {
		days := int(d.Hours()) / 24
		hours := int(d.Hours()) % 24
		if hours == 0 {
			return fmt.Sprintf("%dd", days)
		}
		return fmt.Sprintf("%dd%dh", days, hours)
	}
}
