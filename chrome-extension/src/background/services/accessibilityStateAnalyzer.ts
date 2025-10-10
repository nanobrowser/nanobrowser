import { createLogger } from '../log';
import {
  AccessibilityIssueSeverity,
  ActionType,
  type AccessibilityIssue,
  type AccessibilityImprovement,
  type ContextualizedActionInfo,
  type AccessibilityState,
} from '@extension/storage/lib/accessibility/types';

const logger = createLogger('AccessibilityStateAnalyzer');

/**
 * WCAG Guidelines references for accessibility issues
 */
const WCAG_REFERENCES = {
  NAME_ACCESSIBLE: 'WCAG 2.1 - 4.1.2 Name, Role, Value (Level A)',
  KEYBOARD_ACCESSIBLE: 'WCAG 2.1 - 2.1.1 Keyboard (Level A)',
  FOCUS_VISIBLE: 'WCAG 2.1 - 2.4.7 Focus Visible (Level AA)',
  LINK_PURPOSE: 'WCAG 2.1 - 2.4.4 Link Purpose (Level A)',
  LABEL_IN_NAME: 'WCAG 2.1 - 2.5.3 Label in Name (Level A)',
  IDENTIFY_INPUT_PURPOSE: 'WCAG 2.1 - 1.3.5 Identify Input Purpose (Level AA)',
};

/**
 * Common vague link texts that should be avoided
 */
const VAGUE_LINK_TEXTS = ['click here', 'read more', 'learn more', 'here', 'more', 'link', 'click'];

/**
 * Service for analyzing accessibility state and identifying issues in action elements
 */
export class AccessibilityStateAnalyzer {
  /**
   * Analyzes actions and populates issues, improvements, and scores
   *
   * @param actions - Array of contextualized actions
   * @returns Same array with issues, improvements, and scores populated
   */
  analyzeActions(actions: ContextualizedActionInfo[]): ContextualizedActionInfo[] {
    logger.info('Starting accessibility state analysis', {
      actionCount: actions.length,
    });
    debugger;
    const analyzedActions = actions.map(action => {
      // Analyze based on action type
      const issues = this.identifyIssues(action);
      const improvements = this.generateImprovements(action, issues);
      const score = this.calculateAccessibilityScore(action, issues);

      return {
        ...action,
        issues,
        improvements,
        accessibilityScore: score,
      };
    });

    const totalIssues = analyzedActions.reduce((sum, a) => sum + a.issues.length, 0);
    const avgScore =
      analyzedActions.length > 0
        ? analyzedActions.reduce((sum, a) => sum + a.accessibilityScore, 0) / analyzedActions.length
        : 0;

    logger.info('Analysis completed', {
      totalIssues,
      averageScore: avgScore.toFixed(1),
    });

    return analyzedActions;
  }

