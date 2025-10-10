import { createLogger } from '../log';
import { createChatModel } from '../agent/helper';
import { agentModelStore, llmProviderStore, AgentNameEnum } from '@extension/storage';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { ContextualizedActionInfo, ActionVisionContext } from '@extension/storage/lib/accessibility/types';
import type BrowserContext from '../browser/context';

const logger = createLogger('ActionVisionValidator');

/**
 * Constants for vision validation
 */
const MAX_ACTIONS_PER_VALIDATION = 5;
const VISION_VALIDATION_TIMEOUT_MS = 30000;
const MIN_CONFIDENCE_SCORE = 0.6;

/**
 * Sanitizes a URL for logging by removing query parameters and hash
 */
function sanitizeUrlForLogging(url: string): string {
  try {
    const urlObj = new URL(url);
    return `${urlObj.origin}${urlObj.pathname}`;
  } catch {
    return '[invalid-url]';
  }
}

/**
 * Service responsible for validating action elements using vision models
 *
 * This service uses vision-capable LLMs to:
 * 1. Analyze screenshots of action elements in context
 * 2. Recognize icons and visual symbols
 * 3. Generate contextual aria-label suggestions
 * 4. Provide visual descriptions of interactive elements
 */
export class ActionVisionValidator {
  private browserContext: BrowserContext;

  constructor(browserContext: BrowserContext) {
    this.browserContext = browserContext;
  }

  /**
   * Validates action elements using vision model analysis
   *
   * @param tabId - Chrome tab ID where the actions are located
   * @param url - Page URL for context
   * @param pageTitle - Page title for context
   * @param actions - Array of contextualized actions to validate
   * @returns Promise resolving to actions enriched with vision context
   *
   * @example
   * const validator = new ActionVisionValidator(browserContext);
   * const validatedActions = await validator.validateActionContext(
   *   tabId,
   *   'https://example.com',
   *   'Page Title',
   *   contextualizedActions
   * );
   */
  async validateActionContext(
    tabId: number,
    url: string,
    pageTitle: string,
    actions: ContextualizedActionInfo[],
  ): Promise<ContextualizedActionInfo[]> {
    try {
      logger.info('Starting action vision validation', {
        tabId,
        url: sanitizeUrlForLogging(url),
        actionCount: actions.length,
      });

      // Check if vision model is available
      const hasVisionCapability = await this.checkVisionCapability();
      if (!hasVisionCapability) {
        logger.info('Vision model not available, skipping action vision validation');
        return actions;
      }

      // Get page screenshot for visual context
      const page = await this.browserContext.getCurrentPage();
      const screenshot = await page.takeScreenshot(false);

      if (!screenshot) {
        logger.warning('Failed to capture screenshot, skipping action vision validation');
        return actions;
      }

      // Filter actions that need vision analysis (missing labels or vague text)
      const actionsNeedingVision = actions.filter(action => this.needsVisionAnalysis(action));

      logger.info('Actions needing vision analysis', {
        total: actions.length,
        needingVision: actionsNeedingVision.length,
      });

      if (actionsNeedingVision.length === 0) {
        return actions;
      }

      // Validate actions in batches to avoid overwhelming the model
      const validatedActions = new Map<string, ActionVisionContext>();

      for (let i = 0; i < actionsNeedingVision.length; i += MAX_ACTIONS_PER_VALIDATION) {
        const batch = actionsNeedingVision.slice(i, i + MAX_ACTIONS_PER_VALIDATION);
        const batchResults = await this.validateActionBatch(screenshot, url, pageTitle, batch);

        for (const result of batchResults) {
          validatedActions.set(result.actionId, result.visionContext);
        }
      }

      // Apply vision context to actions
      const enrichedActions = actions.map(action => {
        const visionContext = validatedActions.get(action.actionId);
        if (visionContext) {
          return { ...action, visionContext };
        }
        return action;
      });

      logger.info('Action vision validation completed', {
        validatedCount: validatedActions.size,
      });

      return enrichedActions;
    } catch (error) {
      logger.error('Action vision validation failed, returning actions without vision context:', error);
      // Graceful degradation: return original actions without vision context
      return actions;
    }
  }

