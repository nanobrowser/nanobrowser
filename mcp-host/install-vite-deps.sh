#!/bin/bash
set -e

echo "Installing Vite dependencies for MCP Host..."

# Detect package manager
if command -v pnpm &> /dev/null; then
  echo "Using pnpm to install dependencies"
  PACKAGE_MANAGER="pnpm"
elif command -v yarn &> /dev/null; then
  echo "Using yarn to install dependencies"
  PACKAGE_MANAGER="yarn"
else
  echo "Using npm to install dependencies"
  PACKAGE_MANAGER="npm"
fi

echo "Installing vite and related packages..."
$PACKAGE_MANAGER add -D vite vitest vite-plugin-node vite-tsconfig-paths

echo "Dependencies installed successfully!"
echo "You can now run the development server with:"
echo "  $PACKAGE_MANAGER run dev"
echo "Or build the project with:"
echo "  $PACKAGE_MANAGER run build"
