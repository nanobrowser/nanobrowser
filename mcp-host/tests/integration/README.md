# MCP Host Integration Tests

This directory contains integration tests for the MCP Host, verifying the end-to-end functionality from process startup through communication to shutdown.

## Test Structure

The tests are organized into separate files in the `split` directory to allow running them individually:

- **process-lifecycle.test.ts**: Tests the basic process lifecycle (startup and shutdown)
- **browser-state-resources.test.ts**: Tests setting browser state and exposing it as MCP resources
- **tool-execution.test.ts**: Tests executing MCP tools and verifying they forward actions to the browser
- **error-handling.test.ts**: Tests error handling and stability
- **parallel-testing.test.ts**: Tests running multiple instances with different ports

## Running Tests

### Run all integration tests sequentially
```bash
pnpm test:integration
```

### Run a specific test file
```bash
TEST_TYPE=integration vitest run tests/integration/split/process-lifecycle.test.ts
```

## Test Environment

Tests use the `McpHostTestEnvironment` class which:

1. Manages a real MCP Host process with dynamic port allocation
2. Communicates with the host via stdio
3. Provides an HTTP client for MCP protocol requests
4. Ensures clean shutdown and resource cleanup

## Implementation Details

### Dynamic Port Allocation

The test environment automatically finds an available port, allowing tests to run in parallel (when needed) without port conflicts.

### Process Management

Each test spins up a real MCP Host process and captures all communication, allowing for comprehensive testing of the full stack.

### Mock Extension

A `MockExtension` class simulates the Chrome extension, handling host communication and providing APIs for setting browser state and handling actions.

### Mock MCP Client

A `MockMcpHttpClient` implements the client side of the MCP protocol, allowing tests to verify the HTTP interface.
