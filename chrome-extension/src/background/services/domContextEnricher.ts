import { createLogger } from '../log';
import { getClickableElements } from '../browser/dom/service';
import { DOMElementNode, DOMTextNode } from '../browser/dom/views';
import type { DOMState } from '../browser/dom/views';
import {
  SemanticArea,
  type DOMContextInfo,
  type ContextualizedImageInfo,
} from '@extension/storage/lib/accessibility/types';

const logger = createLogger('DOMContextEnricher');

/**
 * ImageInfo interface from AccessibilityService
 * TODO: In STEP 5, refactor to use shared types from @extension/storage
 */
interface ImageInfo {
  imageUrl: string;
  currentAlt: string;
  selector?: string;
  isMainContent?: boolean;
  importanceScore?: number;
}

/**
 * Constants for DOM context enrichment
 */
const MAX_PARENT_CHAIN_DEPTH = 6;
const MAX_SURROUNDING_TEXT_LENGTH = 150;

/**
 * Semantic area classification keywords
 */
const SEMANTIC_KEYWORDS = {
  MAIN_CONTENT: ['main', 'article', 'content', 'post', 'entry'],
  HEADER: ['header'],
  NAVIGATION: ['nav'],
  SIDEBAR: ['aside', 'sidebar'],
  FOOTER: ['footer'],
  ADVERTISEMENT: ['ad', 'banner', 'advertisement', 'ad-'],
} as const;

/**
 * Sanitizes a URL for logging by removing query parameters and hash
 *
 * @param url - URL to sanitize
 * @returns Sanitized URL (origin + pathname only)
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
 * Service responsible for enriching image information with DOM structural context
 *
 * This service correlates extracted images with their corresponding DOM elements
 * and provides semantic analysis of their location and context within the page structure.
 */
export class DOMContextEnricher {
  /**
   * Enriches image information with DOM context by analyzing the page structure
   *
   * @param tabId - Chrome tab ID where the images are located
   * @param url - Page URL for DOM state retrieval
   * @param images - Array of basic image information from extraction
   * @returns Promise resolving to images enriched with DOM context
   *
   * @example
   * const enricher = new DOMContextEnricher();
   * const enrichedImages = await enricher.enrichImagesWithDOMContext(
   *   tabId,
   *   'https://example.com',
   *   basicImages
   * );
   */
  async enrichImagesWithDOMContext(
    tabId: number,
    url: string,
    images: ImageInfo[],
  ): Promise<ContextualizedImageInfo[]> {
    try {
      logger.info('Starting DOM context enrichment', {
        tabId,
        url: sanitizeUrlForLogging(url),
        imageCount: images.length,
      });

      // 1. Get complete DOM structure
      const domState = await getClickableElements(tabId, url, false);
      logger.debug('DOM state retrieved', { elementCount: domState.selectorMap.size });

      // 2. Enrich each image with DOM context
      const contextualizedImages = images.map(image => {
        const domElement = this.findDOMElementByImageSrc(image.imageUrl, domState);

        return {
          imageUrl: image.imageUrl,
          currentAlt: image.currentAlt,
          selector: image.selector || '',
          isMainContent: image.isMainContent || false,
          importanceScore: image.importanceScore || 0,
          domContext: {
            isInMainContent: this.isInMainContentArea(domElement),
            isInViewport: domElement?.isInViewport || false,
            isInteractive: domElement?.isInteractive || false,
            parentContext: this.getParentContextChain(domElement),
            semanticArea: this.identifySemanticArea(domElement),
            hierarchyLevel: this.calculateHierarchyLevel(domElement),
            surroundingText: this.extractSurroundingText(domElement),
          },
        };
      });

      logger.info('DOM context enrichment completed', {
        enrichedCount: contextualizedImages.length,
        mainContentCount: contextualizedImages.filter(img => img.domContext.isInMainContent).length,
      });

      return contextualizedImages;
    } catch (error) {
      logger.error('Failed to enrich images with DOM context', error);
      // Return images with empty DOM context on error (graceful degradation)
      return images.map(image => ({
        imageUrl: image.imageUrl,
        currentAlt: image.currentAlt,
        selector: image.selector || '',
        isMainContent: image.isMainContent || false,
        importanceScore: image.importanceScore || 0,
        domContext: this.getEmptyDOMContext(),
      }));
    }
  }

  /**
   * Finds the DOM element corresponding to an image by its source URL
   *
   * @param imageUrl - URL of the image to find
   * @param domState - Complete DOM state from the page
   * @returns The matching DOM element or null if not found
   */
  private findDOMElementByImageSrc(imageUrl: string, domState: DOMState): DOMElementNode | null {
    try {
      // Search through DOM tree for img element with matching src
      const findInTree = (node: DOMElementNode): DOMElementNode | null => {
        // Check if this is an img element with matching src
        if (node.tagName?.toLowerCase() === 'img') {
          const src = node.attributes['src'];
          if (src && (src === imageUrl || imageUrl.includes(src) || src.includes(imageUrl))) {
            return node;
          }
        }

        // Recursively search children
        for (const child of node.children) {
          if (child instanceof DOMElementNode) {
            const found = findInTree(child);
            if (found) return found;
          }
        }

        return null;
      };

      return findInTree(domState.elementTree);
    } catch (error) {
      logger.debug('Error finding DOM element for image', {
        imageUrl: sanitizeUrlForLogging(imageUrl),
        error,
      });
      return null;
    }
  }

