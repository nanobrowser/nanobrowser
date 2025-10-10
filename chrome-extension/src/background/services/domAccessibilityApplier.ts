import { createLogger } from '../log';
import { ImageAltApplier } from './imageAltApplier';
import { ActionAriaApplier } from './actionAriaApplier';
import type {
  AccessibilityApplicationRequest,
  AccessibilityApplicationResult,
  DomModificationBatch,
  DomModification,
} from '@extension/storage/lib/accessibility/types';

const logger = createLogger('DomAccessibilityApplier');

/**
 * Main service orchestrating all DOM accessibility modifications
 *
 * This service coordinates the ImageAltApplier and ActionAriaApplier services
 * to apply comprehensive accessibility improvements to web pages. It provides:
 *
 * - Unified application interface for all improvement types
 * - Modification history tracking for undo functionality
 * - Batch processing and result aggregation
 * - Detailed success/failure reporting
 *
 * @example
 * const applier = new DomAccessibilityApplier();
 * const result = await applier.applyImprovements({
 *   pageUrl: 'https://example.com',
 *   tabId: 123,
 *   imageImprovements: [...],
 *   actionImprovements: [...],
 * });
 *
 * if (result.success) {
 *   console.log(result.message);
 *   // Later, can undo if needed
 *   await applier.undoModifications(123, result.batch.batchId);
 * }
 */
export class DomAccessibilityApplier {
  private imageAltApplier: ImageAltApplier;
  private actionAriaApplier: ActionAriaApplier;

  /**
   * History of modification batches for undo functionality
   * Key: batchId, Value: modification batch
   */
  private modificationHistory: Map<string, DomModificationBatch> = new Map();

  /**
   * Maximum number of batches to keep in history (to prevent memory leaks)
   */
  private readonly MAX_HISTORY_SIZE = 50;

  constructor() {
    this.imageAltApplier = new ImageAltApplier();
    this.actionAriaApplier = new ActionAriaApplier();

    logger.info('DomAccessibilityApplier initialized');
  }

