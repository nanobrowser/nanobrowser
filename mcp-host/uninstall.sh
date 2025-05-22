#!/bin/bash

# Nanobrowser MCP Native Messaging Host Uninstaller
# This script uninstalls the Native Messaging Host and cleans up related processes

# Exit on any error
set -e

# Define colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Default port
DEFAULT_PORT=7890

# Native messaging host name (must match what was used in install.sh)
HOST_NAME="dev.nanobrowser.mcp.host"

# Print a colored message
print_message() {
  local color=$1
  local message=$2
  echo -e "${color}${message}${NC}"
}

# Print an error message and exit
error_exit() {
  print_message "${RED}${BOLD}ERROR:${NC} $1"
  exit 1
}

# Detect OS and set appropriate directories
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
  PLATFORM="linux"
  # User-level directories
  CHROME_NM_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
  CHROME_CANARY_NM_DIR="$HOME/.config/google-chrome-unstable/NativeMessagingHosts"
  CHROME_DEV_NM_DIR="$HOME/.config/google-chrome-unstable/NativeMessagingHosts"
  CHROMIUM_NM_DIR="$HOME/.config/chromium/NativeMessagingHosts"
elif [[ "$OSTYPE" == "darwin"* ]]; then
  PLATFORM="macos"
  # User-level directories
  CHROME_NM_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  CHROME_CANARY_NM_DIR="$HOME/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts"
  CHROME_DEV_NM_DIR="$HOME/Library/Application Support/Google/Chrome Dev/NativeMessagingHosts"
  CHROMIUM_NM_DIR="$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
else
  error_exit "Unsupported platform: $OSTYPE. This script only supports Linux and macOS."
fi

# Display help message
show_help() {
  echo "Nanobrowser MCP Native Messaging Host Uninstaller"
  echo ""
  echo "Usage: $0 [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  --port <port>     Specify the port used by the MCP server (default: $DEFAULT_PORT)"
  echo "  --keep-logs       Do not remove log files"
  echo "  --force           Force killing processes without confirmation"
  echo "  --help            Display this help message and exit"
  echo ""
  exit 0
}

# Parse command line arguments
PORT=$DEFAULT_PORT
KEEP_LOGS=false
FORCE=false

while [[ $# -gt 0 ]]; do
  key="$1"
  case $key in
    --port)
      PORT="$2"
      shift
      shift
      ;;
    --keep-logs)
      KEEP_LOGS=true
      shift
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --help)
      show_help
      ;;
    *)
      error_exit "Unknown option: $key"
      ;;
  esac
done

# Get the directory of the script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
LOGS_DIR="$HOME/.nanobrowser/logs"

# Display header
print_message "${BLUE}${BOLD}Nanobrowser MCP Native Messaging Host Uninstaller${NC}"
print_message "${BLUE}Platform detected: ${BOLD}$PLATFORM${NC}"

# Confirm uninstallation unless --force is specified
if [[ "$FORCE" != "true" ]]; then
  echo ""
  read -p "Do you want to uninstall the MCP Host and clean up associated processes? (y/n): " CONFIRM
  if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    echo "Uninstallation cancelled."
    exit 0
  fi
fi

# Function to kill MCP-related processes
kill_mcp_processes() {
  print_message "${BLUE}Searching for MCP Host processes...${NC}"
  
  # Find Node processes running dist/index.js or containing mcp-host in their command line
  local MCP_PIDS=$(ps aux | grep -E "node.*dist/index.js|nanobrowser.*mcp.*host" | grep -v grep | awk '{print $2}')
  
  if [[ -z "$MCP_PIDS" ]]; then
    print_message "${GREEN}No MCP Host processes found.${NC}"
    return 0
  fi
  
  print_message "${YELLOW}Found MCP Host processes with PIDs: $MCP_PIDS${NC}"
  
  # Kill each process
  for PID in $MCP_PIDS; do
    print_message "${BLUE}Terminating process with PID: $PID${NC}"
    kill -15 $PID 2>/dev/null || true
    
    # Check if process is still running after a brief wait
    sleep 0.5
    if ps -p $PID > /dev/null 2>&1; then
      print_message "${YELLOW}Process $PID still running, sending SIGKILL...${NC}"
      kill -9 $PID 2>/dev/null || true
    fi
  done
  
  print_message "${GREEN}MCP Host processes terminated.${NC}"
}

