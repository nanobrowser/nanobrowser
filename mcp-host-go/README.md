# MCP Host Go Implementation

A Go implementation of the MCP (Model Context Protocol) host for the Algonius Browser project. This implementation provides a simple SSE server that forwards requests to Chrome extension via Native Messaging.

## Features

- SSE (Server-Sent Events) MCP server implementation
- Chrome Native Messaging communication
- Clean architecture with dependency injection
- Type-safe implementation
- Extensible resource and tool system
- Configurable logging system

## Architecture

The MCP Host uses a simplified single-server architecture:

```
外部AI系统 → SSE Server → Native Messaging → Chrome扩展
```

See [docs/sse-mcp-architecture.md](../docs/sse-mcp-architecture.md) for detailed architectural documentation.

## Project Structure

```
mcp-host-go/
├── cmd/
│   └── mcp-host/           # Main application entry point
│       └── main.go
├── pkg/
│   ├── logger/             # Logging package
│   │   └── logger.go
│   ├── messaging/          # Native messaging communication
│   │   └── native_messaging.go
│   ├── sse/                # SSE MCP server implementation
│   │   └── server.go
│   ├── resources/          # MCP resources
│   │   └── current_state.go
│   ├── tools/              # MCP tools
│   │   └── navigate_to.go
│   └── types/              # Common types and interfaces
│       └── types.go
├── install.sh              # Installation script
├── uninstall.sh            # Uninstallation script
├── Makefile                # Build and development targets
└── README.md               # This file
```

## Building and Installation

### Prerequisites

- Go 1.18 or higher
- Chrome/Chromium browser

### Building

```bash
# Build the binary
make build

# Or build and install
make install
```

### Development

```bash
# Run in development mode
make dev

# Build for production
make build

# Clean build artifacts
make clean
```

## Configuration

The server can be configured using environment variables:

- `SSE_PORT`: SSE server port (default: :8080)
- `SSE_BASE_URL`: SSE server base URL (default: http://localhost:8080)
- `SSE_BASE_PATH`: SSE server base path (default: /mcp)
- `RUN_MODE`: Run mode (development/production, default: production)
- `LOG_LEVEL`: Set the logging level (ERROR, WARN, INFO, DEBUG)

## Usage

### Starting the Server

```bash
# Start the server
./build/mcp-host
```

The SSE MCP server will be available at `http://localhost:8080/mcp`.

### Connecting External AI Systems

External AI systems can connect to the MCP host via:

- **HTTP POST**: `http://localhost:8080/mcp` - For one-time requests
- **SSE**: `http://localhost:8080/mcp/sse` - For persistent connections and event streams

## Development

### Dependency Injection

This implementation uses a clean dependency injection approach where all components are defined by interfaces and injected during initialization. This provides:

1. **Loose coupling**: Components are not directly dependent on concrete implementations
2. **Testability**: Easy to mock dependencies for testing
3. **Flexibility**: Can swap out implementations without changing client code
4. **Configuration**: Components can be configured at initialization time

### Key Interfaces

Key interfaces are defined in the `pkg/types/types.go` file:

- `Logger`: Logging interface
- `Messaging`: Communication interface for native messaging
- `Resource`: MCP resource interface
- `Tool`: MCP tool interface

### Adding a New Tool

1. Create a new file in the `pkg/tools/` directory
2. Implement the `types.Tool` interface
3. Update `cmd/mcp-host/main.go` to create and register the new tool

### Adding a New Resource

1. Create a new file in the `pkg/resources/` directory
2. Implement the `types.Resource` interface
3. Update `cmd/mcp-host/main.go` to create and register the new resource

## Installation and Manifest

The installation script creates a Chrome native messaging manifest file that allows the Chrome extension to communicate with this host:

```bash
# Install (creates manifest and copies binary)
./install.sh

# Uninstall (removes manifest and binary)
./uninstall.sh
```

## License

See the LICENSE file in the root directory of the project.
