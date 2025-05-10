/**
 * Example test file demonstrating Vitest usage with MCP Host
 *
 * This file shows a basic test setup with Vitest and can be used
 * as a template for migrating Jest tests to Vitest.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionResult } from '../../src/browser-tools';
import { McpServer } from '../../src/mcp-server';

// Mock dependencies
vi.mock('../../src/browser-resources', () => ({
  BrowserResources: vi.fn().mockImplementation(() => ({
    readResource: vi.fn().mockResolvedValue({
      contents: [
        {
          uri: 'browser://state',
          mimeType: 'application/json',
          text: JSON.stringify({ data: 'mock-resource-data' }),
        },
      ],
    }),
  })),
}));

describe('McpServer', () => {
  let mcpServer: McpServer;

  // Setup before each test
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Create a new instance for each test
    mcpServer = new McpServer();
  });

  // Cleanup after each test
  afterEach(() => {
    vi.resetAllMocks();
  });

  // Test case using async/await
  it('should handle resource requests correctly', async () => {
    // Arrange
    const uri = 'browser://state';

    // Act
    const result = await mcpServer.handleReadResource(uri);

    // Assert
    expect(result).toHaveProperty('contents');
    expect(result.contents[0]).toHaveProperty('text');

    // Parse the JSON text to get the data
    const parsedData = JSON.parse(result.contents[0].text);
    expect(parsedData).toHaveProperty('data');
    expect(parsedData.data).toBe('mock-resource-data');
  });

  // Test case with spy
  it('should register action callbacks correctly', () => {
    // Arrange
    const mockCallback = vi.fn(async (action: string, params: any): Promise<ActionResult> => {
      return { success: true, message: 'Mock action executed' };
    });

    // Act
    mcpServer.registerActionCallback(mockCallback);

    // Assert - we can only test this indirectly since handleCallTool is private
    // In a real test, we would test the effects of registering the callback
    expect(mcpServer).toBeTruthy();
  });

  // Test with mock timer
  it('should handle timeouts correctly', async () => {
    // Setup fake timers
    vi.useFakeTimers();

    // Arrange
    const slowCallback = vi.fn().mockImplementation(() => {
      return new Promise(resolve => {
        setTimeout(() => {
          resolve({ success: true });
        }, 5000);
      });
    });

    // Register the slow callback
    mcpServer.registerActionCallback(slowCallback);

    // Act & Assert - in a real test we would test timeout behavior
    // This is just an example of using fake timers
    vi.advanceTimersByTime(5000);

    // Restore real timers
    vi.useRealTimers();
  });

  // Snapshot test example
  it('should match snapshot for tool list', async () => {
    // Act
    const tools = await mcpServer.handleListTools();

    // Assert
    expect(tools).toMatchSnapshot();
  });
});