# Function to free up the port
free_port() {
  print_message "${BLUE}Checking for processes using port $PORT...${NC}"
  
  local PORT_PIDS=""
  if [[ "$PLATFORM" == "linux" ]]; then
    # Using lsof or netstat based on what's available
    if command -v lsof &> /dev/null; then
      PORT_PIDS=$(lsof -ti:$PORT 2>/dev/null || echo "")
    elif command -v netstat &> /dev/null; then
      PORT_PIDS=$(netstat -tuln | grep ":$PORT " | awk '{print $7}' | cut -d'/' -f1)
    fi
  elif [[ "$PLATFORM" == "macos" ]]; then
    # On macOS, use lsof
    PORT_PIDS=$(lsof -ti:$PORT 2>/dev/null || echo "")
  fi
  
  if [[ -z "$PORT_PIDS" ]]; then
    print_message "${GREEN}No processes found using port $PORT.${NC}"
    return 0
  fi
  
  print_message "${YELLOW}Found processes using port $PORT with PIDs: $PORT_PIDS${NC}"
  
  # Kill each process using the port
  for PID in $PORT_PIDS; do
    print_message "${BLUE}Terminating process with PID: $PID that's using port $PORT${NC}"
    kill -15 $PID 2>/dev/null || true
    
    # Check if process is still running after a brief wait
    sleep 0.5
    if ps -p $PID > /dev/null 2>&1; then
      print_message "${YELLOW}Process $PID still running, sending SIGKILL...${NC}"
      kill -9 $PID 2>/dev/null || true
    fi
  done
  
  # Verify port is freed
  sleep 1
  local STILL_IN_USE=false
  
  if [[ "$PLATFORM" == "linux" ]]; then
    if command -v lsof &> /dev/null; then
      lsof -ti:$PORT &>/dev/null && STILL_IN_USE=true
    elif command -v netstat &> /dev/null; then
      netstat -tuln | grep -q ":$PORT " && STILL_IN_USE=true
    fi
  elif [[ "$PLATFORM" == "macos" ]]; then
    lsof -ti:$PORT &>/dev/null && STILL_IN_USE=true
  fi
  
  if [[ "$STILL_IN_USE" == "true" ]]; then
    print_message "${RED}Port $PORT is still in use after termination attempts.${NC}"
    print_message "${YELLOW}You may need to manually find and terminate the process using this port.${NC}"
  else
    print_message "${GREEN}Port $PORT successfully freed.${NC}"
  fi
}

# Function to remove manifest files
remove_manifests() {
  print_message "${BLUE}Removing Native Messaging Host manifests...${NC}"
  
  local MANIFEST_FILENAME="$HOST_NAME.json"
  local MANIFEST_PATHS=(
    "$CHROME_NM_DIR/$MANIFEST_FILENAME"
    "$CHROME_CANARY_NM_DIR/$MANIFEST_FILENAME"
    "$CHROME_DEV_NM_DIR/$MANIFEST_FILENAME"
    "$CHROMIUM_NM_DIR/$MANIFEST_FILENAME"
  )
  
  for MANIFEST_PATH in "${MANIFEST_PATHS[@]}"; do
    if [[ -f "$MANIFEST_PATH" ]]; then
      rm -f "$MANIFEST_PATH"
      print_message "${GREEN}Removed manifest: $MANIFEST_PATH${NC}"
    else
      print_message "${YELLOW}Manifest not found: $MANIFEST_PATH${NC}"
    fi
  done
}

# Function to handle log files
handle_logs() {
  if [[ "$KEEP_LOGS" == "true" ]]; then
    print_message "${BLUE}Keeping log files in $LOGS_DIR as requested.${NC}"
    return 0
  fi
  
  if [[ -d "$LOGS_DIR" ]]; then
    print_message "${BLUE}Cleaning up log files in $LOGS_DIR...${NC}"
    
    # Ask for confirmation before removing logs, unless force mode is enabled
    if [[ "$FORCE" != "true" ]]; then
      read -p "Do you want to remove all log files? (y/n): " CONFIRM
      if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
        print_message "${YELLOW}Log files will be kept.${NC}"
        return 0
      fi
    fi
    
    # Remove log files
    rm -f "$LOGS_DIR"/*.log
    print_message "${GREEN}Log files removed.${NC}"
  else
    print_message "${YELLOW}Log directory not found: $LOGS_DIR${NC}"
  fi
}

# Function to clean up host script
clean_host_script() {
  local HOST_SCRIPT="$SCRIPT_DIR/mcp-host.sh"
  
  if [[ -f "$HOST_SCRIPT" ]]; then
    print_message "${BLUE}Removing host script: $HOST_SCRIPT${NC}"
    rm -f "$HOST_SCRIPT"
    print_message "${GREEN}Host script removed.${NC}"
  else
    print_message "${YELLOW}Host script not found: $HOST_SCRIPT${NC}"
  fi
}

# Main uninstall function
main() {
  # Kill any running MCP processes
  kill_mcp_processes
  
  # Free up the port
  free_port
  
  # Remove manifest files
  remove_manifests
  
  # Clean up host script
  clean_host_script
  
  # Handle log files
  handle_logs
  
  print_message "${GREEN}${BOLD}Nanobrowser MCP Native Messaging Host has been uninstalled!${NC}"
  print_message "${YELLOW}Note: You may need to restart Chrome for the changes to take effect.${NC}"
}

# Run the main uninstall function
main
