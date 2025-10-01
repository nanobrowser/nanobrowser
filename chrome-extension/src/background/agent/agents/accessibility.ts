import { z } from 'zod';
import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { createLogger } from '@src/background/log';
import type { AgentOutput } from '../types';
import { Actors, ExecutionState } from '../event/types';
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

const logger = createLogger('AccessibilityAgent');

// Schema for improved alt text
const improvedAltTextSchema = z.object({
  selector: z.string().describe('CSS selector for the image element'),
  originalAlt: z.string().describe('Original alt text (if any)'),
  improvedAlt: z.string().describe('Improved, contextual alt text'),
  isMainContent: z.boolean().describe('Whether this image is part of main content (not advertisement/decoration)'),
});

// Schema for accessibility issues
const accessibilityIssueSchema = z.object({
  type: z
    .enum(['missing-alt', 'poor-heading-structure', 'low-contrast', 'no-focus-indicators', 'missing-labels'])
    .describe('Type of accessibility issue'),
  description: z.string().describe('Description of the accessibility issue found'),
  suggestions: z.array(z.string()).describe('Specific suggestions to fix the issue'),
  severity: z.enum(['low', 'medium', 'high', 'critical']).describe('Severity level of the issue'),
});

// Schema for accessibility agent output
export const accessibilityOutputSchema = z.object({
  pageTitle: z.string().optional().describe('Clean, descriptive page title'),
  pageSummary: z.string().describe('Concise summary of the main page content and purpose'),
  improvedAltTexts: z.array(improvedAltTextSchema).describe('Array of improved alt texts for meaningful images'),
  accessibilityIssues: z.array(accessibilityIssueSchema).describe('Array of accessibility issues found on the page'),
  mainContentSummary: z
    .string()
    .describe('Summary focusing specifically on the main content, excluding navigation and sidebars'),
  keyElements: z.array(z.string()).describe('List of key interactive elements and their purposes'),
});

export type AccessibilityOutput = z.infer<typeof accessibilityOutputSchema>;

export interface AccessibilityResult {
  pageTitle?: string;
  pageSummary: string;
  improvedAltTexts: Array<{
    selector: string;
    originalAlt: string;
    improvedAlt: string;
    isMainContent: boolean;
  }>;
  accessibilityIssues: Array<{
    type: 'missing-alt' | 'poor-heading-structure' | 'low-contrast' | 'no-focus-indicators' | 'missing-labels';
    description: string;
    suggestions: string[];
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>;
  mainContentSummary: string;
  keyElements: string[];
}

export class AccessibilityAgent extends BaseAgent<typeof accessibilityOutputSchema, AccessibilityResult> {
  constructor(options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    super(accessibilityOutputSchema, options, { ...extraOptions, id: 'accessibility' });
  }

  async execute(): Promise<AgentOutput<AccessibilityResult>> {
    try {
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_START, 'Analyzing page accessibility...');
      // Add current browser state message
      const userMessage = await this.prompt.getUserMessage(this.context);
      const allMessages = [this.prompt.getSystemMessage(), userMessage];

      // Get the model output
      const modelOutput = await this.invoke(allMessages);

      if (!modelOutput) {
        throw new Error('Failed to get accessibility analysis from model');
      }

      // Clean the model output to remove any potentially harmful content
      const cleanedOutput: AccessibilityResult = {
        pageTitle: modelOutput.pageTitle,
        pageSummary: filterExternalContent(modelOutput.pageSummary),
        improvedAltTexts: modelOutput.improvedAltTexts.map(item => ({
          ...item,
          improvedAlt: filterExternalContent(item.improvedAlt),
        })),
        accessibilityIssues: modelOutput.accessibilityIssues.map(issue => ({
          ...issue,
          description: filterExternalContent(issue.description),
          suggestions: issue.suggestions.map(suggestion => filterExternalContent(suggestion)),
        })),
        mainContentSummary: filterExternalContent(modelOutput.mainContentSummary),
        keyElements: modelOutput.keyElements.map(element => filterExternalContent(element)),
      };

      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_OK, 'Accessibility analysis completed');
      logger.info('Accessibility analysis completed', JSON.stringify(cleanedOutput, null, 2));

      return {
        id: this.id,
        result: cleanedOutput,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Handle different types of errors
      if (isAuthenticationError(error)) {
        throw new ChatModelAuthError(errorMessage, error);
      } else if (isBadRequestError(error)) {
        throw new ChatModelBadRequestError(errorMessage, error);
      } else if (isAbortedError(error)) {
        throw new RequestCancelledError(errorMessage);
      } else if (isForbiddenError(error)) {
        throw new ChatModelForbiddenError(LLM_FORBIDDEN_ERROR_MESSAGE, error);
      }

      logger.error(`Accessibility analysis failed: ${errorMessage}`);
      this.context.emitEvent(
        Actors.NAVIGATOR,
        ExecutionState.STEP_FAIL,
        `Accessibility analysis failed: ${errorMessage}`,
      );

      return {
        id: this.id,
        error: errorMessage,
      };
    }
  }
}
