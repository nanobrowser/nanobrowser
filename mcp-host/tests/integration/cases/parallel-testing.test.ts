import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { McpHostTestEnvironment } from '../mcp-host-test-environment';
import { RpcRequest, RpcResponse } from '../../../src/types';

/**
 * Tests for parallel execution of multiple MCP Host instances
 * Verifies that multiple hosts can run concurrently with separate ports
 */
describe('Multiple Instances (Parallel Testing)', () => {
  beforeAll(async () => {
    // Suppress console.error during tests
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  test('should support multiple instances with different ports', async () => {
    // Create two test environments
    const testEnv1 = new McpHostTestEnvironment();
    const testEnv2 = new McpHostTestEnvironment();

    try {
      // Set up both environments
      await testEnv1.setup();
      await testEnv2.setup();

      // Verify both have different ports
      const port1 = testEnv1.getPort();
      const port2 = testEnv2.getPort();
      expect(port1).not.toBe(port2);
      expect(port1).toBeGreaterThan(0);
      expect(port2).toBeGreaterThan(0);

      // Verify both are running
      expect(testEnv1.isHostRunning()).toBe(true);
      expect(testEnv2.isHostRunning()).toBe(true);

      // Initialize MCP clients for both
      const mcpClient1 = testEnv1.getMcpClient();
      const mcpClient2 = testEnv2.getMcpClient();

      expect(mcpClient1).not.toBeNull();
      expect(mcpClient2).not.toBeNull();

      await mcpClient1!.initialize();
      await mcpClient2!.initialize();

      // Verify both can list resources independently
      const resources1 = await mcpClient1!.listResources();
      const resources2 = await mcpClient2!.listResources();

      expect(resources1.result.resources).toBeDefined();
      expect(resources2.result.resources).toBeDefined();

      testEnv1.registerRpcMethod('get_browser_state', async (request: RpcRequest): Promise<RpcResponse> => {
        return {
          id: request.id,
          result: {
            activeTab: {
              id: 1,
              url: 'https://example1.com',
              title: 'Test Page 1',
              content: '<html><body><h1>Test 1</h1></body></html>',
            },
          },
        };
      });

      testEnv2.registerRpcMethod('get_browser_state', async (request: RpcRequest): Promise<RpcResponse> => {
        return {
          id: request.id,
          result: {
            activeTab: {
              id: 1,
              url: 'https://example2.com',
              title: 'Test Page 2',
              content: '<html><body><h1>Test 2</h1></body></html>',
            },
          },
        };
      });

      // Verify each instance has its own state
      const state1 = await mcpClient1!.readResource('browser://current/state');
      const state2 = await mcpClient2!.readResource('browser://current/state');

      const parsedState1 = JSON.parse(state1.result.contents[0].text);
      const parsedState2 = JSON.parse(state2.result.contents[0].text);

      expect(parsedState1.activeTab.url).toBe('https://example1.com');
      expect(parsedState2.activeTab.url).toBe('https://example2.com');
    } finally {
      // Clean up both environments
      await testEnv1.cleanup();
      await testEnv2.cleanup();
    }
  });
});
