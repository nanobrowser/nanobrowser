/* eslint-disable @typescript-eslint/no-unused-vars */
import { BasePrompt } from './base';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '@src/background/agent/types';
import { plannerSystemPromptTemplate } from './templates/planner';

export class PlannerPrompt extends BasePrompt {
  private systemMessage: SystemMessage;

  constructor(skillsContent = '') {
    super();
    const formattedPrompt = plannerSystemPromptTemplate.replace('{{skills}}', skillsContent).trim();
    this.systemMessage = new SystemMessage(formattedPrompt);
  }

  getSystemMessage(): SystemMessage {
    return this.systemMessage;
  }

  async getUserMessage(context: AgentContext): Promise<HumanMessage> {
    return new HumanMessage('');
  }
}
