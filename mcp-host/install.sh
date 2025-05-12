#!/bin/bash

# Nanobrowser MCP Native Messaging Host Installer
# This script installs the Native Messaging Host for macOS and Linux

# Exit on any error
set -e

# Detect OS
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
  PLATFORM="linux"
  CHROME_NM_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
  CHROME_CANARY_NM_DIR="$HOME/.config/google-chrome-unstable/NativeMessagingHosts"
  CHROMIUM_NM_DIR="$HOME/.config/chromium/NativeMessagingHosts"
elif [[ "$OSTYPE" == "darwin"* ]]; then
  PLATFORM="macos"
  CHROME_NM_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  CHROME_CANARY_NM_DIR="$HOME/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts"
  CHROMIUM_NM_DIR="$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
else
  echo "Unsupported platform: $OSTYPE"
  exit 1
fi

# Get the directory of the script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Build the host
echo "Building Nanobrowser MCP Native Messaging Host..."
cd "$SCRIPT_DIR"
npm install
npm run build

# Create the host script
HOST_SCRIPT="$SCRIPT_DIR/mcp-host.sh"
echo "#!/bin/bash" > "$HOST_SCRIPT"
echo "cd \"$SCRIPT_DIR\"" >> "$HOST_SCRIPT"
echo "node dist/index.js" >> "$HOST_SCRIPT"
chmod +x "$HOST_SCRIPT"

# Update the manifest with the correct path
MANIFEST_PATH="$SCRIPT_DIR/manifest.json"
sed -i.bak "s|HOST_PATH_PLACEHOLDER|$HOST_SCRIPT|g" "$MANIFEST_PATH"
rm "$MANIFEST_PATH.bak"

# Get the extension ID from the user
read -p "Enter your Chrome extension ID: " EXTENSION_ID
sed -i.bak "s|EXTENSION_ID_PLACEHOLDER|$EXTENSION_ID|g" "$MANIFEST_PATH"
rm "$MANIFEST_PATH.bak"

# Set log level for the host
LOG_LEVELS=("ERROR" "WARN" "INFO" "DEBUG")
DEFAULT_LOG_LEVEL="INFO"

echo "Available log levels: ${LOG_LEVELS[*]}"
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
  echo "Invalid log level: $LOG_LEVEL. Using default: $DEFAULT_LOG_LEVEL"
  LOG_LEVEL=$DEFAULT_LOG_LEVEL
fi

# Update host script with log level
sed -i.bak "s|export LOG_LEVEL=INFO|export LOG_LEVEL=$LOG_LEVEL|g" "$HOST_SCRIPT"
rm "$HOST_SCRIPT.bak"

# Create Native Messaging directories if they don't exist
mkdir -p "$CHROME_NM_DIR"
mkdir -p "$CHROME_CANARY_NM_DIR"
mkdir -p "$CHROMIUM_NM_DIR"

# Install the manifest
echo "Installing Native Messaging Host manifest..."
cp "$MANIFEST_PATH" "$CHROME_NM_DIR/"
cp "$MANIFEST_PATH" "$CHROME_CANARY_NM_DIR/"
cp "$MANIFEST_PATH" "$CHROMIUM_NM_DIR/"

echo "Nanobrowser MCP Native Messaging Host has been installed successfully!"
echo "Host path: $HOST_SCRIPT"
echo "Manifest installed in:"
echo "  - $CHROME_NM_DIR"
echo "  - $CHROME_CANARY_NM_DIR"
echo "  - $CHROMIUM_NM_DIR"
