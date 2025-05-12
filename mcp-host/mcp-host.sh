#!/bin/bash
cd "$(dirname "$0")"

# Set default log level if not provided
if [ -z "$LOG_LEVEL" ]; then
  export LOG_LEVEL=INFO
fi

echo "Starting MCP Host with log level: $LOG_LEVEL"
node dist/index.js
