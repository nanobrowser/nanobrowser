import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { createLogger } from '@src/background/log';
import { z } from 'zod';
import type { AgentOutput } from '../types';
import { HumanMessage } from '@langchain/core/messages';
import { Actors, ExecutionState } from '../event/types';
import { isAuthenticationError } from '@src/background/utils';
import { ChatModelAuthError } from './errors';
const logger = createLogger('PlannerAgent');

// Define Zod schema for planner output
export const plannerOutputSchema = z.object({
  observation: z.string(),
  challenges: z.string(),
  done: z.boolean(),
  next_steps: z.string(),
  reasoning: z.string(),
  web_task: z.boolean(),
});

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

export class PlannerAgent extends BaseAgent<typeof plannerOutputSchema, PlannerOutput> {
  constructor(options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    super(plannerOutputSchema, options, { ...extraOptions, id: 'planner' });
  }

  // 添加一个辅助方法来处理DeepSeek模型的输出
  private fixDeepSeekOutput(modelOutput: any): PlannerOutput | null {
    if (!modelOutput) return null;

    // 确保所有必需的字段都存在
    const fixedOutput: PlannerOutput = {
      observation: typeof modelOutput.observation === 'string' ? modelOutput.observation : '',
      challenges: typeof modelOutput.challenges === 'string' ? modelOutput.challenges : '',
      done: typeof modelOutput.done === 'boolean' ? modelOutput.done : false,
      next_steps: typeof modelOutput.next_steps === 'string' ? modelOutput.next_steps : '',
      reasoning: typeof modelOutput.reasoning === 'string' ? modelOutput.reasoning : '',
      web_task: typeof modelOutput.web_task === 'boolean' ? modelOutput.web_task : true,
    };

    // 如果是字符串类型的布尔值，转换为实际的布尔值
    if (typeof modelOutput.done === 'string') {
      fixedOutput.done = modelOutput.done.toLowerCase() === 'true';
    }
    if (typeof modelOutput.web_task === 'string') {
      fixedOutput.web_task = modelOutput.web_task.toLowerCase() === 'true';
    }

    return fixedOutput;
  }

  async execute(): Promise<AgentOutput<PlannerOutput>> {
    try {
      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_START, 'Planning...');
      // get all messages from the message manager, state message should be the last one
      const messages = this.context.messageManager.getMessages();
      // Use full message history except the first one
      const plannerMessages = [this.prompt.getSystemMessage(), ...messages.slice(1)];

      // Remove images from last message if vision is not enabled for planner but vision is enabled
      if (!this.context.options.useVisionForPlanner && this.context.options.useVision) {
        const lastStateMessage = plannerMessages[plannerMessages.length - 1];
        let newMsg = '';

        if (Array.isArray(lastStateMessage.content)) {
          for (const msg of lastStateMessage.content) {
            if (msg.type === 'text') {
              newMsg += msg.text;
            }
            // Skip image_url messages
          }
        } else {
          newMsg = lastStateMessage.content;
        }

        plannerMessages[plannerMessages.length - 1] = new HumanMessage(newMsg);
      }

      let modelOutput;
      try {
        modelOutput = await this.invoke(plannerMessages);
      } catch (error) {
        // 如果是DeepSeek模型，尝试使用更简单的方法获取输出
        if (this.modelName.toLowerCase().includes('deepseek')) {
          logger.info('Using fallback method for DeepSeek model');
          const response = await this.chatLLM.invoke(plannerMessages, {
            ...this.callOptions,
          });
          
          if (typeof response.content === 'string') {
            try {
              const extractedJson = this.extractJsonFromModelOutput(response.content);
              modelOutput = this.fixDeepSeekOutput(extractedJson);
            } catch (jsonError) {
              throw new Error(`Failed to parse DeepSeek response: ${jsonError}`);
            }
          }
        } else {
          throw error;
        }
      }

      if (!modelOutput) {
        throw new Error('Failed to validate planner output');
      }

      // 对于DeepSeek模型，确保输出格式正确
      if (this.modelName.toLowerCase().includes('deepseek')) {
        modelOutput = this.fixDeepSeekOutput(modelOutput);
      }

      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_OK, modelOutput.next_steps);

      return {
        id: this.id,
        result: modelOutput,
      };
    } catch (error) {
      // Check if this is an authentication error
      if (isAuthenticationError(error)) {
        throw new ChatModelAuthError('Planner API Authentication failed. Please verify your API key', error);
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_FAIL, `Planning failed: ${errorMessage}`);
      return {
        id: this.id,
        error: errorMessage,
      };
    }
  }
}
