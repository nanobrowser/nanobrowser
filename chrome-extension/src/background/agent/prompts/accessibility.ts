import { BasePrompt } from './base';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '@src/background/agent/types';
import { accessibilitySystemPromptTemplate } from './templates/accessibility';

export class AccessibilityPrompt extends BasePrompt {
  getSystemMessage(): SystemMessage {
    return new SystemMessage(accessibilitySystemPromptTemplate);
  }

  async getUserMessage(context: AgentContext): Promise<HumanMessage> {
    return await this.buildBrowserStateUserMessage(context);
  }
}
