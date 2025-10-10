import { createLogger } from '../log';
import type { ImageAltApplication, DomModification } from '@extension/storage/lib/accessibility/types';
import { DomModificationType } from '@extension/storage/lib/accessibility/types';

const logger = createLogger('ImageAltApplier');

/**
 * Prefix for all visible-ai generated alt text
 */
const VISIBLE_AI_PREFIX = 'visible-ai: ';

/**
 * Service responsible for applying alt text to image elements
 *
 * This service handles two types of images:
 * 1. Regular <img> elements - applies alt attribute
 * 2. Background-image elements - applies aria-label + role="img"
 *
 * All modifications are prefixed with "visible-ai: " for traceability
 */
export class ImageAltApplier {
  /**
   * Applies alt text to a single image element
   *
   * @param tabId - Chrome tab ID where the image is located
   * @param application - Image alt application request
   * @returns Promise resolving to DOM modification record
   *
   * @example
   * const modification = await applier.applyImageAlt(tabId, {
   *   imageUrl: 'https://example.com/image.jpg',
   *   selector: 'img.hero-image',
   *   altText: 'A beautiful sunset over the ocean',
   *   isBackground: false,
   * });
   */
  async applyImageAlt(tabId: number, application: ImageAltApplication): Promise<DomModification> {
    const modificationId = this.generateModificationId();

    try {
      logger.info('Applying alt text to image', {
        selector: application.selector,
        isBackground: application.isBackground,
        altTextLength: application.altText.length,
      });

      // Prepare the modification instruction
      const prefixedAlt = `${VISIBLE_AI_PREFIX}${application.altText}`;

      if (application.isBackground) {
        // Background-image element: use aria-label + role="img"
        return await this.applyBackgroundImageAlt(tabId, modificationId, application, prefixedAlt);
      } else {
        // Regular <img> element: use alt attribute
        return await this.applyRegularImageAlt(tabId, modificationId, application, prefixedAlt);
      }
    } catch (error) {
      logger.error('Failed to apply image alt', error);

      return {
        modificationId,
        type: application.isBackground ? DomModificationType.BACKGROUND_IMAGE_ALT : DomModificationType.IMAGE_ALT,
        selector: application.selector,
        attribute: application.isBackground ? 'aria-label' : 'alt',
        newValue: `${VISIBLE_AI_PREFIX}${application.altText}`,
        applied: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Applies alt attribute to regular <img> element
   *
   * @param tabId - Chrome tab ID
   * @param modificationId - Unique modification ID
   * @param application - Image alt application request
   * @param prefixedAlt - Alt text with "visible-ai: " prefix
   * @returns Promise resolving to DOM modification record
   */
  private async applyRegularImageAlt(
    tabId: number,
    modificationId: string,
    application: ImageAltApplication,
    prefixedAlt: string,
  ): Promise<DomModification> {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (selector: string, newAlt: string, modId: string) => {
        const img = document.querySelector(selector) as HTMLImageElement;

        if (!img) {
          throw new Error(`Image element not found: ${selector}`);
        }

        if (img.tagName.toLowerCase() !== 'img') {
          throw new Error(`Element is not an <img> tag: ${selector} (found: ${img.tagName})`);
        }

        // Store original alt for undo
        const originalAlt = img.getAttribute('alt') || '';

        // Apply new alt text
        img.setAttribute('alt', newAlt);

        // Mark as modified by visible-ai
        img.setAttribute('data-visible-ai-modified', 'true');
        img.setAttribute('data-visible-ai-modification-id', modId);
        img.setAttribute('data-visible-ai-modification-type', 'image-alt');

        return {
          success: true,
          originalValue: originalAlt,
        };
      },
      args: [application.selector, prefixedAlt, modificationId],
    });

    const result = results[0]?.result;

    if (!result || !result.success) {
      throw new Error('Script execution failed');
    }

    logger.info('Regular image alt applied successfully', {
      modificationId,
      selector: application.selector,
    });

    return {
      modificationId,
      type: DomModificationType.IMAGE_ALT,
      selector: application.selector,
      attribute: 'alt',
      newValue: prefixedAlt,
      originalValue: result.originalValue,
      applied: true,
      appliedAt: Date.now(),
    };
  }

  /**
   * Applies aria-label to background-image element
   *
   * This method also sets role="img" if not already present,
   * making the background image accessible to screen readers.
   *
   * @param tabId - Chrome tab ID
   * @param modificationId - Unique modification ID
   * @param application - Image alt application request
   * @param prefixedAlt - Alt text with "visible-ai: " prefix
   * @returns Promise resolving to DOM modification record
   */
  private async applyBackgroundImageAlt(
    tabId: number,
    modificationId: string,
    application: ImageAltApplication,
    prefixedAlt: string,
  ): Promise<DomModification> {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (selector: string, newAlt: string, modId: string) => {
        const element = document.querySelector(selector);

        if (!element) {
          throw new Error(`Element not found: ${selector}`);
        }

        // Verify it has background-image
        const style = window.getComputedStyle(element);
        if (!style.backgroundImage || style.backgroundImage === 'none') {
          throw new Error(`Element has no background-image: ${selector}`);
        }

        // Store original values for undo
        const originalAriaLabel = element.getAttribute('aria-label') || '';
        const originalRole = element.getAttribute('role') || '';
        const hadRole = !!originalRole;

        // Apply aria-label
        element.setAttribute('aria-label', newAlt);

        // Set role="img" if not already set
        if (!element.getAttribute('role')) {
          element.setAttribute('role', 'img');
        }

        // Mark as modified
        element.setAttribute('data-visible-ai-modified', 'true');
        element.setAttribute('data-visible-ai-modification-id', modId);
        element.setAttribute('data-visible-ai-modification-type', 'background-image-alt');

        // Store whether role was added by us (for proper undo)
        if (!hadRole) {
          element.setAttribute('data-visible-ai-added-role', 'true');
        }

        return {
          success: true,
          originalValue: originalAriaLabel,
          originalRole: originalRole,
          roleWasAdded: !hadRole,
        };
      },
      args: [application.selector, prefixedAlt, modificationId],
    });