  /**
   * Determines if an action needs vision analysis
   */
  private needsVisionAnalysis(action: ContextualizedActionInfo): boolean {
    const state = action.accessibilityState;

    // Needs vision if missing accessible name
    if (!state.hasAriaLabel && !state.hasTextContent) {
      return true;
    }

    // Needs vision if text is too short (likely just icon)
    if (state.textContent && state.textContent.trim().length < 3) {
      return true;
    }

    // Needs vision if has critical or high severity issues
    const hasCriticalIssues = action.issues.some(issue => issue.severity === 'critical' || issue.severity === 'high');
    if (hasCriticalIssues) {
      return true;
    }

    return false;
  }

  /**
   * Validates a batch of actions using the vision model
   *
   * @param screenshot - Base64-encoded JPEG screenshot of the page
   * @param url - Page URL
   * @param pageTitle - Page title
   * @param actions - Batch of actions to validate
   * @returns Promise resolving to actions with vision context added
   */
  private async validateActionBatch(
    screenshot: string,
    url: string,
    pageTitle: string,
    actions: ContextualizedActionInfo[],
  ): Promise<Array<{ actionId: string; visionContext: ActionVisionContext }>> {
    try {
      // Create vision-capable chat model
      const chatModel = await this.createVisionModel();

      // Build validation prompt
      const { systemMessage, userMessage } = this.buildVisionValidationPrompt(screenshot, url, pageTitle, actions);

      // Call the vision model with timeout
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Vision validation timeout')), VISION_VALIDATION_TIMEOUT_MS),
      );

      const responsePromise = chatModel.invoke([systemMessage, userMessage]);
      const response = await Promise.race([responsePromise, timeoutPromise]);

      // Parse the vision model response
      return this.parseVisionResponse(response, actions);
    } catch (error) {
      logger.error('Failed to validate action batch:', error);
      // Return empty array on error
      return [];
    }
  }

  /**
   * Builds the prompt messages for vision validation
   *
   * @param screenshot - Base64-encoded screenshot
   * @param url - Page URL
   * @param pageTitle - Page title
   * @param actions - Actions to validate
   * @returns System and user messages for the vision model
   */
  private buildVisionValidationPrompt(
    screenshot: string,
    url: string,
    pageTitle: string,
    actions: ContextualizedActionInfo[],
  ): { systemMessage: SystemMessage; userMessage: HumanMessage } {
    const systemMessage =
      new SystemMessage(`You are an AI assistant specialized in web accessibility and interactive element analysis.

Your task is to analyze interactive elements (buttons, links, inputs) on a web page and provide:
1. Visual descriptions of what you see
2. Recognition of icons, symbols, and visual elements
3. Contextual understanding of the element's purpose
4. Suggested aria-label text for screen readers

INSTRUCTIONS:
- Look at the screenshot and identify each element by its position and surrounding context
- Describe visual elements like icons, colors, symbols
- Infer the purpose from visual design and context
- Generate clear, concise aria-label suggestions (max 50 characters)
- Recognize common UI patterns (shopping cart, menu, search, close, etc.)

Return your response as a JSON array with this structure:
[
  {
    "actionId": "action-0-abc123",
    "visualDescription": "Blue button with shopping cart icon and number 3",
    "recognizedText": "3",
    "recognizedIcons": ["shopping-cart"],
    "contextualPurpose": "Checkout button showing cart item count",
    "suggestedAriaLabel": "Proceed to checkout (3 items)",
    "confidence": 0.92
  }
]

CONFIDENCE LEVELS:
- 0.9-1.0: Very confident (clear icon, obvious purpose)
- 0.7-0.9: Confident (recognizable pattern)
- 0.5-0.7: Moderately confident (some ambiguity)
- 0.0-0.5: Low confidence (unclear purpose)

Return ONLY the JSON array as specified.`);

    const promptText = `Please analyze the following interactive elements from this web page:

PAGE CONTEXT:
- URL: ${sanitizeUrlForLogging(url)}
- Title: ${pageTitle}

ELEMENTS TO ANALYZE (${actions.length} elements):
${actions
  .map(
    (action, index) => `
${index + 1}. Element ID: ${action.actionId}
   Type: ${action.actionType}
   Tag: ${action.tagName}
   Current Text: "${action.accessibilityState.textContent || 'none'}"
   Current aria-label: "${action.accessibilityState.ariaLabel || 'none'}"
   Selector: ${action.selector}
   Issues: ${action.issues.map(i => i.type).join(', ') || 'none'}
   Surrounding Context: ${action.domContext.surroundingText || 'none'}
`,
  )
  .join('')}

Analyze the screenshot to locate these interactive elements and provide accessibility suggestions.
Focus on elements that lack clear labels or have accessibility issues.
Return ONLY the JSON array as specified.`;

    const userMessage = new HumanMessage({
      content: [
        { type: 'text', text: promptText },
        {
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${screenshot}` },
        },
      ],
    });

    return { systemMessage, userMessage };
  }

  /**
   * Creates a vision-capable chat model using Navigator model configuration
   *
   * @returns Promise resolving to configured chat model
   * @throws Error if no providers or Navigator model not configured
   */
  private async createVisionModel() {
    const providers = await llmProviderStore.getAllProviders();
    if (Object.keys(providers).length === 0) {
      throw new Error('No LLM providers configured');
    }

    await agentModelStore.cleanupLegacyValidatorSettings();

    const agentModels = await agentModelStore.getAllAgentModels();
    const navigatorModel = agentModels[AgentNameEnum.Navigator];

    if (!navigatorModel) {
      throw new Error('Navigator model not configured');
    }

    const providerConfig = providers[navigatorModel.provider];
    if (!providerConfig) {
      throw new Error(`Provider ${navigatorModel.provider} not found`);
    }

    return createChatModel(providerConfig, navigatorModel);
  }

  /**
   * Parses the vision model response into structured action vision contexts
   *
   * @param response - Raw response from the vision model
   * @param actions - Original actions for validation
   * @returns Array of action vision contexts
   */
  private parseVisionResponse(
    response: unknown,
    actions: ContextualizedActionInfo[],
  ): Array<{ actionId: string; visionContext: ActionVisionContext }> {
    try {
      // Extract content from LangChain message
      const content =
        typeof response === 'object' && response !== null && 'content' in response ? response.content : response;

      let jsonText: string;
      if (typeof content === 'string') {
        jsonText = content;
      } else {
        jsonText = JSON.stringify(content);
      }

      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = jsonText.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      }

      // Parse JSON response
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) {
        throw new Error('Response is not an array');
      }

      // Map parsed results to vision contexts
      const results: Array<{ actionId: string; visionContext: ActionVisionContext }> = [];

      for (const item of parsed) {
        if (!item.actionId) {
          logger.warning('Skipping vision result without actionId');
          continue;
        }

        const visionContext: ActionVisionContext = {
          visualDescription: item.visualDescription || '',
          recognizedText: item.recognizedText || '',
          recognizedIcons: Array.isArray(item.recognizedIcons) ? item.recognizedIcons : [],
          contextualPurpose: item.contextualPurpose || '',
          suggestedAriaLabel: item.suggestedAriaLabel || '',
          confidence: typeof item.confidence === 'number' ? item.confidence : 0.5,
        };

        // Only include if confidence is above minimum threshold
        if (visionContext.confidence >= MIN_CONFIDENCE_SCORE) {
          results.push({
            actionId: item.actionId,
            visionContext,
          });
        } else {
          logger.info(`Skipping low confidence vision result for ${item.actionId}`, {
            confidence: visionContext.confidence,
          });
        }
      }

      logger.info('Parsed vision response', {
        totalResults: parsed.length,
        validResults: results.length,
      });

      return results;
    } catch (error) {
      logger.error('Failed to parse vision response:', error);
      return [];
    }
  }

  /**
   * Checks if the configured model has vision capabilities
   *
   * @returns Promise resolving to boolean indicating vision capability
   */
  private async checkVisionCapability(): Promise<boolean> {
    try {
      const agentModels = await agentModelStore.getAllAgentModels();
      const navigatorModel = agentModels[AgentNameEnum.Navigator];

      if (!navigatorModel) {
        return false;
      }

      // Check if model name suggests vision capability
      // Common vision models: gpt-4-vision, gpt-4o, claude-3-opus, claude-3-sonnet, gemini-pro-vision
      const modelName = navigatorModel.modelName.toLowerCase();
      const hasVisionKeywords =
        modelName.includes('vision') ||
        modelName.includes('gpt-4o') ||
        modelName.includes('claude-3') ||
        modelName.includes('gemini') ||
        modelName.includes('llava');

      return hasVisionKeywords;
    } catch (error) {
      logger.error('Failed to check vision capability:', error);
      return false;
    }
  }
}
