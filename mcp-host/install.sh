#!/bin/bash

# Nanobrowser MCP Native Messaging Host Installer
# This script installs the Native Messaging Host for macOS and Linux

# Exit on any error
set -e

# Define colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

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

# Native messaging host name (must follow Chrome's naming rules)
HOST_NAME="dev.nanobrowser.mcp.host"

# Detect OS
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
  PLATFORM="linux"
  # User-level directories
  CHROME_NM_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
  CHROME_CANARY_NM_DIR="$HOME/.config/google-chrome-unstable/NativeMessagingHosts"
  CHROME_DEV_NM_DIR="$HOME/.config/google-chrome-unstable/NativeMessagingHosts"
  CHROMIUM_NM_DIR="$HOME/.config/chromium/NativeMessagingHosts"
  # System-level directories (would require sudo)
  # CHROME_NM_SYS_DIR="/etc/opt/chrome/native-messaging-hosts"
  # CHROMIUM_NM_SYS_DIR="/etc/chromium/native-messaging-hosts"
elif [[ "$OSTYPE" == "darwin"* ]]; then
  PLATFORM="macos"
  # User-level directories
  CHROME_NM_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  CHROME_CANARY_NM_DIR="$HOME/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts"
  CHROME_DEV_NM_DIR="$HOME/Library/Application Support/Google/Chrome Dev/NativeMessagingHosts"
  CHROMIUM_NM_DIR="$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
  # System-level directories (would require sudo)
  # CHROME_NM_SYS_DIR="/Library/Google/Chrome/NativeMessagingHosts"
  # CHROMIUM_NM_SYS_DIR="/Library/Application Support/Chromium/NativeMessagingHosts"
else
  error_exit "Unsupported platform: $OSTYPE. This script only supports Linux and macOS."
fi

print_message "${BLUE}${BOLD}Nanobrowser MCP Native Messaging Host Installer${NC}"
print_message "${BLUE}Platform detected: ${BOLD}$PLATFORM${NC}"

# Get the directory of the script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
print_message "${BLUE}Installation directory: ${BOLD}$SCRIPT_DIR${NC}"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
  error_exit "Node.js is not installed. Please install Node.js and try again."
fi

# Skip build since we've already built it
print_message "${GREEN}Using existing build for Nanobrowser MCP Native Messaging Host...${NC}"
cd "$SCRIPT_DIR"

# Create required directories
NANOBROWSER_DIR="$HOME/.nanobrowser"
LOGS_DIR="$NANOBROWSER_DIR/logs"
BIN_DIR="$NANOBROWSER_DIR/bin"
APP_DIR="$NANOBROWSER_DIR/app"

mkdir -p "$LOGS_DIR"
mkdir -p "$BIN_DIR"
mkdir -p "$APP_DIR"

print_message "${BLUE}Directories created:${NC}"
print_message "${BLUE}  - Log directory: ${BOLD}$LOGS_DIR${NC}"
print_message "${BLUE}  - Binary directory: ${BOLD}$BIN_DIR${NC}"
print_message "${BLUE}  - Application directory: ${BOLD}$APP_DIR${NC}"

