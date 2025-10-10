import { createLogger } from '../log';
import { getClickableElements } from '../browser/dom/service';
import { DOMElementNode, DOMTextNode } from '../browser/dom/views';
import {
  ActionType,
  type ContextualizedActionInfo,
  type AccessibilityState,
  SemanticArea,
} from '@extension/storage/lib/accessibility/types';

const logger = createLogger('ActionElementExtractor');

/**
 * HTML tags that are natively interactive
 */
const NATIVE_INTERACTIVE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea', 'details', 'summary']);

/**
 * ARIA roles that indicate interactive elements
 */
const INTERACTIVE_ARIA_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
  'combobox',
]);

/**
 * Service responsible for extracting and classifying interactive action elements from the DOM
 */
export class ActionElementExtractor {
  /**
   * Extracts all interactive action elements from the page
   *
   * @param tabId - Chrome tab ID
   * @param url - Page URL
   * @returns Promise resolving to array of action elements with basic info
   */
  async extractActionElements(tabId: number, url: string): Promise<ContextualizedActionInfo[]> {
    try {
      logger.info('Starting action element extraction', { tabId, url });

      // 1. Get complete DOM structure with interactive elements
      const domState = await getClickableElements(tabId, url, false);

      logger.debug('DOM state retrieved', {
        totalElements: domState.selectorMap.size,
      });

      // 2. Filter and classify interactive elements
      const actionElements: DOMElementNode[] = [];

      // Traverse DOM tree to find all interactive elements
      this.collectInteractiveElements(domState.elementTree, actionElements);

      logger.info(`Found ${actionElements.length} interactive elements`);

      // 3. Convert to ContextualizedActionInfo
      const actions = actionElements.map((element, index) => this.createActionInfo(element, index));

      // 4. Filter out hidden/invisible elements (optional - keep for analysis)
      const visibleActions = actions.filter(
        action => action.domContext.isInViewport || action.accessibilityState.isVisible,
      );

      logger.info('Action extraction completed', {
        totalFound: actions.length,
        visible: visibleActions.length,
        hidden: actions.length - visibleActions.length,
      });

      return actions; // Return all for comprehensive analysis
    } catch (error) {
      logger.error('Failed to extract action elements', error);
      return [];
    }
  }

  /**
   * Recursively collects interactive elements from DOM tree
   */
  private collectInteractiveElements(node: DOMElementNode, collector: DOMElementNode[]): void {
    // Check if this element is interactive
    if (this.isInteractiveElement(node)) {
      collector.push(node);
    }

    // Recursively check children
    for (const child of node.children) {
      if (child instanceof DOMElementNode) {
        this.collectInteractiveElements(child, collector);
      }
    }
  }

  /**
   * Determines if a DOM element is interactive
   */
  private isInteractiveElement(element: DOMElementNode): boolean {
    const tagName = element.tagName?.toLowerCase();
    const role = element.attributes['role'];

    // Native interactive elements
    if (tagName && NATIVE_INTERACTIVE_TAGS.has(tagName)) {
      return true;
    }

    // Elements with interactive ARIA roles
    if (role && INTERACTIVE_ARIA_ROLES.has(role)) {
      return true;
    }

    // Elements with click handlers (heuristic)
    if (element.isInteractive) {
      return true;
    }

    // Elements with tabindex (explicitly focusable)
    if (element.attributes['tabindex'] !== undefined) {
      const tabIndex = parseInt(element.attributes['tabindex']);
      if (tabIndex >= 0) {
        return true;
      }
    }

    return false;
  }

  /**
   * Creates ContextualizedActionInfo from DOMElementNode
   */
  private createActionInfo(element: DOMElementNode, index: number): ContextualizedActionInfo {
    const actionType = this.classifyActionType(element);
    const accessibilityState = this.analyzeAccessibilityState(element);

    // Generate unique ID
    const actionId = this.generateActionId(element, index);

    return {
      actionId,
      actionType,
      tagName: element.tagName || 'unknown',
      selector: this.generateSelector(element),
      xpath: element.xpath || '',

      innerHTML: this.extractInnerHTML(element),
      outerHTML: this.extractOuterHTML(element),

      accessibilityState,

      domContext: {
        isInMainContent: false, // Will be enriched by DOMContextEnricher
        isInViewport: element.isInViewport || false,
        isInteractive: element.isInteractive || false,
        parentContext: '',
        semanticArea: SemanticArea.UNKNOWN,
        hierarchyLevel: 0,
        surroundingText: '',
      },

      issues: [], // Will be populated by AccessibilityStateAnalyzer
      improvements: [], // Will be populated by SuggestionEngine
      accessibilityScore: 0, // Will be calculated
    };
  }

  /**
   * Classifies the type of action element
   */
  private classifyActionType(element: DOMElementNode): ActionType {
    const tagName = element.tagName?.toLowerCase();
    const role = element.attributes['role'];

    // Check explicit role first
    if (role) {
      if (role === 'button') return ActionType.BUTTON;
      if (role === 'link') return ActionType.LINK;
      // Add more role mappings as needed
    }

    // Check tag name
    if (tagName === 'button') return ActionType.BUTTON;
    if (tagName === 'a') return ActionType.LINK;
    if (tagName === 'input') return ActionType.INPUT;
    if (tagName === 'select') return ActionType.SELECT;
    if (tagName === 'textarea') return ActionType.TEXTAREA;

    return ActionType.CUSTOM_CONTROL;
  }

