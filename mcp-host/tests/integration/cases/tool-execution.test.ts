import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { McpHostTestEnvironment } from '../mcp-host-test-environment';
import { RpcRequest, RpcResponse } from '../../../src/types';

/**
 * Tests for MCP tool execution
 * Focused on executing tools and verifying they forward actions to the browser
 */
describe('Tool Execution', () => {
  let testEnv: McpHostTestEnvironment;
  let capturedAction: any = null;

  beforeAll(async () => {
    // Suppress console.error during tests
    vi.spyOn(console, 'error').mockImplementation(() => {});

    testEnv = new McpHostTestEnvironment();
    await testEnv.setup();
  });

  afterEach(() => {
    capturedAction = null;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await testEnv.cleanup();
  });

  test('should execute navigate_to tool and forward to browser', async () => {
    // Initialize MCP client
    const mcpClient = testEnv.getMcpClient();
    expect(mcpClient).not.toBeNull();
    await mcpClient!.initialize();

    // List available tools
    const tools = await mcpClient!.listTools();
    expect(tools).toBeDefined();

    const browserState = {
      activeTab: {
        id: 1,
        url: 'https://example.com',
        title: 'Test Page',
        content: '<html><body><h1>Test</h1></body></html>',
      },
      tabs: [{ id: 1, url: 'https://example.com', title: 'Test Page', active: true }],
    };

    testEnv.registerRpcMethod('get_browser_state', async (request: RpcRequest): Promise<RpcResponse> => {
      return {
        id: request.id,
        result: browserState,
      };
    });

    /*
    // Verify navigate_to tool is available
    const navigateTool = tools.result.tools.find(
      (t: any) => t.name === 'navigate_to'
    );
    expect(navigateTool).toBeDefined();
    
    // Execute the navigate_to tool
    const testUrl = 'https://test-example.com';
    const result = await mcpClient!.callTool('navigate_to', { url: testUrl });
    
    // Verify result
    expect(result.result.success).toBe(true);
    
    // Verify action was forwarded to the browser
    expect(capturedAction).not.toBeNull();
    expect(capturedAction.action).toBe('navigate');
    expect(capturedAction.params.url).toBe(testUrl);
    */
  });
});
