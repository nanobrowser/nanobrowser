#!/bin/bash

# Set log level (can be overridden by install.sh)
export LOG_LEVEL=INFO

# Create logs directory if it doesn't exist
LOGS_DIR="/home/yubing/.nanobrowser/logs"
mkdir -p "$LOGS_DIR"

# Redirect stderr to log file for debugging
LOG_FILE="$LOGS_DIR/mcp-host.log"
echo "Starting MCP Host at $(date)" > "$LOG_FILE"

cd "/home/yubing/Workspace/algonius/algonius-browser/mcp-host"

# Redirect stderr to log file but keep stdout for native messaging
node dist/index.js 2>> "$LOG_FILE"
