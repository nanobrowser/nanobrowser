import type { z } from 'zod';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AgentContext, AgentOutput } from '../types';
import type { BasePrompt } from '../prompts/base';
import { type BaseMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { createLogger } from '@src/background/log';
import type { Action } from '../actions/builder';

const logger = createLogger('agent');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CallOptions = Record<string, any>;

// Update options to use Zod schema
export interface BaseAgentOptions {
  chatLLM: BaseChatModel;
  context: AgentContext;
  prompt: BasePrompt;
}
export interface ExtraAgentOptions {
  id?: string;
  toolCallingMethod?: string;
  callOptions?: CallOptions;
}

const THINK_TAGS = /<think>[\s\S]*?<\/think>/;

/**
 * Base class for all agents
 * @param T - The Zod schema for the model output
 * @param M - The type of the result field of the agent output
 */
export abstract class BaseAgent<T extends z.ZodType, M = unknown> {
  protected id: string;
  protected chatLLM: BaseChatModel;
  protected prompt: BasePrompt;
  protected context: AgentContext;
  protected actions: Record<string, Action> = {};
  protected modelOutputSchema: T;
  protected toolCallingMethod: string | null;
  protected chatModelLibrary: string;
  protected modelName: string;
  protected withStructuredOutput: boolean;
  protected callOptions?: CallOptions;
  protected modelOutputToolName: string;
  declare ModelOutput: z.infer<T>;

  constructor(modelOutputSchema: T, options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    // base options
    this.modelOutputSchema = modelOutputSchema;
    this.chatLLM = options.chatLLM;
    this.prompt = options.prompt;
    this.context = options.context;
    // TODO: fix this, the name is not correct in production environment
    this.chatModelLibrary = this.chatLLM.constructor.name;
    this.modelName = this.getModelName();
    this.withStructuredOutput = this.setWithStructuredOutput();
    // extra options
    this.id = extraOptions?.id || 'agent';
    this.toolCallingMethod = this.setToolCallingMethod(extraOptions?.toolCallingMethod);
    this.callOptions = extraOptions?.callOptions;
    this.modelOutputToolName = `${this.id}_output`;
  }

  // Set the model name
  private getModelName(): string {
    if ('modelName' in this.chatLLM) {
      return this.chatLLM.modelName as string;
    }
    if ('model_name' in this.chatLLM) {
      return this.chatLLM.model_name as string;
    }
    if ('model' in this.chatLLM) {
      return this.chatLLM.model as string;
    }
    return 'Unknown';
  }

  // Set the tool calling method
  private setToolCallingMethod(toolCallingMethod?: string): string | null {
    if (toolCallingMethod === 'auto') {
      switch (this.chatModelLibrary) {
        case 'ChatGoogleGenerativeAI':
          return null;
        case 'ChatOpenAI':
        case 'AzureChatOpenAI':
          return 'function_calling';
        default:
          return null;
      }
    }
    return toolCallingMethod || null;
  }

  // Set whether to use structured output based on the model name
  private setWithStructuredOutput(): boolean {
    // 检查模型名称是否以deepseek开头，如果是则不使用结构化输出
    if (this.modelName.toLowerCase().includes('deepseek')) {
      return false;
    }
    return true;
  }

  // Remove think tags from the model output
  protected removeThinkTags(text: string): string {
    return text.replace(THINK_TAGS, '');
  }

  async invoke(inputMessages: BaseMessage[]): Promise<this['ModelOutput']> {
    // Use structured output
    if (this.withStructuredOutput) {
      const structuredLlm = this.chatLLM.withStructuredOutput(this.modelOutputSchema, {
        includeRaw: true,
        name: this.modelOutputToolName,
      });

      const response = await structuredLlm.invoke(inputMessages, {
        ...this.callOptions,
      });
      if (response.parsed) {
        return response.parsed;
      }
      throw new Error('Could not parse response');
    }

    // Without structured output support, need to extract JSON from model output manually
    const response = await this.chatLLM.invoke(inputMessages, {
      ...this.callOptions,
    });
    if (typeof response.content === 'string') {
      response.content = this.removeThinkTags(response.content);
      try {
        const extractedJson = this.extractJsonFromModelOutput(response.content);
        const parsed = this.validateModelOutput(extractedJson);
        if (parsed) {
          return parsed;
        }
      } catch (error) {
        logger.error('Could not parse response', response);
        throw new Error('Could not parse response');
      }
    }
    throw new Error('Could not parse response');
  }

  // Execute the agent and return the result
  abstract execute(): Promise<AgentOutput<M>>;

  // Helper method to validate metadata
  protected validateModelOutput(data: unknown): this['ModelOutput'] | undefined {
    if (!this.modelOutputSchema || !data) return undefined;
    return this.modelOutputSchema.parse(data);
  }

  // Add the model output to the memory
  protected addModelOutputToMemory(modelOutput: this['ModelOutput']): void {
    const messageManager = this.context.messageManager;
    const toolCallId = String(messageManager.nextToolId());
    const toolCalls = [
      {
        name: this.modelOutputToolName,
        args: modelOutput,
        id: toolCallId,
        type: 'tool_call' as const,
      },
    ];

    const toolCallMessage = new AIMessage({
      content: 'tool call',
      tool_calls: toolCalls,
    });
    messageManager.addMessageWithTokens(toolCallMessage);

    const toolMessage = new ToolMessage({
      content: 'tool call response placeholder',
      tool_call_id: toolCallId,
    });
    messageManager.addMessageWithTokens(toolMessage);
  }

  /**
   * Extract JSON from raw string model output, handling both plain JSON and code-block-wrapped JSON.
   *
   * some models not supporting tool calls well like deepseek-reasoner, so we need to extract the JSON from the output
   * @param content - The content of the model output
   * @returns The JSON object
   */
  protected extractJsonFromModelOutput(content: string): unknown {
    try {
      // 首先尝试直接解析整个内容
      try {
        return JSON.parse(content);
      } catch (directParseError) {
        // 直接解析失败，继续尝试其他方法
      }

      // 处理代码块中的JSON
      if (content.includes('```')) {
        const codeBlocks = content.split('```');
        // 遍历所有可能的代码块
        for (let i = 1; i < codeBlocks.length; i += 2) {
          let block = codeBlocks[i].trim();
          
          // 移除语言标识符（如'json'）
          if (block.includes('\n')) {
            const lines = block.split('\n');
            if (lines[0].match(/^(json|javascript|js)$/i)) {
              block = lines.slice(1).join('\n');
            }
          }
          
          // 尝试解析这个代码块
          try {
            return JSON.parse(block);
          } catch (blockParseError) {
            // 这个代码块解析失败，继续尝试下一个
            continue;
          }
        }
      }

      // 尝试查找内容中的JSON对象（使用正则表达式）
      const jsonRegex = /\{[\s\S]*\}/g;
      const matches = content.match(jsonRegex);
      if (matches) {
        for (const match of matches) {
          try {
            return JSON.parse(match);
          } catch (regexParseError) {
            // 这个匹配解析失败，继续尝试下一个
            continue;
          }
        }
      }

      // 如果所有尝试都失败，则抛出错误
      logger.warning(`Failed to parse model output: ${content}`);
      throw new Error('Could not parse response.');
    } catch (e) {
      logger.warning(`Failed to parse model output: ${content} ${e}`);
      throw new Error('Could not parse response.');
    }
  }
}
