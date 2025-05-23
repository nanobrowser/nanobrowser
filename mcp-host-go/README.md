# MCP Host Go Implementation

A Go implementation of the MCP (Model Context Protocol) host for the Algonius Browser project. This implementation uses dependency injection for all components to improve maintainability, testability, and flexibility.

## Features

- Clean architecture with dependency injection
- Type-safe implementation
- Chrome native messaging communication
- Extensible resource and tool system
- Logging system with configurable output

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
│   ├── mcp/                # MCP server implementation
│   │   └── server.go
│   ├── resources/          # MCP resources
│   │   └── current_state.go
│   ├── tools/              # MCP tools
│   │   └── navigate_to.go
│   └── types/              # Common types and interfaces
│       └── types.go
├── install.sh              # Installation script
├── uninstall.sh            # Uninstallation script
└── README.md               # This file
```

## Dependency Injection

This implementation uses a clean dependency injection approach where all components are defined by interfaces and injected during initialization. This provides several benefits:

1. **Loose coupling**: Components are not directly dependent on concrete implementations
2. **Testability**: Easy to mock dependencies for testing
3. **Flexibility**: Can swap out implementations without changing client code
4. **Configuration**: Components can be configured at initialization time

The main dependency injection container is defined in `cmd/mcp-host/main.go` and is responsible for creating and wiring up all components.

## Interfaces

Key interfaces are defined in the `pkg/types/types.go` file:

- `Logger`: Logging interface
- `Messaging`: Communication interface for native messaging
- `McpServer`: MCP server interface
- `Resource`: MCP resource interface
- `Tool`: MCP tool interface

## Building and Installation

### Prerequisites

- Go 1.18 or higher
- Chrome/Chromium browser

### Building and Installing

```bash
# Clone the repository
git clone https://github.com/algonius/algonius-browser.git
cd algonius-browser/mcp-host-go

# Build and install
./install.sh
```

### Uninstalling

```bash
./uninstall.sh
```

## Development

### Adding a New Tool

1. Create a new file in the `pkg/tools/` directory
2. Implement the `types.Tool` interface
3. Update `cmd/mcp-host/main.go` to create and register the new tool

### Adding a New Resource

1. Create a new file in the `pkg/resources/` directory
2. Implement the `types.Resource` interface
3. Update `cmd/mcp-host/main.go` to create and register the new resource

## Environment Variables

- `LOG_LEVEL`: Set the logging level (ERROR, WARN, INFO, DEBUG)
- `LOG_DIR`: Set the log directory
- `LOG_FILE`: Set the log file name
- `RUN_MODE`: Set the run mode (development, production)

## License

See the LICENSE file in the root directory of the project.
