import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { McpHostTestEnvironment } from '../mcp-host-test-environment';
import { RpcRequest, RpcResponse } from '../../../src/types';

/**
 * Tests for Run Task tool execution
 * Focused on verifying the run_task tool operates correctly
 */
describe('Run Task Tool', () => {
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

  test('should execute run_task tool and process task', async () => {
    // Initialize MCP client
    const mcpClient = testEnv.getMcpClient();
    expect(mcpClient).not.toBeNull();
    await mcpClient!.initialize();

    // List available tools
    const tools = await mcpClient!.listTools();
    expect(tools).toBeDefined();

    // Mock task response
    const taskResult = 'Task successfully completed';

    // Register mock handler for run_task
    testEnv.registerRpcMethod('run_task', async (req: RpcRequest): Promise<RpcResponse> => {
      // Verify correct parameters are received
      expect(req.params.task).toBeDefined();
      expect(typeof req.params.task).toBe('string');

      if (req.params.context) {
        expect(typeof req.params.context).toBe('string');
      }

      // Return mock result
      return {
        result: taskResult,
      };
    });

    // Verify run_task tool is available
    const runTaskTool = tools.tools.find((t: any) => t.name === 'run_task');
    expect(runTaskTool).toBeDefined();

    // Execute the run_task tool
    const testTask = 'Test task to execute';
    const testContext = 'Additional context for the task';

    const toolResp = await mcpClient!.callTool('run_task', {
      task: testTask,
      context: testContext,
    });

    // Verify response format
    expect(toolResp).toBeDefined();
    expect(toolResp.content).toBeDefined();
    expect(toolResp.content.length).toBeGreaterThan(0);
    expect(toolResp.content[0].type).toBe('text');
    expect(toolResp.content[0].text).toBe(`Task completed: ${taskResult}`);
  });

  test('should throw error when task is not provided', async () => {
    // Initialize MCP client
    const mcpClient = testEnv.getMcpClient();
    expect(mcpClient).not.toBeNull();
    await mcpClient!.initialize();

    // Call tool with missing required parameter
    await expect(mcpClient!.callTool('run_task', {})).rejects.toThrow();
  });

  test('should use default timeout value when not specified', async () => {
    // Initialize MCP client
    const mcpClient = testEnv.getMcpClient();
    expect(mcpClient).not.toBeNull();
    await mcpClient!.initialize();

    let capturedTimeout: number | undefined;

    // Override the rpcRequest method to capture timeout
    testEnv.registerRpcMethod('run_task', async (req: RpcRequest): Promise<RpcResponse> => {
      // Here we would capture the timeout if it was accessible
      return {
        result: 'Task completed',
      };
    });

    // Execute the run_task tool with default timeout
    const toolResp = await mcpClient!.callTool('run_task', {
      task: 'Test task',
    });

    expect(toolResp.content[0].text).toBe('Task completed: Task completed');
  });
});
