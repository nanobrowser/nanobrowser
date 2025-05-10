import { HumanMessage, type SystemMessage } from '@langchain/core/messages';
import { memoryService } from '../../memory/service';
import type { AgentContext } from '@src/background/agent/types';
import { createLogger } from '@src/background/log';

const logger = createLogger('agent/prompts/base');

/**
 * Abstract base class for all prompt types
 */
abstract class BasePrompt {
  /**
   * Returns the system message that defines the AI's role and behavior
   * @returns SystemMessage from LangChain
   */
  abstract getSystemMessage(): SystemMessage;

  /**
   * Returns the user message for the specific prompt type
   * @param context - Optional context data needed for generating the user message
   * @returns HumanMessage from LangChain
   */
  abstract getUserMessage(context: AgentContext): Promise<HumanMessage>;

  /**
   * Builds the user message containing the browser state
   * @param context - The agent context
   * @returns HumanMessage from LangChain
   */
  async buildBrowserStateUserMessage(context: AgentContext): Promise<HumanMessage> {
    const browserState = await context.browserContext.getState();
    const elementsText = browserState.elementTree.clickableElementsToString(context.options.includeAttributes);

    const hasContentAbove = (browserState.pixelsAbove || 0) > 0;
    const hasContentBelow = (browserState.pixelsBelow || 0) > 0;

    let formattedElementsText = '';
    if (elementsText !== '') {
      if (hasContentAbove) {
        // formattedElementsText = `... ${browserState.pixelsAbove} pixels above - scroll up or extract content to see more ...\n${elementsText}`;
        formattedElementsText = `... ${browserState.pixelsAbove} pixels above - scroll up to see more ...\n${elementsText}`;
      } else {
        formattedElementsText = `[Start of page]\n${elementsText}`;
      }

      if (hasContentBelow) {
        // formattedElementsText = `${formattedElementsText}\n... ${browserState.pixelsBelow} pixels below - scroll down or extract content to see more ...`;
        formattedElementsText = `${formattedElementsText}\n... ${browserState.pixelsBelow} pixels below - scroll down to see more ...`;
      } else {
        formattedElementsText = `${formattedElementsText}\n[End of page]`;
      }
    } else {
      formattedElementsText = 'empty page';
    }

    let stepInfoDescription = '';
    if (context.stepInfo) {
      stepInfoDescription = `Current step: ${context.stepInfo.stepNumber + 1}/${context.stepInfo.maxSteps}`;
    }

    const timeStr = new Date().toISOString().slice(0, 16).replace('T', ' '); // Format: YYYY-MM-DD HH:mm
    stepInfoDescription += `Current date and time: ${timeStr}`;

    let actionResultsDescription = '';
    if (context.actionResults.length > 0) {
      for (let i = 0; i < context.actionResults.length; i++) {
        const result = context.actionResults[i];
        if (result.extractedContent) {
          actionResultsDescription += `\nAction result ${i + 1}/${context.actionResults.length}: ${result.extractedContent}`;
        }
        if (result.error) {
          // only use last line of error
          const error = result.error.split('\n').pop();
          actionResultsDescription += `\nAction error ${i + 1}/${context.actionResults.length}: ...${error}`;
        }
      }
    }

    // Get memory data to include in the prompt
    const memoryData = memoryService.toString();

    const currentTab = `{id: ${browserState.tabId}, url: ${browserState.url}, title: ${browserState.title}}`;
    const otherTabs = browserState.tabs
      .filter(tab => tab.id !== browserState.tabId)
      .map(tab => `- {id: ${tab.id}, url: ${tab.url}, title: ${tab.title}}`);
    const stateDescription = `
[Task history memory ends]
[Current state starts here]
The following is one-time information - if you need to remember it write it to memory:
${memoryData}

Current tab: ${currentTab}
Other available tabs:
  ${otherTabs.join('\n')}
Interactive elements from top layer of the current page inside the viewport:
${formattedElementsText}
${stepInfoDescription}
${actionResultsDescription}
`;

    if (browserState.screenshot && context.options.useVision) {
      return new HumanMessage({
        content: [
          { type: 'text', text: stateDescription },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${browserState.screenshot}` },
          },
        ],
      });
    }

    return new HumanMessage(stateDescription);
  }
}

export { BasePrompt };
