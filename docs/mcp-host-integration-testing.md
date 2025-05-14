# MCP Host Integration Testing Strategy

This document outlines a comprehensive integration testing strategy for the Nanobrowser MCP Host that ensures the deployed host functions correctly in a real-world environment.

## Core Testing Principles

The integration tests should validate that:

1. The MCP host process initializes correctly
2. Communication works properly via stdio interface
3. The HTTP server and MCP protocol implementation function as expected
4. Browser resources and tools are correctly registered and accessible
5. End-to-end flows represent real-world usage patterns

## Testing Architecture

The integration tests will use a three-tiered approach:

```
┌─────────────────┐      ┌────────────────┐      ┌────────────────────┐
│                 │      │                │      │                    │
│  Mock Browser   │      │   MCP Host     │      │    Mock MCP        │
│  Environment    │ ──── │   Process      │ ──── │    Client          │
│                 │      │   (Under Test) │      │                    │
└─────────────────┘      └────────────────┘      └────────────────────┘
     stdio communication       HTTP/JSONRPC
```

### 1. Mock Browser Environment

A simulated browser environment that:
- Spawns the actual MCP host as a child process
- Communicates with the host via stdio
- Simulates browser state and actions
- Injects test scenarios

### 2. MCP Host Process (System Under Test)

The actual MCP host code that:
- Starts up and registers resources/tools
- Processes messages from the mock browser
- Runs the HTTP server for MCP clients
- Handles MCP protocol requests

### 3. Mock MCP Client

A test client that:
- Connects to the MCP host's HTTP server
- Issues MCP protocol requests (listResources, readResource, callTool)
- Validates responses
- Tests error handling

## Test Implementation

### Test Environment Setup

```typescript
import { spawn } from 'child_process';
import { MockMcpHttpClient } from './mock-mcp-http-client';
import { createMockStdio } from '../helpers/mock-stdio';

class McpHostTestEnvironment {
  private hostProcess: ChildProcess;
  private mcpClient: MockMcpHttpClient;
  private mockStdio: { stdin: Readable; stdout: Writable; pushToStdin: Function; readFromStdout: Function };
  private port: number;
  
  constructor(options?: { port?: number }) {
    // Use provided port or generate a random available port
    this.port = options?.port || this.findAvailablePort();
  }
  
  /**
   * Find an available port for the MCP host to listen on
   * This allows multiple test instances to run in parallel
   */
  private findAvailablePort(): number {
    // Implementation to find available port
    // There are multiple ways to do this:
    // 1. Using a port range and trying to bind to each
    // 2. Using an OS-assigned ephemeral port
    // 3. Using a port allocation service
    
    // Example implementation - basic random port in allowed range
    const MIN_PORT = 10000;
    const MAX_PORT = 65535;
    return Math.floor(Math.random() * (MAX_PORT - MIN_PORT)) + MIN_PORT;
  }
  
  async setup() {
    // Create mock stdio for communicating with the host
    this.mockStdio = createMockStdio();
    
    // Start the MCP host process with mock stdio and the selected port
    this.hostProcess = spawn('node', ['./dist/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, LOG_LEVEL: 'debug', PORT: this.port.toString() }
    });
    
    // Connect mock stdio to the process
    this.hostProcess.stdin.pipe(this.mockStdio.stdin);
    this.mockStdio.stdout.pipe(this.hostProcess.stdout);
    
    // Create MCP client connected to the host's HTTP server
    this.mcpClient = new MockMcpHttpClient(`http://localhost:${this.port}`);
    
    // Wait for host to initialize
    await this.waitForHostReady();
  }
  
  /**
   * Get the port this instance is using
   */
  getPort(): number {
    return this.port;
  }
  
  // Additional methods for test control and assertions
}
```

### Core Test Scenarios

#### 1. End-to-End Process Lifecycle

```typescript
test('should initialize, process messages, and shut down cleanly', async () => {
  // Setup test environment
  const testEnv = new McpHostTestEnvironment();
  await testEnv.setup();
  
  // Send initialization message via stdio
  await testEnv.sendBrowserMessage({
    type: 'initialize',
    capabilities: { version: '1.0.0' }
  });
  
  // Verify initialization response
  const response = await testEnv.waitForResponse('initialize_result');
  expect(response.success).toBe(true);
  
  // Verify process is running
  expect(testEnv.isHostRunning()).toBe(true);
  
  // Shutdown and verify clean exit
  await testEnv.shutdown();
  expect(testEnv.getExitCode()).toBe(0);
});
```

#### 2. Browser State Resource Testing

```typescript
test('should capture browser state and expose via MCP resources', async () => {
  // Setup test environment
  const testEnv = new McpHostTestEnvironment();
  await testEnv.setup();
  
  // Initialize MCP client session
  await testEnv.mcpClient.initialize();
  
  // Set mock browser state via stdio
  await testEnv.sendBrowserMessage({
    type: 'setBrowserState',
    state: {
      activeTab: {
        id: 1,
        url: 'https://example.com',
        title: 'Test Page',
        content: '<html><body><h1>Test</h1></body></html>'
      }
    }
  });
  
  // Wait for state to be processed
  await testEnv.waitForResponse('setBrowserState_result');
  
  // Verify resource is available through MCP client
  const resources = await testEnv.mcpClient.listResources();
  expect(resources.result.resources).toContainEqual(
    expect.objectContaining({ uri: 'browser://current/state' })
  );
  
  // Read and verify resource content
  const resource = await testEnv.mcpClient.readResource('browser://current/state');
  const content = JSON.parse(resource.result.contents[0].text);
  expect(content.activeTab.url).toBe('https://example.com');
});
```

#### 3. Tool Execution Testing

```typescript
test('should execute browser navigation through MCP tool', async () => {
  // Setup test environment
  const testEnv = new McpHostTestEnvironment();
  await testEnv.setup();
  
  // Initialize MCP client
  await testEnv.mcpClient.initialize();
  
  // Verify tool is available
  const tools = await testEnv.mcpClient.listTools();
  expect(tools.result.tools).toContainEqual(
    expect.objectContaining({ name: 'navigate_to' })
  );
  
  // Register action callback handler to catch the navigation command
  let capturedAction = null;
  testEnv.registerActionHandler((action, params) => {
    capturedAction = { action, params };
    return Promise.resolve({ success: true });
  });
  
  // Execute navigation tool via MCP client
  await testEnv.mcpClient.callTool('navigate_to', { url: 'https://test.com' });
  
  // Verify navigation was requested through stdio
  expect(capturedAction).toEqual({
    action: 'navigate',
    params: { url: 'https://test.com' }
  });
});
```

#### 4. Error Handling and Edge Cases

```typescript
test('should handle malformed messages and protocol errors', async () => {
  // Setup test environment
  const testEnv = new McpHostTestEnvironment();
  await testEnv.setup();
  
  // Initialize MCP client
  await testEnv.mcpClient.initialize();
  
  // Send malformed message via stdio
  await testEnv.sendBrowserMessage({
    type: 'invalidMessageType'
  });
  
  // Verify error response
  const response = await testEnv.waitForResponse('error');
  expect(response.error).toBeDefined();
  
  // Test invalid resource URI
  try {
    await testEnv.mcpClient.readResource('invalid://uri');
    fail('Should have thrown error');
  } catch (error) {
    expect(error.response.data.error).toBeDefined();
  }
  
  // Verify process remains stable after errors
  const state = await testEnv.mcpClient.readResource('browser://current/state');
  expect(state.result).toBeDefined();
});
```

## Test Helpers Implementation

### Mock Browser Extension

```typescript
// Enhanced version of the current mock-extension.ts
class MockBrowserExtension {
  private actionHandlers = new Map<string, (action: string, params: any) => Promise<any>>();
  private stateData: any = { activeTab: null, tabs: [] };
  
