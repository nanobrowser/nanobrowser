import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
// Rename the file from mcp-http.test.ts to mcp-server.test.ts as it's not testing HTTP anymore
import { McpServer } from '../../src/mcp-server';
import { MockExtension } from './mock-extension';

describe('MCP Server Tests', () => {
  let mockExtension: MockExtension;
  let mcpServer: McpServer;

  beforeAll(async () => {
    // Suppress console.error during tests
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  beforeEach(() => {
    // Create fresh instances for each test
    mockExtension = new MockExtension();
    mockExtension.registerHandlers();

    mcpServer = new McpServer();

    // Register action callback
    mcpServer.registerActionCallback(async (action, params) => {
      // This would normally be handled by sending a message to the Chrome extension
      // For tests, we'll simulate a successful response
      return {
        success: true,
        message: `Executed ${action} with ${JSON.stringify(params)}`,
        data: { action, params },
      };
    });

    // Set browser state
    mcpServer.setBrowserState({
      activeTab: {
        id: 1,
        url: 'https://example.com',
        title: 'Test Page',
        content: '<html><head><title>Test Page</title></head><body><h1>Test Page</h1></body></html>',
      },
      tabs: [{ id: 1, url: 'https://example.com', title: 'Test Page', active: true }],
    });
  });

  afterAll(() => {
    // Restore console.error
    vi.restoreAllMocks();
  });

  test('should list resources', async () => {
    const result = await mcpServer.handleListResources();

    expect(result).toBeDefined();
    expect(result.resources).toBeDefined();
    expect(Array.isArray(result.resources)).toBe(true);
    expect(result.resources.length).toBeGreaterThan(0);

    // There should be at least the current browser state resource
    expect(result.resources.some(r => r.uri === 'browser://current/state')).toBe(true);
  });

  test('should read browser state resource', async () => {
    const result = await mcpServer.handleReadResource('browser://current/state');

    expect(result).toBeDefined();
    expect(result.contents).toBeDefined();
    expect(Array.isArray(result.contents)).toBe(true);
    expect(result.contents.length).toBeGreaterThan(0);

    // Parse and check content
    const content = result.contents[0];
    expect(content).toHaveProperty('text');

    const state = JSON.parse(content.text);
    expect(state).toHaveProperty('activeTab');
    expect(state.activeTab.url).toBe('https://example.com');
    expect(state.activeTab.title).toBe('Test Page');
  });

  test('should execute navigation tool', async () => {
    // When executing navigate_to, the mock should respond with success
    const result = await mcpServer.handleCallTool('navigate_to', { url: 'https://example.org' });

    expect(result).toBeDefined();
    expect(result).toHaveProperty('success');
    expect(result.success).toBe(true);
  });
});