  /**
   * Analyzes current accessibility state of element
   */
  private analyzeAccessibilityState(element: DOMElementNode): AccessibilityState {
    const attrs = element.attributes;

    return {
      hasAriaLabel: 'aria-label' in attrs,
      ariaLabel: attrs['aria-label'],

      hasAriaDescribedBy: 'aria-describedby' in attrs,
      ariaDescribedBy: attrs['aria-describedby'],

      hasRole: 'role' in attrs,
      role: attrs['role'],

      hasAriaLabelledBy: 'aria-labelledby' in attrs,
      ariaLabelledBy: attrs['aria-labelledby'],

      hasTextContent: this.hasTextContent(element),
      textContent: this.extractTextContent(element),

      hasTitle: 'title' in attrs,
      title: attrs['title'],

      hasAlt: 'alt' in attrs,
      alt: attrs['alt'],

      // Dynamic states
      ariaExpanded: attrs['aria-expanded'],
      ariaPressed: attrs['aria-pressed'],
      ariaChecked: attrs['aria-checked'],
      ariaSelected: attrs['aria-selected'],
      ariaDisabled: attrs['aria-disabled'],
      ariaHidden: attrs['aria-hidden'],

      // Additional context
      isDisabled: 'disabled' in attrs || attrs['aria-disabled'] === 'true',
      isVisible: element.isVisible || false,
      isFocusable: this.isFocusable(element),
      tabIndex: attrs['tabindex'] ? parseInt(attrs['tabindex']) : undefined,
    };
  }

  /**
   * Checks if element has text content
   */
  private hasTextContent(element: DOMElementNode): boolean {
    const text = this.extractTextContent(element);
    return text.trim().length > 0;
  }

  /**
   * Extracts text content from element and its children recursively
   */
  private extractTextContent(element: DOMElementNode): string {
    const textParts: string[] = [];

    // Check for common text-bearing attributes
    if (element.attributes['value']) {
      textParts.push(element.attributes['value']);
    }

    if (element.attributes['placeholder']) {
      textParts.push(element.attributes['placeholder']);
    }

    // Recursively collect text from children
    this.collectTextFromChildren(element, textParts);

    return textParts.join(' ').trim();
  }

  /**
   * Recursively collects text content from child nodes
   */
  private collectTextFromChildren(node: DOMElementNode, collector: string[]): void {
    for (const child of node.children) {
      if (child instanceof DOMTextNode) {
        const text = child.text?.trim();
        if (text) {
          collector.push(text);
        }
      } else if (child instanceof DOMElementNode) {
        // Skip script and style elements
        const tagName = child.tagName?.toLowerCase();
        if (tagName !== 'script' && tagName !== 'style') {
          this.collectTextFromChildren(child, collector);
        }
      }
    }
  }

  /**
   * Checks if element is focusable
   */
  private isFocusable(element: DOMElementNode): boolean {
    const tagName = element.tagName?.toLowerCase();
    const tabIndex = element.attributes['tabindex'];
    const disabled = element.attributes['disabled'];

    // Disabled elements are not focusable
    if (disabled) return false;

    // Native focusable elements
    if (tagName && ['a', 'button', 'input', 'select', 'textarea'].includes(tagName)) {
      // Links need href to be focusable
      if (tagName === 'a') {
        return 'href' in element.attributes;
      }
      return true;
    }

    // Elements with positive tabindex
    if (tabIndex !== undefined) {
      const tabIndexNum = parseInt(tabIndex);
      return tabIndexNum >= 0;
    }

    return false;
  }

  /**
   * Generates unique ID for action element
   */
  private generateActionId(element: DOMElementNode, index: number): string {
    // Use xpath or combination of attributes for unique ID
    const xpath = element.xpath || '';
    return `action-${index}-${this.simpleHash(xpath)}`;
  }

  /**
   * Simple hash function for ID generation
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Generates CSS selector for element
   */
  private generateSelector(element: DOMElementNode): string {
    const tagName = element.tagName?.toLowerCase() || 'unknown';
    const id = element.attributes['id'];
    const className = element.attributes['class'];

    if (id) {
      return `${tagName}#${id}`;
    }

    if (className) {
      const firstClass = className.split(' ')[0];
      return `${tagName}.${firstClass}`;
    }

    return tagName;
  }

  /**
   * Extracts innerHTML (truncated for performance)
   */
  private extractInnerHTML(element: DOMElementNode): string {
    const textContent = this.extractTextContent(element);
    if (textContent) {
      // Truncate to reasonable length
      return textContent.substring(0, 200);
    }
    return '';
  }

  /**
   * Extracts outerHTML representation
   */
  private extractOuterHTML(element: DOMElementNode): string {
    const tagName = element.tagName || 'unknown';

    // Collect relevant attributes
    const relevantAttrs = ['id', 'class', 'role', 'aria-label', 'aria-labelledby', 'type', 'href'];
    const attrs = relevantAttrs
      .filter(attr => element.attributes[attr])
      .map(attr => `${attr}="${element.attributes[attr]}"`)
      .join(' ');

    const innerText = this.extractTextContent(element);
    const truncatedInner = innerText ? innerText.substring(0, 50) + (innerText.length > 50 ? '...' : '') : '...';

    return `<${tagName}${attrs ? ' ' + attrs : ''}>${truncatedInner}</${tagName}>`;
  }
}
