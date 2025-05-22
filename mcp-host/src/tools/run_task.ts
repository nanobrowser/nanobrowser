/**
 * Run task tool
 *
 * This tool allows requesting the agent to complete a specified task.
 */

import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { NativeMessaging } from '../messaging.js';
import { createLogger } from '../logger.js';

/**
 * Implementation of the run_task tool
 */
export class RunTaskTool {
  private logger = createLogger('run_task_tool');

  /**
   * Tool name
   */
  public name = 'run_task';

  /**
   * Tool description
   */
  public description = 'Request the agent to complete a task';

  /**
   * Private reference to the NativeMessaging instance
   */
  private messaging: NativeMessaging;

  /**
   * Constructor
   * @param messaging NativeMessaging instance for communication
   */
  constructor(messaging: NativeMessaging) {
    this.messaging = messaging;
  }

  /**
   * Input schema for the tool
   */
  public inputSchema = {
    task: z.string().describe('The task description to be completed by the agent'),
    context: z.string().optional().describe('Additional context for the task'),
    timeout: z.number().optional().default(30000).describe('Timeout in milliseconds'),
  };

  /**
   * Execute the run_task tool
   * @param args Tool arguments containing the task and optional context
   * @returns Promise resolving to the action result
   */
  public execute = async (args: { task: string; context?: string; timeout?: number }): Promise<CallToolResult> => {
    this.logger.info('execute args:', args);

    if (!args.task) {
      throw new Error('Task description is required');
    }

    // Use the provided timeout or default to 30 seconds
    const timeout = args.timeout || 30000;

    const result = await this.messaging.rpcRequest(
      {
        method: 'run_task',
        params: {
          task: args.task,
          context: args.context || '',
        },
      },
      { timeout },
    );

    this.logger.info('call run_task result:', result);

    return {
      content: [
        {
          type: 'text',
          text: `Task completed: ${result || 'No result provided'}`,
        },
      ],
    };
  };
}
