/**
 * Task Handler for MCP Host RPC Requests
 *
 * This file implements the run_task RPC method handler for the browser extension.
 * It receives task requests from the MCP Host and executes them in the browser context.
 */

import { Executor } from '../agent/executor';
import BrowserContext from '../browser/context';
import { createLogger } from '../log';
import { RpcHandler, RpcRequest, RpcResponse } from '../mcp/host-manager';

/**
 * Interface for run_task request parameters
 */
interface RunTaskParams {
  /**
   * The task description to be completed
   */
  task: string;

  /**
   * Additional context for the task
   */
  context?: string;
}

/**
 * Type definition for the setupExecutor function
 */
export type SetupExecutorFn = (taskId: string, task: string, browserContext: BrowserContext) => Promise<Executor>;

/**
 * Handler for the 'run_task' RPC method
 *
 * This handler processes task requests from the MCP Host and returns the results.
 * It uses dependency injection for better testability and flexibility.
 */
export class RunTaskHandler {
  private logger = createLogger('RunTaskHandler');

  /**
   * Creates a new RunTaskHandler instance
   *
   * @param browserContext The browser context for tab and page interaction
   * @param setupExecutorFn Function used to create task executors
   */
  constructor(
    private readonly browserContext: BrowserContext,
    private readonly setupExecutorFn: SetupExecutorFn,
  ) {}

  /**
   * Handle a run_task RPC request
   *
   * @param request RPC request containing the task details
   * @returns Promise resolving to an RPC response with the task result
   */
  public handleRunTask: RpcHandler = async (request: RpcRequest): Promise<RpcResponse> => {
    this.logger.debug('Received run_task request:', request);

    try {
      const params = request.params as RunTaskParams;

      if (!params || !params.task) {
        return {
          error: {
            code: -32602,
            message: 'Invalid params: task is required',
          },
        };
      }

      // Generate task ID for this RPC-initiated task
      const taskId = `rpc-task-${Date.now()}`;
      this.logger.info('Executing task:', params.task, 'with ID:', taskId);

      // Get current page and tab for task execution
      const currentPage = await this.browserContext.getCurrentPage();
      const tabId = currentPage.tabId;

      // Setup and execute the task
      const executor = await this.setupExecutorFn(taskId, params.task, this.browserContext);

      // Set up event handlers if needed
      // For example, we might want to capture events for status updates

      // Execute the task and wait for completion
      const result = await executor.execute();
      this.logger.info('Task execution result for tab', tabId, ':', result);

      // Cleanup after execution
      await executor.cleanup();

      return {
        result: {
          success: true,
          message: 'Task executed successfully',
          taskId,
          data: result,
        },
      };
    } catch (error) {
      this.logger.error('Error executing task:', error);

      return {
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Unknown error executing task',
          data: { stack: error instanceof Error ? error.stack : undefined },
        },
      };
    }
  };
}