  /**
   * Identifies accessibility issues for an action element
   */
  private identifyIssues(action: ContextualizedActionInfo): AccessibilityIssue[] {
    const issues: AccessibilityIssue[] = [];
    const state = action.accessibilityState;

    // CRITICAL: Missing accessible name
    if (!this.hasAccessibleName(state)) {
      issues.push({
        type: 'missing-accessible-name',
        severity: AccessibilityIssueSeverity.CRITICAL,
        description: 'Element has no accessible name (aria-label, aria-labelledby, or text content)',
        wcagReference: WCAG_REFERENCES.NAME_ACCESSIBLE,
        recommendation: 'Add aria-label or ensure element has visible text content',
      });
    }

    // HIGH: Button with only icon/image (no text)
    if (action.actionType === ActionType.BUTTON && !state.hasTextContent && !state.hasAriaLabel) {
      issues.push({
        type: 'icon-button-no-label',
        severity: AccessibilityIssueSeverity.HIGH,
        description: 'Button appears to contain only an icon without text label',
        wcagReference: WCAG_REFERENCES.NAME_ACCESSIBLE,
        recommendation: 'Add aria-label to describe button purpose',
      });
    }

    // HIGH: Link with vague text
    if (action.actionType === ActionType.LINK) {
      const linkText = (state.textContent || '').toLowerCase().trim();
      const isVague = VAGUE_LINK_TEXTS.some(vague => linkText === vague || linkText.includes(vague));

      if (isVague && !state.hasAriaLabel) {
        issues.push({
          type: 'vague-link-text',
          severity: AccessibilityIssueSeverity.HIGH,
          description: `Link text "${state.textContent}" is not descriptive`,
          wcagReference: WCAG_REFERENCES.LINK_PURPOSE,
          currentValue: state.textContent,
          recommendation: 'Use aria-label to provide descriptive link purpose',
        });
      }
    }

    // MEDIUM: Custom control without role
    if (action.actionType === ActionType.CUSTOM_CONTROL && !state.hasRole) {
      issues.push({
        type: 'custom-control-no-role',
        severity: AccessibilityIssueSeverity.MEDIUM,
        description: 'Custom interactive element missing ARIA role',
        wcagReference: WCAG_REFERENCES.NAME_ACCESSIBLE,
        recommendation: 'Add appropriate role (button, link, etc.)',
      });
    }

    // MEDIUM: Not keyboard accessible
    if (!state.isFocusable && action.actionType === ActionType.CUSTOM_CONTROL) {
      issues.push({
        type: 'not-keyboard-accessible',
        severity: AccessibilityIssueSeverity.MEDIUM,
        description: 'Element may not be keyboard accessible',
        wcagReference: WCAG_REFERENCES.KEYBOARD_ACCESSIBLE,
        recommendation: 'Ensure element has tabindex="0" or is natively focusable',
      });
    }

    // MEDIUM: Input without proper label
    if (action.actionType === ActionType.INPUT && !state.hasAriaLabel && !state.hasAriaLabelledBy && !state.hasTitle) {
      issues.push({
        type: 'input-no-label',
        severity: AccessibilityIssueSeverity.MEDIUM,
        description: 'Input field lacks proper label',
        wcagReference: WCAG_REFERENCES.IDENTIFY_INPUT_PURPOSE,
        recommendation: 'Add aria-label, aria-labelledby, or associate with a <label> element',
      });
    }

    // LOW: Missing description for additional context
    if (!state.hasTitle && !state.hasAriaDescribedBy && this.hasAccessibleName(state)) {
      issues.push({
        type: 'missing-description',
        severity: AccessibilityIssueSeverity.LOW,
        description: 'Element could benefit from additional description',
        wcagReference: WCAG_REFERENCES.NAME_ACCESSIBLE,
        recommendation: 'Consider adding title or aria-describedby for extra context',
      });
    }

    // INFO: Hidden but still in tab order
    if (state.ariaHidden === 'true' && state.isFocusable) {
      issues.push({
        type: 'hidden-focusable',
        severity: AccessibilityIssueSeverity.INFO,
        description: 'Element is aria-hidden but still focusable',
        wcagReference: WCAG_REFERENCES.FOCUS_VISIBLE,
        recommendation: 'Add tabindex="-1" to remove from tab order',
      });
    }

    // INFO: Disabled elements with aria-disabled inconsistency
    if (state.isDisabled && !state.ariaDisabled) {
      issues.push({
        type: 'disabled-no-aria',
        severity: AccessibilityIssueSeverity.INFO,
        description: 'Element has disabled attribute but missing aria-disabled',
        wcagReference: WCAG_REFERENCES.NAME_ACCESSIBLE,
        recommendation: 'Add aria-disabled="true" for better assistive technology support',
      });
    }

    return issues;
  }

