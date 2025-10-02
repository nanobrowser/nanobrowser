import { createLogger } from '../log';
import { SemanticArea, type ContextualizedImageInfo } from '@extension/storage/lib/accessibility/types';

const logger = createLogger('HybridImageScorer');

/**
 * Scoring weight constants for hybrid image scoring algorithm
 */
const SCORING_WEIGHTS = {
  // DOM Context weights
  IS_IN_MAIN_CONTENT: 80,
  IS_IN_VIEWPORT: 30,
  HAS_SURROUNDING_TEXT: 20,
  SURROUNDING_TEXT_MIN_LENGTH: 50,

  // Semantic area penalties
  ADVERTISEMENT_PENALTY: -100,

  // Vision context weights
  VISION_SCORE_MULTIPLIER: 100,
  NOT_RELEVANT_CAP: 50,

  // Filtering thresholds
  MIN_FINAL_SCORE: 0,
  DEFAULT_TOP_IMAGES_LIMIT: 8,
} as const;

/**
 * Service responsible for calculating hybrid scores for images
 *
 * Combines multiple signals to determine final image relevance:
 * 1. Base heuristic importance score (size, position, keywords)
 * 2. DOM structural context (semantic area, viewport visibility)
 * 3. Vision model validation (optional, if available)
 *
 * The scoring algorithm applies configurable weights to each factor
 * to produce a final relevance score for ranking and filtering.
 */
export class HybridImageScorer {
  /**
   * Calculates the final hybrid score for an image
   *
   * Scoring algorithm:
   * - Base: image.importanceScore (from heuristic extraction)
   * - DOM adjustments: +80 main content, +30 viewport, +20 surrounding text, -100 ads
   * - Vision adjustments: +(relevanceScore * 100), capped at 50 if not relevant
   *
   * @param image - Contextualized image with DOM and optional vision context
   * @returns Final score (higher is more relevant)
   *
   * @example
   * const scorer = new HybridImageScorer();
   * const finalScore = scorer.calculateFinalScore(contextualizedImage);
   * // Returns: 250 (base 100 + main content 80 + viewport 30 + vision 40)
   */
  calculateFinalScore(image: ContextualizedImageInfo): number {
    let score = image.importanceScore || 0;

    // Apply DOM context adjustments
    if (image.domContext) {
      // Boost if in main content area
      if (image.domContext.isInMainContent) {
        score += SCORING_WEIGHTS.IS_IN_MAIN_CONTENT;
      }

      // Penalize advertisement images heavily
      if (image.domContext.semanticArea === SemanticArea.ADVERTISEMENT) {
        score += SCORING_WEIGHTS.ADVERTISEMENT_PENALTY;
      }

      // Boost if visible in viewport
      if (image.domContext.isInViewport) {
        score += SCORING_WEIGHTS.IS_IN_VIEWPORT;
      }

      // Boost if has meaningful surrounding text
      if (
        image.domContext.surroundingText &&
        image.domContext.surroundingText.length >= SCORING_WEIGHTS.SURROUNDING_TEXT_MIN_LENGTH
      ) {
        score += SCORING_WEIGHTS.HAS_SURROUNDING_TEXT;
      }
    }

    // Apply vision context adjustments (if available)
    if (image.visionContext) {
      const visionScore = image.visionContext.relevanceScore * SCORING_WEIGHTS.VISION_SCORE_MULTIPLIER;

      // If vision model says image is not relevant, cap the total score
      if (!image.visionContext.isRelevant) {
        score = Math.min(score + visionScore, SCORING_WEIGHTS.NOT_RELEVANT_CAP);
      } else {
        score += visionScore;
      }
    }

    return Math.round(score);
  }

  /**
   * Selects the top N most relevant images based on hybrid scoring
   *
   * Process:
   * 1. Calculate final score for each image
   * 2. Sort by score (descending)
   * 3. Filter out negative scores
   * 4. Take top N images
   *
   * @param images - Array of contextualized images to score
   * @param limit - Maximum number of images to return (default: 8)
   * @returns Top scoring images with finalScore property added
   *
   * @example
   * const scorer = new HybridImageScorer();
   * const topImages = scorer.selectTopImages(contextualizedImages, 5);
   * // Returns: 5 highest scoring images with finalScore property
   */
  selectTopImages(
    images: ContextualizedImageInfo[],
    limit: number = SCORING_WEIGHTS.DEFAULT_TOP_IMAGES_LIMIT,
  ): ContextualizedImageInfo[] {
    logger.info('Starting hybrid image scoring', {
      imageCount: images.length,
      limit,
    });

    // Calculate final scores for all images
    const scoredImages = images.map(image => {
      const finalScore = this.calculateFinalScore(image);

      logger.debug('Image scored', {
        imageUrl: this.sanitizeUrlForLogging(image.imageUrl),
        baseScore: image.importanceScore,
        finalScore,
        isMainContent: image.domContext?.isInMainContent,
        semanticArea: image.domContext?.semanticArea,
        visionRelevant: image.visionContext?.isRelevant,
      });

      return {
        ...image,
        finalScore,
      };
    });

    // Sort by final score (descending) and filter out negative scores
    const filteredImages = scoredImages
      .filter(img => img.finalScore !== undefined && img.finalScore > SCORING_WEIGHTS.MIN_FINAL_SCORE)
      .sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));

    // Take top N images
    const topImages = filteredImages.slice(0, limit);

    logger.info('Hybrid scoring completed', {
      originalCount: images.length,
      scoredCount: scoredImages.length,
      filteredCount: filteredImages.length,
      topImagesCount: topImages.length,
      topScores: topImages.map(img => img.finalScore),
    });

    return topImages;
  }

  /**
   * Sanitizes a URL for logging by removing query parameters and hash
   *
   * @param url - URL to sanitize
   * @returns Sanitized URL (origin + pathname only)
   */
  private sanitizeUrlForLogging(url: string): string {
    try {
      const urlObj = new URL(url);
      return `${urlObj.origin}${urlObj.pathname}`;
    } catch {
      return '[invalid-url]';
    }
  }
}