# Copy application files
print_message "${BLUE}Copying application files...${NC}"
if [ -d "$SCRIPT_DIR/dist" ]; then
  cp -r "$SCRIPT_DIR/dist"/* "$APP_DIR/"
  
  print_message "${GREEN}Application files copied successfully.${NC}"
else
  error_exit "Build directory 'dist' not found. Please build the project first with 'npm run build'."
fi

# Create the host script
HOST_SCRIPT="$BIN_DIR/mcp-host.sh"
print_message "${BLUE}Creating host script: ${BOLD}$HOST_SCRIPT${NC}"

cat > "$HOST_SCRIPT" << EOF
#!/bin/bash

# Set log level (can be overridden by install.sh)
export LOG_LEVEL=INFO

# Set log directory and file
export LOG_DIR="$HOME/.nanobrowser/logs"
export LOG_FILE="mcp-host.log"

# Create logs directory if it doesn't exist
mkdir -p "\$LOG_DIR"

# Use the application from the installed location
cd "$APP_DIR"

# Run MCP host - logs are handled internally by the Logger class
node index.cjs
EOF

chmod +x "$HOST_SCRIPT"

# Create/update the manifest with the correct values - using proper naming convention
MANIFEST_FILENAME="$HOST_NAME.json"
MANIFEST_PATH="$SCRIPT_DIR/$MANIFEST_FILENAME"
print_message "${BLUE}Creating Native Messaging Host manifest: ${BOLD}$MANIFEST_PATH${NC}"

# Get the extension ID from the user
print_message "${YELLOW}The extension ID is required to connect Chrome with the native messaging host.${NC}"
read -p "Enter your Chrome extension ID: " EXTENSION_ID
if [[ -z "$EXTENSION_ID" ]]; then
  error_exit "Extension ID cannot be empty."
fi

# Check if extension ID matches the expected format (32 character string)
if ! [[ $EXTENSION_ID =~ ^[a-z]{32}$ ]]; then
  print_message "${YELLOW}Warning: Extension ID format looks unusual. Standard Chrome extension IDs are 32 lowercase letters.${NC}"
  read -p "Continue anyway? (y/n): " CONFIRM
  if [[ "$CONFIRM" != "y" ]]; then
    error_exit "Installation aborted by user."
  fi
fi

# Create the manifest JSON directly
cat > "$MANIFEST_PATH" << EOF
{
  "name": "$HOST_NAME",
  "description": "Nanobrowser MCP Native Messaging Host",
  "path": "$HOST_SCRIPT",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF

# Set log level for the host
LOG_LEVELS=("ERROR" "WARN" "INFO" "DEBUG")
DEFAULT_LOG_LEVEL="INFO"

print_message "${BLUE}Available log levels: ${BOLD}${LOG_LEVELS[*]}${NC}"
read -p "Enter log level for MCP Host [default: $DEFAULT_LOG_LEVEL]: " LOG_LEVEL

# Validate and set log level
LOG_LEVEL=${LOG_LEVEL:-$DEFAULT_LOG_LEVEL}
LOG_LEVEL=$(echo "$LOG_LEVEL" | tr '[:lower:]' '[:upper:]')
VALID_LEVEL=false

for level in "${LOG_LEVELS[@]}"; do
  if [ "$LOG_LEVEL" = "$level" ]; then
    VALID_LEVEL=true
    break
  fi
done

if [ "$VALID_LEVEL" = false ]; then
  print_message "${YELLOW}Invalid log level: $LOG_LEVEL. Using default: $DEFAULT_LOG_LEVEL${NC}"
  LOG_LEVEL=$DEFAULT_LOG_LEVEL
fi

# Update host script with log level
sed -i.bak "s|export LOG_LEVEL=INFO|export LOG_LEVEL=$LOG_LEVEL|g" "$HOST_SCRIPT"
rm "$HOST_SCRIPT.bak"

print_message "${GREEN}Logs will be written to $HOME/.nanobrowser/logs/mcp-host.log${NC}"

# Create Native Messaging directories if they don't exist
print_message "${BLUE}Creating Native Messaging Host directories...${NC}"
mkdir -p "$CHROME_NM_DIR"
mkdir -p "$CHROME_CANARY_NM_DIR"
mkdir -p "$CHROME_DEV_NM_DIR"
mkdir -p "$CHROMIUM_NM_DIR"

# Install the manifest with proper name
print_message "${BLUE}Installing Native Messaging Host manifest...${NC}"
cp "$MANIFEST_PATH" "$CHROME_NM_DIR/$MANIFEST_FILENAME"
cp "$MANIFEST_PATH" "$CHROME_CANARY_NM_DIR/$MANIFEST_FILENAME"
cp "$MANIFEST_PATH" "$CHROME_DEV_NM_DIR/$MANIFEST_FILENAME"
cp "$MANIFEST_PATH" "$CHROMIUM_NM_DIR/$MANIFEST_FILENAME"

# Verify installation
if [ -f "$CHROME_NM_DIR/$MANIFEST_FILENAME" ]; then
  print_message "${GREEN}${BOLD}Nanobrowser MCP Native Messaging Host has been installed successfully!${NC}"
  print_message "${GREEN}Host path: ${BOLD}$HOST_SCRIPT${NC}"
  print_message "${GREEN}${BOLD}Manifest installed in:${NC}"
  print_message "${GREEN}  - $CHROME_NM_DIR${NC}"
  print_message "${GREEN}  - $CHROME_CANARY_NM_DIR${NC}"
  print_message "${GREEN}  - $CHROME_DEV_NM_DIR${NC}"
  print_message "${GREEN}  - $CHROMIUM_NM_DIR${NC}"
else
  error_exit "Failed to install the Native Messaging Host manifest."
fi

print_message "${YELLOW}${BOLD}Important:${NC} If you are using Chrome, you may need to restart it for the changes to take effect."
print_message "${YELLOW}If you still receive 'Native host not found' errors, please verify:${NC}"
print_message "${YELLOW}1. The extension ID is correct ($EXTENSION_ID)${NC}"
print_message "${YELLOW}2. The Chrome process can access $HOST_SCRIPT${NC}"
print_message "${YELLOW}3. Check the logs at $HOME/.nanobrowser/logs/mcp-host.log for any errors${NC}"