  /**
   * Generates improvement suggestions based on identified issues
   */
  private generateImprovements(
    action: ContextualizedActionInfo,
    issues: AccessibilityIssue[],
  ): AccessibilityImprovement[] {
    const improvements: AccessibilityImprovement[] = [];

    // Generate improvements for each issue
    for (const issue of issues) {
      switch (issue.type) {
        case 'missing-accessible-name':
        case 'icon-button-no-label':
          improvements.push({
            attribute: 'aria-label',
            suggestedValue: this.generateAriaLabel(action),
            reasoning: 'Provides accessible name for screen readers',
            priority: 10,
          });
          break;

        case 'vague-link-text':
          improvements.push({
            attribute: 'aria-label',
            suggestedValue: this.generateContextualLinkLabel(action),
            reasoning: 'Clarifies link purpose without changing visible text',
            priority: 8,
          });
          break;

        case 'custom-control-no-role':
          improvements.push({
            attribute: 'role',
            suggestedValue: this.suggestRole(action),
            reasoning: 'Identifies element type for assistive technologies',
            priority: 9,
          });
          break;

        case 'not-keyboard-accessible':
          improvements.push({
            attribute: 'tabindex',
            suggestedValue: '0',
            reasoning: 'Makes element keyboard accessible',
            priority: 7,
          });
          break;

        case 'input-no-label':
          improvements.push({
            attribute: 'aria-label',
            suggestedValue: this.generateInputLabel(action),
            reasoning: 'Provides accessible label for input field',
            priority: 9,
          });
          break;

        case 'missing-description':
          improvements.push({
            attribute: 'title',
            suggestedValue: this.generateDescription(action),
            reasoning: 'Adds helpful context for users',
            priority: 4,
          });
          break;

        case 'hidden-focusable':
          improvements.push({
            attribute: 'tabindex',
            suggestedValue: '-1',
            reasoning: 'Removes hidden element from tab order',
            priority: 5,
          });
          break;

        case 'disabled-no-aria':
          improvements.push({
            attribute: 'aria-disabled',
            suggestedValue: 'true',
            reasoning: 'Improves assistive technology support for disabled state',
            priority: 3,
          });
          break;
      }
    }

    return improvements.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Checks if element has an accessible name
   */
  private hasAccessibleName(state: AccessibilityState): boolean {
    return (
      state.hasAriaLabel ||
      state.hasAriaLabelledBy ||
      (state.hasTextContent && (state.textContent?.trim().length || 0) > 0) ||
      state.hasTitle ||
      state.hasAlt
    );
  }

  /**
   * Generates suggested aria-label (placeholder - will be enhanced by Vision AI)
   */
  private generateAriaLabel(action: ContextualizedActionInfo): string {
    const state = action.accessibilityState;

    // Try to use existing text content if available
    if (state.textContent && state.textContent.trim()) {
      return state.textContent.trim();
    }

    // Try to use title if available
    if (state.title) {
      return state.title;
    }

    // Fallback based on element type
    const type = action.actionType;
    switch (type) {
      case ActionType.BUTTON:
        return 'Button (needs description)';
      case ActionType.LINK:
        return 'Link (needs description)';
      case ActionType.INPUT:
        return this.generateInputLabel(action);
      default:
        return `${type} (needs description)`;
    }
  }

  /**
   * Generates contextual label for links
   */
  private generateContextualLinkLabel(action: ContextualizedActionInfo): string {
    const currentText = action.accessibilityState.textContent || 'Link';
    const context = action.domContext.surroundingText || '';

    // Combine current text with context
    if (context) {
      return `${currentText}: ${context}`.substring(0, 100);
    }

    return `${currentText} (needs more context)`;
  }

  /**
   * Generates label for input fields
   */
  private generateInputLabel(action: ContextualizedActionInfo): string {
    const state = action.accessibilityState;

    // Try placeholder
    if (state.textContent && state.textContent.includes('placeholder')) {
      return state.textContent;
    }

    // Try surrounding text
    if (action.domContext.surroundingText) {
      return action.domContext.surroundingText.substring(0, 50);
    }

    // Fallback based on input type
    const inputType = action.tagName === 'input' ? 'text input' : action.tagName;
    return `${inputType} field`;
  }

  /**
   * Generates description for additional context
   */
  private generateDescription(action: ContextualizedActionInfo): string {
    const context = action.domContext.surroundingText || '';
    const label = action.accessibilityState.ariaLabel || action.accessibilityState.textContent || '';

    if (context && context !== label) {
      return context.substring(0, 150);
    }

    return 'Additional context needed';
  }

  /**
   * Suggests appropriate ARIA role for custom controls
   */
  private suggestRole(action: ContextualizedActionInfo): string {
    const tag = action.tagName.toLowerCase();

    // Heuristic based on tag name and context
    if (tag === 'div' || tag === 'span') {
      // Check for common patterns
      if (action.accessibilityState.textContent) {
        return 'button';
      }
    }

    return 'button'; // Safe default for interactive elements
  }

  /**
   * Calculates accessibility score (0-100)
   */
  private calculateAccessibilityScore(action: ContextualizedActionInfo, issues: AccessibilityIssue[]): number {
    let score = 100;

    // Deduct points based on issue severity
    for (const issue of issues) {
      switch (issue.severity) {
        case AccessibilityIssueSeverity.CRITICAL:
          score -= 30;
          break;
        case AccessibilityIssueSeverity.HIGH:
          score -= 20;
          break;
        case AccessibilityIssueSeverity.MEDIUM:
          score -= 10;
          break;
        case AccessibilityIssueSeverity.LOW:
          score -= 5;
          break;
        case AccessibilityIssueSeverity.INFO:
          score -= 2;
          break;
      }
    }

    // Bonus points for good practices
    const state = action.accessibilityState;

    // Has both aria-label and text content
    if (state.hasAriaLabel && state.hasTextContent) {
      score += 5;
    }

    // Has description in addition to label
    if (state.hasAriaDescribedBy || state.hasTitle) {
      score += 3;
    }

    // Properly disabled
    if (state.isDisabled && state.ariaDisabled === 'true') {
      score += 2;
    }

    // Ensure score stays within 0-100 range
    return Math.max(0, Math.min(100, score));
  }
}
