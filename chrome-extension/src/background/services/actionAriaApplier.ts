import { createLogger } from '../log';
import type {
  ActionAriaApplication,
  DomModification,
  AccessibilityImprovement,
} from '@extension/storage/lib/accessibility/types';
import { DomModificationType } from '@extension/storage/lib/accessibility/types';

const logger = createLogger('ActionAriaApplier');

/**
 * Prefix for all visible-ai generated ARIA labels
 */
const VISIBLE_AI_PREFIX = 'visible-ai: ';

/**
 * Service responsible for applying ARIA improvements to action elements
 *
 * This service handles applying accessibility improvements to interactive elements
 * including buttons, links, inputs, and custom controls. It supports multiple
 * ARIA attributes and ensures proper prefixing for traceability.
 *
 * Supported improvements:
 * - aria-label (with visible-ai prefix)
 * - aria-describedby (with visible-ai prefix)
 * - role
 * - tabindex
 * - aria-disabled
 * - title (with visible-ai prefix)
 */
export class ActionAriaApplier {
  /**
   * Applies ARIA improvements to a single action element
   *
   * Each improvement is applied as a separate DOM modification for granular
   * tracking and undo capabilities.
   *
   * @param tabId - Chrome tab ID where the element is located
   * @param application - Action ARIA application request with improvements
   * @returns Promise resolving to array of DOM modifications (one per improvement)
   *
   * @example
   * const modifications = await applier.applyActionImprovements(tabId, {
   *   actionId: 'action-0-abc123',
   *   selector: 'button.checkout',
   *   xpath: '//button[@class="checkout"]',
   *   improvements: [
   *     { attribute: 'aria-label', suggestedValue: 'Proceed to checkout', ... }
   *   ]
   * });
   */
  async applyActionImprovements(tabId: number, application: ActionAriaApplication): Promise<DomModification[]> {
    logger.info('Applying ARIA improvements to action', {
      actionId: application.actionId,
      improvementCount: application.improvements.length,
      selector: application.selector,
    });

    const modifications: DomModification[] = [];

    for (const improvement of application.improvements) {
      try {
        const modification = await this.applySingleImprovement(tabId, application, improvement);
        modifications.push(modification);
      } catch (error) {
        logger.error('Failed to apply improvement', {
          improvement: improvement.attribute,
          error,
        });

        modifications.push({
          modificationId: this.generateModificationId(),
          type: this.getModificationType(improvement.attribute),
          selector: application.selector,
          xpath: application.xpath,
          attribute: improvement.attribute,
          newValue: improvement.suggestedValue,
          applied: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const successCount = modifications.filter(m => m.applied).length;
    const failureCount = modifications.filter(m => !m.applied).length;

    logger.info('Action improvements completed', {
      actionId: application.actionId,
      total: modifications.length,
      success: successCount,
      failure: failureCount,
    });

    return modifications;
  }

  /**
   * Applies a single improvement to an element
   *
   * Uses both CSS selector and XPath for robust element selection.
   * Falls back to XPath if selector fails.
   *
   * @param tabId - Chrome tab ID
   * @param application - Action ARIA application request
   * @param improvement - Single improvement to apply
   * @returns Promise resolving to DOM modification record
   */
  private async applySingleImprovement(
    tabId: number,
    application: ActionAriaApplication,
    improvement: AccessibilityImprovement,
  ): Promise<DomModification> {
    const modificationId = this.generateModificationId();
    const modificationType = this.getModificationType(improvement.attribute);

    // Determine value to apply (prefix if it's a label/description)
    const valueToApply = this.shouldPrefix(improvement.attribute)
      ? `${VISIBLE_AI_PREFIX}${improvement.suggestedValue}`
      : improvement.suggestedValue;

    logger.debug('Applying single improvement', {
      modificationId,
      attribute: improvement.attribute,
      valueLength: valueToApply.length,
      needsPrefix: this.shouldPrefix(improvement.attribute),
    });

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (selector: string, xpath: string, attribute: string, value: string, modId: string) => {
        // Try selector first, fallback to xpath
        let element: Element | null = document.querySelector(selector);

        if (!element && xpath) {
          const xpathResult = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          element = xpathResult.singleNodeValue as Element;
        }

        if (!element) {
          throw new Error(`Element not found: ${selector}`);
        }

        // Store original value for undo
        const originalValue = element.getAttribute(attribute) || '';

        // Apply new attribute value
        element.setAttribute(attribute, value);

        // Mark as modified
        element.setAttribute('data-visible-ai-modified', 'true');

        // Track multiple modification IDs (element may have multiple improvements)
        const existingIds = element.getAttribute('data-visible-ai-modification-ids');
        if (!existingIds) {
          element.setAttribute('data-visible-ai-modification-ids', modId);
        } else {
          element.setAttribute('data-visible-ai-modification-ids', `${existingIds},${modId}`);
        }

        // Track modification type for this specific change
        element.setAttribute(`data-visible-ai-mod-${modId}-type`, attribute);

        return {
          success: true,
          originalValue,
        };
      },
      args: [application.selector, application.xpath || '', improvement.attribute, valueToApply, modificationId],
    });

    const result = results[0]?.result;

    if (!result || !result.success) {
      throw new Error('Script execution failed');
    }

    logger.debug('Single improvement applied successfully', {
      modificationId,
      attribute: improvement.attribute,
    });

    return {
      modificationId,
      type: modificationType,
      selector: application.selector,
      xpath: application.xpath,
      attribute: improvement.attribute,
      newValue: valueToApply,
      originalValue: result.originalValue,
      applied: true,
      appliedAt: Date.now(),
    };
  }

  /**
   * Applies improvements to multiple actions in batch
   *
   * Processes all actions and their improvements sequentially to avoid
   * race conditions and provide detailed error reporting.
   *
   * @param tabId - Chrome tab ID
   * @param applications - Array of action ARIA applications
   * @returns Promise resolving to array of all DOM modifications
   *
   * @example
   * const modifications = await applier.applyBatch(tabId, [
   *   { actionId: 'action-0', selector: 'button.submit', improvements: [...] },
   *   { actionId: 'action-1', selector: 'a.link', improvements: [...] },
   * ]);
   *
   * console.log(`Applied ${modifications.filter(m => m.applied).length} improvements`);
   */
  async applyBatch(tabId: number, applications: ActionAriaApplication[]): Promise<DomModification[]> {
    logger.info('Applying batch of action improvements', {
      actionCount: applications.length,
      totalImprovements: applications.reduce((sum, app) => sum + app.improvements.length, 0),
    });

    const allModifications: DomModification[] = [];

    for (const application of applications) {
      const modifications = await this.applyActionImprovements(tabId, application);
      allModifications.push(...modifications);

      // Small delay to avoid overwhelming the page
      if (applications.length > 10) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    const successCount = allModifications.filter(m => m.applied).length;
    const failureCount = allModifications.filter(m => !m.applied).length;

    logger.info('Batch application completed', {
      total: allModifications.length,
      success: successCount,
      failure: failureCount,
      successRate: ((successCount / allModifications.length) * 100).toFixed(1) + '%',
    });

    return allModifications;
  }

  /**
   * Determines if attribute value should be prefixed with "visible-ai: "
   *
   * Label and description attributes are prefixed for transparency.
   * Structural attributes (role, tabindex) are not prefixed.
   *
   * @param attribute - Attribute name to check
   * @returns True if attribute should be prefixed
   */
  private shouldPrefix(attribute: string): boolean {
    const labelAttributes = ['aria-label', 'aria-describedby', 'title'];

    return labelAttributes.includes(attribute);
  }

  /**
   * Maps attribute name to DomModificationType
   *
   * @param attribute - Attribute name
   * @returns Corresponding DomModificationType enum value
   */
  private getModificationType(attribute: string): DomModificationType {
    switch (attribute) {
      case 'aria-label':
        return DomModificationType.ARIA_LABEL;
      case 'aria-describedby':
        return DomModificationType.ARIA_DESCRIBEDBY;
      case 'role':
        return DomModificationType.ROLE;
      case 'tabindex':
        return DomModificationType.TABINDEX;
      case 'aria-disabled':
        return DomModificationType.ARIA_DISABLED;
      default:
        // Fallback for unknown attributes
        logger.warning('Unknown attribute type, using ARIA_LABEL as fallback', { attribute });
        return DomModificationType.ARIA_LABEL;
    }
  }

  /**
   * Generates unique modification ID
   *
   * Format: mod-{timestamp}-{random}
   * Example: mod-1704649200000-abc123xyz
   *
   * @returns Unique modification ID string
   */
  private generateModificationId(): string {
    return `mod-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
}