  registerActionHandler(handler: (action: string, params: any) => Promise<any>) {
    this.actionHandlers.set('default', handler);
  }
  
  async handleMessage(message: any) {
    switch (message.type) {
      case 'setBrowserState':
        this.stateData = message.state;
        return { success: true };
        
      case 'executeAction':
        const handler = this.actionHandlers.get('default');
        if (!handler) return { success: false, error: 'No action handler registered' };
        return handler(message.action, message.params);
        
      default:
        return { success: false, error: 'Unknown message type' };
    }
  }
  
  getBrowserState() {
    return this.stateData;
  }
}
```

### Stdio Communication Manager

```typescript
// Enhanced version of the mock-stdio.ts
class StdioCommunicationManager {
  private stdin: PassThrough;
  private stdout: PassThrough;
  private messageQueue: any[] = [];
  private responseHandlers = new Map<string, (message: any) => void>();
  
  constructor() {
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    
    // Process incoming messages from stdout
    this.stdout.on('data', (data) => {
      try {
        // Parse message from buffer
        const message = JSON.parse(data.toString());
        this.messageQueue.push(message);
        
        // Check for response handlers
        if (message.type && message.type.endsWith('_result')) {
          const requestType = message.type.replace('_result', '');
          const handler = this.responseHandlers.get(requestType);
          if (handler) {
            handler(message);
            this.responseHandlers.delete(requestType);
          }
        }
      } catch (error) {
        console.error('Error processing stdout data', error);
      }
    });
  }
  
  async sendMessage(message: any): Promise<any> {
    return new Promise((resolve) => {
      // Register response handler
      this.responseHandlers.set(message.type, resolve);
      
      // Send message to stdin
      this.stdin.write(JSON.stringify(message) + '\n');
    });
  }
  
  getMessageQueue(): any[] {
    return [...this.messageQueue];
  }
  
  clearMessageQueue() {
    this.messageQueue = [];
  }
  
  getStdin(): PassThrough {
    return this.stdin;
  }
  
  getStdout(): PassThrough {
    return this.stdout;
  }
}
```

## Test Suite Organization

The integration tests should be organized into test suites focused on specific functional areas:

1. **Process Lifecycle Tests**: Starting up, initial communication, clean shutdown
2. **Resource Management Tests**: Registration, listing, and reading of browser resources
3. **Tool Execution Tests**: Tool registration, listing, and execution
4. **Protocol Compliance Tests**: Adherence to MCP protocol spec
5. **Error Handling Tests**: Graceful handling of errors, stability after errors
6. **Performance Tests**: Response times under various loads

## Implementation Plan

1. Create the core test infrastructure
   - `McpHostTestEnvironment` class
   - Enhanced mock browser extension
   - Improved stdio communication manager

2. Implement basic functional tests
   - Process lifecycle
   - Resource accessibility
   - Tool execution

3. Add edge case and error handling tests
   - Invalid inputs
   - Protocol violations
   - Concurrent operations

4. Implement performance and stability tests
   - Long-running tests
   - Load testing

## Conclusion

This integration testing approach will ensure the MCP host functions correctly in a real-world environment by:

1. Testing the actual processes and communication channels used in production
2. Validating end-to-end flows from browser to MCP client
3. Ensuring robustness through edge case and error testing
4. Maintaining a clear separation between the system under test and test components

When these tests pass, we can be confident that the deployed MCP host will work correctly when interacting with both the browser extension and external MCP clients.