    const result = results[0]?.result;

    if (!result || !result.success) {
      throw new Error('Script execution failed');
    }

    logger.info('Background image alt applied successfully', {
      modificationId,
      selector: application.selector,
      roleWasAdded: result.roleWasAdded,
    });

    return {
      modificationId,
      type: DomModificationType.BACKGROUND_IMAGE_ALT,
      selector: application.selector,
      attribute: 'aria-label',
      newValue: prefixedAlt,
      originalValue: result.originalValue,
      applied: true,
      appliedAt: Date.now(),
    };
  }

  /**
   * Applies alt text to multiple images in batch
   *
   * Processes each image sequentially to avoid overwhelming the page
   * and to provide detailed error reporting per image.
   *
   * @param tabId - Chrome tab ID
   * @param applications - Array of image alt applications
   * @returns Promise resolving to array of DOM modifications
   *
   * @example
   * const modifications = await applier.applyBatch(tabId, [
   *   { imageUrl: '...', selector: 'img.hero', altText: '...', isBackground: false },
   *   { imageUrl: '...', selector: '.bg-image', altText: '...', isBackground: true },
   * ]);
   *
   * console.log(`Applied ${modifications.filter(m => m.applied).length} modifications`);
   */
  async applyBatch(tabId: number, applications: ImageAltApplication[]): Promise<DomModification[]> {
    logger.info('Applying batch of image alts', {
      count: applications.length,
      tabId,
    });

    const modifications: DomModification[] = [];

    // Process each application sequentially
    for (const application of applications) {
      const modification = await this.applyImageAlt(tabId, application);
      modifications.push(modification);

      // Small delay to avoid overwhelming the page
      if (applications.length > 10) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    const successCount = modifications.filter(m => m.applied).length;
    const failureCount = modifications.filter(m => !m.applied).length;

    logger.info('Batch application completed', {
      total: modifications.length,
      success: successCount,
      failure: failureCount,
      successRate: ((successCount / modifications.length) * 100).toFixed(1) + '%',
    });

    return modifications;
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
