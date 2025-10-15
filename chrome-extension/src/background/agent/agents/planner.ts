import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { createLogger } from '@src/background/log';
import { z } from 'zod';
import type { AgentOutput } from '../types';
import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { Actors, ExecutionState } from '../event/types';
import { RAGService } from '../../services/ragService';
import {
  ChatModelAuthError,
  ChatModelBadRequestError,
  ChatModelForbiddenError,
  isAbortedError,
  isAuthenticationError,
  isBadRequestError,
  isForbiddenError,
  LLM_FORBIDDEN_ERROR_MESSAGE,
  RequestCancelledError,
} from './errors';
import { filterExternalContent } from '../messages/utils';
const logger = createLogger('PlannerAgent');

// Define Zod schema for planner output
export const plannerOutputSchema = z.object({
  observation: z.string(),
  challenges: z.string(),
  done: z.union([
    z.boolean(),
    z.string().transform(val => {
      if (val.toLowerCase() === 'true') return true;
      if (val.toLowerCase() === 'false') return false;
      throw new Error('Invalid boolean string');
    }),
  ]),
  next_steps: z.string(),
  final_answer: z.string(),
  reasoning: z.string(),
  web_task: z.union([
    z.boolean(),
    z.string().transform(val => {
      if (val.toLowerCase() === 'true') return true;
      if (val.toLowerCase() === 'false') return false;
      throw new Error('Invalid boolean string');
    }),
  ]),
});

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

export class PlannerAgent extends BaseAgent<typeof plannerOutputSchema, PlannerOutput> {
  constructor(options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    super(plannerOutputSchema, options, { ...extraOptions, id: 'planner' });
  }

  /**
   * Extract the current planning context from messages to use for RAG retrieval
   */
  private extractPlanningContext(messages: BaseMessage[]): string {
    // Get the last human message which typically contains the current state/task
    const humanMessages = messages.filter(msg => msg._getType() === 'human');
    if (humanMessages.length === 0) {
      return '';
    }

    const lastMessage = humanMessages[humanMessages.length - 1];
    let content = '';

    // Extract text content from the message
    if (Array.isArray(lastMessage.content)) {
      for (const part of lastMessage.content) {
        if (part.type === 'text') {
          content += part.text + ' ';
        }
      }
    } else if (typeof lastMessage.content === 'string') {
      content = lastMessage.content;
    }

    // Clean and limit the content for RAG query
    const cleanContent = content.trim().slice(0, 500); // Limit to 500 chars for RAG query
    return cleanContent;
  }

  /**
   * Augment planner messages with RAG-retrieved context
   */
  private async augmentWithRAG(messages: BaseMessage[]): Promise<BaseMessage[]> {
    try {
      // Extract the planning context for RAG retrieval
      const planningContext = this.extractPlanningContext(messages);

      if (!planningContext) {
        logger.info('No planning context found for RAG retrieval');
        return messages;
      }

      logger.info('Retrieving RAG context for planning:', planningContext.substring(0, 100) + '...');

      // Retrieve RAG content for the planning context
      const ragResponse = await RAGService.retrieve(planningContext);

      if (!ragResponse.success || !ragResponse.content) {
        logger.info('No RAG content retrieved for planning');
        return messages;
      }

      logger.info('RAG content retrieved for planning, length:', ragResponse.content.length);

      // Create a new message with RAG context and insert it before the last message
      const ragContextMessage = new HumanMessage({
        content: `**Planning Context from Knowledge Base:**
${ragResponse.content}

**Instructions for Planning:** Use the above context to inform your planning decisions. Consider this information when determining next steps, identifying challenges, and providing observations.`,
      });

      // Insert RAG context before the last message (which is typically the current state)
      const augmentedMessages = [...messages];
      augmentedMessages.splice(-1, 0, ragContextMessage);

      return augmentedMessages;
    } catch (error) {
      logger.error('Failed to augment planning with RAG:', error);
      // If RAG fails, continue with original messages
      return messages;
    }
  }

  async execute(): Promise<AgentOutput<PlannerOutput>> {
    try {
      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_START, 'Planning...');
      // get all messages from the message manager, state message should be the last one
      const messages = this.context.messageManager.getMessages();
      // Use full message history except the first one
      let plannerMessages = [this.prompt.getSystemMessage(), ...messages.slice(1)];

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

      // Augment planner messages with RAG context for enhanced planning
      plannerMessages = await this.augmentWithRAG(plannerMessages);

      const modelOutput = await this.invoke(plannerMessages);
      if (!modelOutput) {
        throw new Error('Failed to validate planner output');
      }

      // clean the model output
      const observation = filterExternalContent(modelOutput.observation);
      const final_answer = filterExternalContent(modelOutput.final_answer);
      const next_steps = filterExternalContent(modelOutput.next_steps);
      const challenges = filterExternalContent(modelOutput.challenges);
      const reasoning = filterExternalContent(modelOutput.reasoning);

      const cleanedPlan: PlannerOutput = {
        ...modelOutput,
        observation,
        challenges,
        reasoning,
        final_answer,
        next_steps,
      };

      // If task is done, emit the final answer; otherwise emit next steps
      const eventMessage = cleanedPlan.done ? cleanedPlan.final_answer : cleanedPlan.next_steps;
      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_OK, eventMessage);
      logger.info('Planner output', JSON.stringify(cleanedPlan, null, 2));

      return {
        id: this.id,
        result: cleanedPlan,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Check if this is an authentication error
      if (isAuthenticationError(error)) {
        throw new ChatModelAuthError(errorMessage, error);
      } else if (isBadRequestError(error)) {
        throw new ChatModelBadRequestError(errorMessage, error);
      } else if (isAbortedError(error)) {
        throw new RequestCancelledError(errorMessage);
      } else if (isForbiddenError(error)) {
        throw new ChatModelForbiddenError(LLM_FORBIDDEN_ERROR_MESSAGE, error);
      }

      logger.error(`Planning failed: ${errorMessage}`);
      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_FAIL, `Planning failed: ${errorMessage}`);
      return {
        id: this.id,
        error: errorMessage,
      };
    }
  }
}
