import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { McpHostTestEnvironment } from '../McpHostTestEnvironment';

/**
 * Tests for browser state and MCP resources
 * Focused on setting browser state and retrieving it via MCP resources
 */
describe('Browser State and Resources', () => {
  let testEnv: McpHostTestEnvironment;

  beforeAll(async () => {
    // Suppress console.error during tests
    vi.spyOn(console, 'error').mockImplementation(() => {});

    testEnv = new McpHostTestEnvironment();
    await testEnv.setup();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await testEnv.cleanup();
  });

  test('should expose browser state as MCP resources', async () => {
    // Set browser state
    const browserState = {
      activeTab: {
        id: 1,
        url: 'https://example.com',
        title: 'Test Page',
        content: '<html><body><h1>Test</h1></body></html>',
      },
      tabs: [{ id: 1, url: 'https://example.com', title: 'Test Page', active: true }],
    };

    await testEnv.setBrowserState(browserState);

    // Initialize MCP client
    const mcpClient = testEnv.getMcpClient();
    expect(mcpClient).not.toBeNull();
    await mcpClient!.initialize();

    // Check if resources are available
    const resources = await mcpClient!.listResources();
    expect(resources.result.resources).toBeDefined();
    expect(Array.isArray(resources.result.resources)).toBe(true);
    expect(resources.result.resources.length).toBeGreaterThan(0);

    // Find browser state resource
    const stateResource = resources.result.resources.find((r: any) => r.uri === 'browser://current/state');
    expect(stateResource).toBeDefined();

    // Read and verify browser state resource
    const resourceContent = await mcpClient!.readResource('browser://current/state');
    expect(resourceContent).toBeDefined();

    // Parse and check content
    const content = resourceContent.result.contents[0];
    expect(content).toHaveProperty('text');

    const parsedState = JSON.parse(content.text);
    expect(parsedState).toHaveProperty('activeTab');
    expect(parsedState.activeTab.url).toBe('https://example.com');
    expect(parsedState.activeTab.title).toBe('Test Page');
  });
});
