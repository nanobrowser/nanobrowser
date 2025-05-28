/**
 * Task Handler for MCP Host RPC Requests
 *
 * This file implements the run_task RPC method handler for the browser extension.
 * It receives task requests from the MCP Host and executes them in the browser context.
 */

import type { Executor } from '../agent/executor';
import type BrowserContext from '../browser/context';
import { ExecutionState } from '../agent/event/types';
import { createLogger } from '../log';
import type { RpcHandler, RpcRequest, RpcResponse } from '../mcp/host-manager';

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
   * Subscribe to executor events and output them to the console
   *
   * @param executor The task executor to subscribe to
   * @param taskId The ID of the task being executed
   */
  private subscribeToExecutorEvents(executor: Executor, taskId: string, results: Array<string>): void {
    // Clear any previous event listeners to prevent multiple subscriptions
    executor.clearExecutionEvents();

    // Subscribe to new events
    executor.subscribeExecutionEvents(async event => {
      if (event.actor === 'validator' && event.state === ExecutionState.STEP_OK) {
        results.push(event.data?.details || '');
      }

      // Output event to console
      this.logger.info(`MCP Task Event [${taskId}]:`, {
        actor: event.actor,
        state: event.state,
        details: event.data?.details || '',
        timestamp: new Date(event.timestamp).toISOString(),
      });

      // Cleanup resources only when the task is actually complete, failed, or cancelled
      if (
        event.state === ExecutionState.TASK_OK ||
        event.state === ExecutionState.TASK_FAIL ||
        event.state === ExecutionState.TASK_CANCEL
      ) {
        this.logger.info(`MCP Task ${taskId} finishing, cleaning up resources`);
        await executor.cleanup();
      }
    });
  }

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

      const results = [];
      // Subscribe to executor events and output them to the console
      this.subscribeToExecutorEvents(executor, taskId, results);

      // Execute the task and wait for completion
      await executor.execute();

      this.logger.info('Task execution result for tab', tabId, ':', results);

      // Cleanup is now handled by the event subscriber when task completes
      // This ensures we don't clean up before the task is actually done

      return {
        result: {
          success: true,
          message: 'Task executed successfully',
          taskId,
          data: results,
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
