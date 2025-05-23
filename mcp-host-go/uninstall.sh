#!/bin/bash

set -e

# Set variables
BINARY_NAME="mcp-host"
INSTALL_DIR="${HOME}/.nanobrowser/bin"
MANIFEST_DIR="${HOME}/.config/google-chrome/NativeMessagingHosts"
MANIFEST_NAME="dev.nanobrowser.mcp.host.json"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log() {
  echo -e "${GREEN}[MCP-HOST-GO]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[MCP-HOST-GO]${NC} $1"
}

error() {
  echo -e "${RED}[MCP-HOST-GO]${NC} $1"
  exit 1
}

# Remove the binary
if [ -f "${INSTALL_DIR}/${BINARY_NAME}" ]; then
  log "Removing binary: ${INSTALL_DIR}/${BINARY_NAME}"
  rm "${INSTALL_DIR}/${BINARY_NAME}"
else
  warn "Binary not found: ${INSTALL_DIR}/${BINARY_NAME}"
fi

# Remove manifest file
if [ -f "${MANIFEST_DIR}/${MANIFEST_NAME}" ]; then
  log "Removing manifest: ${MANIFEST_DIR}/${MANIFEST_NAME}"
  rm "${MANIFEST_DIR}/${MANIFEST_NAME}"
else
  warn "Manifest not found: ${MANIFEST_DIR}/${MANIFEST_NAME}"
fi

# Clean up installation directory if empty
if [ -d "${INSTALL_DIR}" ] && [ -z "$(ls -A "${INSTALL_DIR}")" ]; then
  log "Removing empty installation directory: ${INSTALL_DIR}"
  rmdir "${INSTALL_DIR}"
fi

log "Uninstallation completed successfully!"