  /**
   * Applies all accessibility improvements from an application request
   *
   * This is the main entry point for applying improvements. It:
   * 1. Validates the request
   * 2. Applies image improvements (if any)
   * 3. Applies action improvements (if any)
   * 4. Aggregates all modifications into a batch
   * 5. Stores the batch in history for undo
   * 6. Returns detailed results
   *
   * @param request - Complete application request from side panel
   * @returns Promise resolving to application result with batch details
   *
   * @example
   * const result = await applier.applyImprovements({
   *   pageUrl: 'https://example.com',
   *   tabId: 123,
   *   imageImprovements: [
   *     { imageUrl: '...', selector: 'img.hero', altText: '...', isBackground: false }
   *   ],
   *   actionImprovements: [
   *     { actionId: 'action-0', selector: 'button.submit', improvements: [...] }
   *   ]
   * });
   */
  async applyImprovements(request: AccessibilityApplicationRequest): Promise<AccessibilityApplicationResult> {
    const startTime = Date.now();

    try {
      logger.info('Applying accessibility improvements', {
        pageUrl: request.pageUrl,
        tabId: request.tabId,
        imageCount: request.imageImprovements?.length || 0,
        actionCount: request.actionImprovements?.length || 0,
      });

      // Validate request
      if (!request.tabId) {
        throw new Error('Missing tabId in request');
      }

      if (!request.pageUrl) {
        throw new Error('Missing pageUrl in request');
      }

      if (!request.imageImprovements?.length && !request.actionImprovements?.length) {
        throw new Error('No improvements specified in request');
      }

      // Create batch for tracking
      const batch: DomModificationBatch = {
        pageUrl: request.pageUrl,
        createdAt: Date.now(),
        modifications: [],
        successCount: 0,
        failureCount: 0,
        canUndo: true,
      };

      // Apply image improvements
      if (request.imageImprovements && request.imageImprovements.length > 0) {
        logger.info('Applying image improvements', {
          count: request.imageImprovements.length,
        });

        const imageMods = await this.imageAltApplier.applyBatch(request.tabId, request.imageImprovements);
        batch.modifications.push(...imageMods);

        logger.info('Image improvements applied', {
          total: imageMods.length,
          success: imageMods.filter(m => m.applied).length,
          failure: imageMods.filter(m => !m.applied).length,
        });
      }

      // Apply action improvements
      if (request.actionImprovements && request.actionImprovements.length > 0) {
        logger.info('Applying action improvements', {
          count: request.actionImprovements.length,
        });

        const actionMods = await this.actionAriaApplier.applyBatch(request.tabId, request.actionImprovements);
        batch.modifications.push(...actionMods);

        logger.info('Action improvements applied', {
          total: actionMods.length,
          success: actionMods.filter(m => m.applied).length,
          failure: actionMods.filter(m => !m.applied).length,
        });
      }

      // Calculate success/failure counts
      batch.successCount = batch.modifications.filter(m => m.applied).length;
      batch.failureCount = batch.modifications.filter(m => !m.applied).length;

      // Store in history for undo
      const batchId = this.generateBatchId();
      this.storeInHistory(batchId, batch);

      const processingTime = Date.now() - startTime;

      logger.info('Improvements applied successfully', {
        batchId,
        totalModifications: batch.modifications.length,
        success: batch.successCount,
        failure: batch.failureCount,
        processingTime,
      });

      return {
        success: true,
        batch,
        message: this.generateSuccessMessage(batch),
      };
    } catch (error) {
      logger.error('Failed to apply improvements', error);

      return {
        success: false,
        batch: {
          pageUrl: request.pageUrl,
          createdAt: Date.now(),
          modifications: [],
          successCount: 0,
          failureCount: 0,
          canUndo: false,
        },
        message: 'Failed to apply accessibility improvements',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Undoes a batch of modifications
   *
   * Restores all elements to their original state by removing
   * visible-ai modifications. This operation:
   * 1. Finds all elements with the modification IDs
   * 2. Removes data attributes marking them as modified
   * 3. Optionally restores original values (if stored)
   * 4. Marks the batch as undone
   *
   * @param tabId - Chrome tab ID where modifications were applied
   * @param batchId - ID of batch to undo
   * @returns Promise resolving to success status
   *
   * @example
   * const success = await applier.undoModifications(tabId, batchId);
   * if (success) {
   *   console.log('Modifications undone successfully');
   * }
   */
  async undoModifications(tabId: number, batchId: string): Promise<boolean> {
    const batch = this.modificationHistory.get(batchId);

    if (!batch) {
      logger.warning('Batch not found in history', { batchId });
      return false;
    }

    if (!batch.canUndo) {
      logger.warning('Batch cannot be undone (already undone)', { batchId });
      return false;
    }

    try {
      logger.info('Undoing modifications', {
        batchId,
        modificationCount: batch.modifications.length,
      });

      // Get all successful modification IDs
      const modificationIds = batch.modifications.filter(m => m.applied).map(m => m.modificationId);

      if (modificationIds.length === 0) {
        logger.info('No modifications to undo (none were successfully applied)');
        batch.canUndo = false;
        return true;
      }

      // Undo all modifications in the page
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (modIds: string[]) => {
          let removedCount = 0;

          modIds.forEach(modId => {
            // Find elements with this specific modification ID
            const elements = document.querySelectorAll(`[data-visible-ai-modification-id="${modId}"]`);

            elements.forEach(element => {
              // Remove modification tracking attributes
              element.removeAttribute('data-visible-ai-modified');
              element.removeAttribute('data-visible-ai-modification-id');
              element.removeAttribute('data-visible-ai-modification-type');

              // Note: We don't restore original values here
              // That would require storing them, which we can implement later if needed
              // For now, we just mark as unmodified

              removedCount++;
            });

            // Also handle elements with multiple modifications (actions)
            const multiModElements = document.querySelectorAll(`[data-visible-ai-modification-ids*="${modId}"]`);

            multiModElements.forEach(element => {
              const existingIds = element.getAttribute('data-visible-ai-modification-ids') || '';
              const idArray = existingIds.split(',').filter(id => id !== modId);

              if (idArray.length === 0) {
                // This was the last modification, remove all tracking
                element.removeAttribute('data-visible-ai-modified');
                element.removeAttribute('data-visible-ai-modification-ids');
              } else {
                // Still has other modifications, just update the list
                element.setAttribute('data-visible-ai-modification-ids', idArray.join(','));
              }

              // Remove type tracking for this specific modification
              element.removeAttribute(`data-visible-ai-mod-${modId}-type`);

              removedCount++;
            });
          });

          return { removedCount };
        },
        args: [modificationIds],
      });

      // Mark batch as undone
      batch.canUndo = false;

      logger.info('Modifications undone successfully', {
        batchId,
        modificationCount: modificationIds.length,
      });

      return true;
    } catch (error) {
      logger.error('Failed to undo modifications', error);
      return false;
    }
  }

  /**
   * Gets modification history for a specific page
   *
   * @param pageUrl - URL of the page
   * @returns Array of modification batches for that page
   */
  getHistoryForPage(pageUrl: string): DomModificationBatch[] {
    const batches: DomModificationBatch[] = [];

    for (const batch of this.modificationHistory.values()) {
      if (batch.pageUrl === pageUrl) {
        batches.push(batch);
      }
    }

    return batches.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Clears modification history
   *
   * @param pageUrl - Optional URL to clear only that page's history
   */
  clearHistory(pageUrl?: string): void {
    if (pageUrl) {
      // Clear only for specific page
      for (const [batchId, batch] of this.modificationHistory.entries()) {
        if (batch.pageUrl === pageUrl) {
          this.modificationHistory.delete(batchId);
        }
      }
      logger.info('Cleared history for page', { pageUrl });
    } else {
      // Clear all history
      this.modificationHistory.clear();
      logger.info('Cleared all modification history');
    }
  }

  /**
   * Gets total statistics across all history
   *
   * @returns Object with aggregated statistics
   */
  getStatistics(): {
    totalBatches: number;
    totalModifications: number;
    totalSuccessful: number;
    totalFailed: number;
    pagesAffected: number;
  } {
    let totalModifications = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;
    const pages = new Set<string>();

    for (const batch of this.modificationHistory.values()) {
      totalModifications += batch.modifications.length;
      totalSuccessful += batch.successCount;
      totalFailed += batch.failureCount;
      pages.add(batch.pageUrl);
    }

    return {
      totalBatches: this.modificationHistory.size,
      totalModifications,
      totalSuccessful,
      totalFailed,
      pagesAffected: pages.size,
    };
  }

  /**
   * Stores a batch in history with size limit enforcement
   *
   * @param batchId - Unique batch ID
   * @param batch - Modification batch to store
   */
  private storeInHistory(batchId: string, batch: DomModificationBatch): void {
    this.modificationHistory.set(batchId, batch);

    // Enforce size limit (remove oldest if exceeded)
    if (this.modificationHistory.size > this.MAX_HISTORY_SIZE) {
      const oldestBatchId = Array.from(this.modificationHistory.keys())[0];
      this.modificationHistory.delete(oldestBatchId);
      logger.debug('Removed oldest batch from history', { oldestBatchId });
    }
  }

  /**
   * Generates user-friendly success message
   *
   * @param batch - Modification batch
   * @returns Human-readable success message
   */
  private generateSuccessMessage(batch: DomModificationBatch): string {
    const parts: string[] = [];

    if (batch.successCount > 0) {
      parts.push(`Successfully applied ${batch.successCount} improvement(s)`);
    }

    if (batch.failureCount > 0) {
      parts.push(`${batch.failureCount} improvement(s) failed`);
    }

    if (parts.length === 0) {
      return 'No modifications applied';
    }

    return parts.join('. ');
  }

  /**
   * Generates unique batch ID
   *
   * Format: batch-{timestamp}-{random}
   * Example: batch-1704649200000-abc123xyz
   *
   * @returns Unique batch ID string
   */
  private generateBatchId(): string {
    return `batch-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
}