  /**
   * Identifies the semantic area of a DOM element
   *
   * Traverses up the DOM tree to find the semantic container (main, article, header, etc.)
   *
   * @param element - DOM element to classify
   * @returns Semantic area classification
   */
  private identifySemanticArea(element: DOMElementNode | null): SemanticArea {
    if (!element) return SemanticArea.UNKNOWN;

    let current: DOMElementNode | null = element;

    while (current) {
      const tagName = current.tagName?.toLowerCase() || '';
      const classList = (current.attributes['class'] || '').toLowerCase();
      const id = (current.attributes['id'] || '').toLowerCase();

      // Check each semantic area using keyword constants
      const identifierString = `${tagName} ${classList} ${id}`;

      // Main content area
      if (
        SEMANTIC_KEYWORDS.MAIN_CONTENT.some(keyword => identifierString.includes(keyword)) ||
        tagName === 'main' ||
        tagName === 'article'
      ) {
        return SemanticArea.MAIN_CONTENT;
      }

      // Header area
      if (SEMANTIC_KEYWORDS.HEADER.some(keyword => identifierString.includes(keyword)) || tagName === 'header') {
        return SemanticArea.HEADER;
      }

      // Navigation area
      if (SEMANTIC_KEYWORDS.NAVIGATION.some(keyword => identifierString.includes(keyword)) || tagName === 'nav') {
        return SemanticArea.NAVIGATION;
      }

      // Sidebar area
      if (SEMANTIC_KEYWORDS.SIDEBAR.some(keyword => identifierString.includes(keyword)) || tagName === 'aside') {
        return SemanticArea.SIDEBAR;
      }

      // Footer area
      if (SEMANTIC_KEYWORDS.FOOTER.some(keyword => identifierString.includes(keyword)) || tagName === 'footer') {
        return SemanticArea.FOOTER;
      }

      // Advertisement area
      if (SEMANTIC_KEYWORDS.ADVERTISEMENT.some(keyword => identifierString.includes(keyword))) {
        return SemanticArea.ADVERTISEMENT;
      }

      // Move up the tree
      current = current.parent;
    }

    return SemanticArea.UNKNOWN;
  }

  /**
   * Checks if an element is within the main content area
   *
   * @param element - DOM element to check
   * @returns True if element is in main content area
   */
  private isInMainContentArea(element: DOMElementNode | null): boolean {
    return this.identifySemanticArea(element) === SemanticArea.MAIN_CONTENT;
  }

  /**
   * Gets the hierarchical parent context chain for an element
   *
   * @param element - DOM element to analyze
   * @returns String representing the parent hierarchy (e.g., "body > main > article > figure")
   */
  private getParentContextChain(element: DOMElementNode | null): string {
    if (!element) return '';

    const chain: string[] = [];
    let current: DOMElementNode | null = element;
    let depth = 0;

    while (current && depth < MAX_PARENT_CHAIN_DEPTH) {
      const tagName = current.tagName?.toLowerCase() || 'unknown';
      const id = current.attributes['id'];
      const className = current.attributes['class'];

      // Build a readable identifier for this element
      let identifier = tagName;
      if (id) {
        identifier += `#${id}`;
      } else if (className) {
        const firstClass = className.split(' ')[0];
        if (firstClass) {
          identifier += `.${firstClass}`;
        }
      }

      chain.unshift(identifier);
      current = current.parent;
      depth++;
    }

    return chain.join(' > ');
  }

  /**
   * Calculates the hierarchy level (depth) of an element in the DOM tree
   *
   * @param element - DOM element to analyze
   * @returns Depth level (0 = root, higher = deeper)
   */
  private calculateHierarchyLevel(element: DOMElementNode | null): number {
    if (!element) return 0;

    let level = 0;
    let current: DOMElementNode | null = element;

    while (current?.parent) {
      level++;
      current = current.parent;
    }

    return level;
  }

  /**
   * Extracts text content surrounding an image element
   *
   * Collects text from sibling elements and parent to provide context
   *
   * @param element - DOM element to extract surrounding text from
   * @returns Surrounding text (up to 150 characters)
   */
  private extractSurroundingText(element: DOMElementNode | null): string {
    if (!element || !element.parent) return '';

    const textNodes: string[] = [];

    try {
      // Collect text from sibling nodes
      const siblings = element.parent.children;
      for (const sibling of siblings) {
        if (sibling instanceof DOMTextNode && sibling.text.trim()) {
          textNodes.push(sibling.text.trim());
        } else if (sibling instanceof DOMElementNode && sibling !== element) {
          // Get text content from element nodes (first level only)
          for (const child of sibling.children) {
            if (child instanceof DOMTextNode && child.text.trim()) {
              textNodes.push(child.text.trim());
            }
          }
        }
      }

      // Collect text from parent's direct text nodes
      if (element.parent.parent) {
        for (const parentSibling of element.parent.parent.children) {
          if (parentSibling instanceof DOMTextNode && parentSibling.text.trim()) {
            textNodes.push(parentSibling.text.trim());
          }
        }
      }

      // Join and limit to max length
      const fullText = textNodes.join(' ').replace(/\s+/g, ' ').trim();
      return fullText.substring(0, MAX_SURROUNDING_TEXT_LENGTH);
    } catch (error) {
      logger.debug('Error extracting surrounding text', { error });
      return '';
    }
  }

  /**
   * Creates an empty DOM context for graceful degradation
   *
   * @returns Empty DOM context info
   */
  private getEmptyDOMContext(): DOMContextInfo {
    return {
      isInMainContent: false,
      isInViewport: false,
      isInteractive: false,
      parentContext: '',
      semanticArea: SemanticArea.UNKNOWN,
      hierarchyLevel: 0,
      surroundingText: '',
    };
  }
}
