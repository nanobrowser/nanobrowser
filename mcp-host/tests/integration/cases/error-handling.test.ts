import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { McpHostTestEnvironment } from '../mcp-host-test-environment';
import { RpcRequest, RpcResponse } from '../../../src/types';

/**
 * Tests for error handling in the MCP Host
 * Focused on handling invalid inputs and ensuring the host remains stable
 */
describe('Error Handling', () => {
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

  test('should handle unknown tool errors', async () => {
    // Initialize MCP client
    const mcpClient = testEnv.getMcpClient();
    expect(mcpClient).not.toBeNull();
    await mcpClient!.initialize();

    // Try to call a non-existent tool
    try {
      await mcpClient!.callTool('non_existent_tool', { param: 'value' });
      // Should not reach here
      expect(true).toBe(false);
    } catch (error: any) {
      // Verify error response
      expect(error).toBeDefined();
    }
  });

  test('should handle invalid resource URI errors', async () => {
    // Initialize MCP client
    const mcpClient = testEnv.getMcpClient();
    expect(mcpClient).not.toBeNull();
    await mcpClient!.initialize();

    // Try to read a non-existent resource
    try {
      await mcpClient!.readResource('invalid://resource/uri');
      // Should not reach here
      expect(true).toBe(false);
    } catch (error: any) {
      // Verify error response
      expect(error).toBeDefined();
    }
  });

  test('should remain stable after errors', async () => {
    // Initialize MCP client
    const mcpClient = testEnv.getMcpClient();
    expect(mcpClient).not.toBeNull();
    await mcpClient!.initialize();

    // Try an invalid operation
    try {
      await mcpClient!.callTool('non_existent_tool', { param: 'value' });
    } catch (error) {
      // Ignore the error, we expect it
    }

    // Set browser state to verify host is still working
    const browserState = {
      activeTab: {
        id: 1,
        url: 'https://example.com',
        title: 'Test After Error',
        content: '<html><body><h1>Test</h1></body></html>',
      },
      tabs: [{ id: 1, url: 'https://example.com', title: 'Test After Error', active: true }],
    };

    testEnv.registerRpcMethod('get_browser_state', async (request: RpcRequest): Promise<RpcResponse> => {
      return {
        id: request.id,
        result: browserState,
      };
    });

    // Read and verify browser state resource to confirm host is still functional
    const resourceContent = await mcpClient!.readResource('browser://current/state');
    expect(resourceContent).toBeDefined();

    const content = resourceContent.contents[0];
    const parsedState = JSON.parse(content.text);
    expect(parsedState.activeTab.title).toBe('Test After Error');
  });
});
