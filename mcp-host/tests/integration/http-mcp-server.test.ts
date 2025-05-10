/**
 * HTTP MCP Server Tests
 *
 * NOTE: These tests are currently skipped when running with Vitest due to serialization issues.
 *
 * Problem: The tests use axios for HTTP requests, which contains non-serializable functions.
 * When Vitest tries to pass objects between processes, it encounters DataCloneError.
 *
 * Possible solutions:
 * 1. Create a custom mock HTTP client that doesn't rely on axios (preferred long-term solution)
 * 2. Use the fetch API instead of axios, which is more serialization-friendly
 * 3. Create a lightweight wrapper around axios that creates fresh instances for each request
 * 4. Update Vitest config to run HTTP tests in a single process with better serialization options
 *
 * For now, these tests are skipped to allow the rest of the test suite to run properly.
 * The tests still work with Jest if needed via `pnpm run test:jest:integration`.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { BrowserMcpServer } from '../../src/http-mcp-server';
import { MockExtension } from './mock-extension';
import { MockMcpHttpClient } from './mock-mcp-http-client';

// Test port for HTTP server
const TEST_PORT = 9876;

describe.skip('HTTP MCP Server Tests', () => {
  let mcpClient: MockMcpHttpClient;
  let mockExtension: MockExtension;
  let mcpServer: BrowserMcpServer;

  beforeAll(async () => {
    // Suppress console.error during tests
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  beforeEach(async () => {
    // Create fresh instances for each test
    mockExtension = new MockExtension();
    mockExtension.registerHandlers();

    // Create and configure the HTTP MCP server
    mcpServer = new BrowserMcpServer(TEST_PORT);

    // Register action callback that simulates Chrome extension behavior
    mcpServer.registerActionCallback(async (action, params) => {
      // Forward to mock extension
      return await mockExtension.handleAction(action, params);
    });

    // Set browser state
    mcpServer.setBrowserState({
      activeTab: {
        id: 1,
        url: 'https://example.com',
        title: 'Test Page',
        domState: {
          html: '<html><head><title>Test Page</title></head><body><h1>Test Page</h1></body></html>',
        },
      },
      tabs: [{ id: 1, url: 'https://example.com', title: 'Test Page', active: true }],
    });

    // Start the server
    await mcpServer.start();

    // Set up the client
    mcpClient = new MockMcpHttpClient(`http://localhost:${TEST_PORT}`);
  });

  afterEach(async () => {
    // Clean up after each test
    if (mcpClient) {
      await mcpClient.close();
    }

    if (mcpServer) {
      await mcpServer.stop();
    }
  });

  afterAll(() => {
    // Restore console.error
    vi.restoreAllMocks();
  });

  test('should initialize session', async () => {
    // Initialize session and verify response
    const result = await mcpClient.initialize();

    expect(result).toBeDefined();
    expect(result.result).toBeDefined();
    expect(mcpClient.getSessionId()).not.toBeNull();
  });

  test('should list available resources', async () => {
    // Initialize first (required)
    await mcpClient.initialize();

    // List resources
    const result = await mcpClient.listResources();

    expect(result).toBeDefined();
    expect(result.result).toBeDefined();
    expect(result.result.resources).toBeDefined();
    expect(Array.isArray(result.result.resources)).toBe(true);
    expect(result.result.resources.length).toBeGreaterThan(0);

    // There should be at least the current browser state resource
    const hasStateResource = result.result.resources.some(
      (r: any) => typeof r === 'object' && r.uri && r.uri.includes('browser://current/state'),
    );
    expect(hasStateResource).toBe(true);
  });

  test('should read browser state resource', async () => {
    // Initialize first (required)
    await mcpClient.initialize();

    // Read browser state resource
    const result = await mcpClient.readResource('browser://current/state');

    expect(result).toBeDefined();
    expect(result.result).toBeDefined();
    expect(result.result.contents).toBeDefined();
    expect(Array.isArray(result.result.contents)).toBe(true);
    expect(result.result.contents.length).toBeGreaterThan(0);

    // Parse and check content
    const content = result.result.contents[0];
    expect(content).toHaveProperty('text');

    const state = JSON.parse(content.text);
    expect(state).toHaveProperty('activeTab');
    expect(state.activeTab.url).toBe('https://example.com');
    expect(state.activeTab.title).toBe('Test Page');
  });

  test('should execute navigation tool', async () => {
    // Initialize first (required)
    await mcpClient.initialize();

    // Execute navigation tool
    const result = await mcpClient.callTool('navigate_to', { url: 'https://example.org' });

    expect(result).toBeDefined();
    expect(result.result).toBeDefined();
    expect(result.result.content).toBeDefined();

    // Parse tool execution result
    const content = result.result.content[0];
    expect(content).toHaveProperty('text');

    const toolResult = JSON.parse(content.text);
    expect(toolResult).toHaveProperty('success');
    expect(toolResult.success).toBe(true);

    // Verify that the mock extension received the action
    const actions = mockExtension.getActions();
    expect(actions.length).toBe(1);
    expect(actions[0].action).toBe('navigate_to');
    expect(actions[0].params.url).toBe('https://example.org');
  });

  test('should handle server-sent events', async () => {
    // Initialize client
    await mcpClient.initialize();

    // Simulate state change that should trigger a notification
    const newState = {
      activeTab: {
        id: 1,
        url: 'https://example.org',
        title: 'New Page',
        domState: {
          html: '<html><head><title>New Page</title></head><body><h1>New Content</h1></body></html>',
        },
      },
      tabs: [{ id: 1, url: 'https://example.org', title: 'New Page', active: true }],
    };

    // Update server's browser state
    mcpServer.setBrowserState(newState);

    // Wait a bit for the notification to be sent
    await new Promise(resolve => setTimeout(resolve, 100));

    // Check for notifications (this will be empty until server-sent events are implemented)
    const notifications = mcpClient.getNotifications();

    // This is just a placeholder test - in a real implementation, we would expect notifications
    expect(notifications).toBeDefined();
  });
});
