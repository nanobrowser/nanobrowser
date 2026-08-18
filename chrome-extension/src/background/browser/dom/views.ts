import type { CoordinateSet, HashedDomElement, ViewportInfo } from './history/view';
import { HistoryTreeProcessor } from './history/service';
import { capTextLength } from '../util';

export const DEFAULT_INCLUDE_ATTRIBUTES = [
  'title',
  'type',
  'checked',
  'name',
  'role',
  'value',
  'placeholder',
  'data-date-format',
  'data-state',
  'alt',
  'aria-checked',
  'aria-label',
  'aria-expanded',
  'href',
];

export abstract class DOMBaseNode {
  isVisible: boolean;
  parent: DOMElementNode | null;

  constructor(isVisible: boolean, parent?: DOMElementNode | null) {
    this.isVisible = isVisible;
    // Use None as default and set parent later to avoid circular reference issues
    this.parent = parent ?? null;
  }
}

export class DOMTextNode extends DOMBaseNode {
  type = 'TEXT_NODE' as const;
  text: string;

  constructor(text: string, isVisible: boolean, parent?: DOMElementNode | null) {
    super(isVisible, parent);
    this.text = text;
  }

  hasParentWithHighlightIndex(): boolean {
    let current = this.parent;
    while (current != null) {
      if (current.highlightIndex !== null) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  isParentInViewport(): boolean {
    if (this.parent === null) {
      return false;
    }
    return this.parent.isInViewport;
  }

  isParentTopElement(): boolean {
    if (this.parent === null) {
      return false;
    }
    return this.parent.isTopElement;
  }
}

export class DOMElementNode extends DOMBaseNode {
  tagName: string | null;
  /**
   * xpath: the xpath of the element from the last root node (shadow root or iframe OR document if no shadow root or iframe).
   * To properly reference the element we need to recursively switch the root node until we find the element (work you way up the tree with `.parent`)
   */
  xpath: string | null;
  attributes: Record<string, string>;
  children: DOMBaseNode[];
  isInteractive: boolean;
  isTopElement: boolean;
  isInViewport: boolean;
  shadowRoot: boolean;
  highlightIndex: number | null;
  viewportCoordinates?: CoordinateSet;
  pageCoordinates?: CoordinateSet;
  viewportInfo?: ViewportInfo;

  /*
	### State injected by the browser context.

	The idea is that the clickable elements are sometimes persistent from the previous page -> tells the model which objects are new/_how_ the state has changed
	*/
  isNew: boolean | null;

  constructor(params: {
    tagName: string | null;
    xpath: string | null;
    attributes: Record<string, string>;
    children: DOMBaseNode[];
    isVisible: boolean;
    isInteractive?: boolean;
    isTopElement?: boolean;
    isInViewport?: boolean;
    shadowRoot?: boolean;
    highlightIndex?: number | null;
    viewportCoordinates?: CoordinateSet;
    pageCoordinates?: CoordinateSet;
    viewportInfo?: ViewportInfo;
    isNew?: boolean | null;
    parent?: DOMElementNode | null;
  }) {
    super(params.isVisible, params.parent);
    this.tagName = params.tagName;
    this.xpath = params.xpath;
    this.attributes = params.attributes;
    this.children = params.children;
    this.isInteractive = params.isInteractive ?? false;
    this.isTopElement = params.isTopElement ?? false;
    this.isInViewport = params.isInViewport ?? false;
    this.shadowRoot = params.shadowRoot ?? false;
    this.highlightIndex = params.highlightIndex ?? null;
    this.viewportCoordinates = params.viewportCoordinates;
    this.pageCoordinates = params.pageCoordinates;
    this.viewportInfo = params.viewportInfo;
    this.isNew = params.isNew ?? null;
  }

  // Cache for the hash value
  private _hashedValue?: HashedDomElement;
  private _hashPromise?: Promise<HashedDomElement>;

  /**
   * Returns a hashed representation of this DOM element
   * Async equivalent of the Python @cached_property hash method
   *
   * @returns {Promise<HashedDomElement>} A promise that resolves to the hashed DOM element
   * @throws {Error} If the hashing operation fails
   */
  async hash(): Promise<HashedDomElement> {
    // If we already have the value, return it immediately
    if (this._hashedValue) {
      return this._hashedValue;
    }

    // If a calculation is in progress, reuse that promise
    if (!this._hashPromise) {
      this._hashPromise = HistoryTreeProcessor.hashDomElement(this)
        .then((result: HashedDomElement) => {
          this._hashedValue = result;
          this._hashPromise = undefined; // Clean up
          return result;
        })
        .catch((error: Error) => {
          // Clear the promise reference to allow retry on next call
          this._hashPromise = undefined;

          // Log the error for debugging
          console.error('Error computing DOM element hash:', error);

          // Create a more descriptive error
          const enhancedError = new Error(
            `Failed to hash DOM element (${this.tagName || 'unknown'}): ${error.message}`,
          );

          // Preserve the original stack trace if possible
          if (error.stack) {
            enhancedError.stack = error.stack;
          }

          // Rethrow to propagate to caller
          throw enhancedError;
        });
    }

    return this._hashPromise;
  }

  /**
   * Clears the cached hash value, forcing recalculation on next hash() call
   */
  clearHashCache(): void {
    this._hashedValue = undefined;
    this._hashPromise = undefined;
  }

  toString(): string {
    const tag = this.tagName ?? 'unknown';
    if (this.highlightIndex !== null) {
      return `<${tag}[index=${this.highlightIndex}]>`;
    }
    if (this.xpath) {
      return `<${tag}[@${this.xpath}]>`;
    }
    return `<${tag}>`;
  }

  getAllTextTillNextClickableElement(maxDepth = -1): string {
    const textParts: string[] = [];

    const collectText = (node: DOMBaseNode, currentDepth: number): void => {
      if (maxDepth !== -1 && currentDepth > maxDepth) {
        return;
      }

      // Skip this branch if we hit a highlighted element (except for the current node)
      if (node instanceof DOMElementNode && node !== this && node.highlightIndex !== null) {
        return;
      }

      if (node instanceof DOMTextNode) {
        textParts.push(node.text);
      } else if (node instanceof DOMElementNode) {
        for (const child of node.children) {
          collectText(child, currentDepth + 1);
        }
      }
    };

    collectText(this, 0);
    return textParts.join('\n').trim();
  }

  clickableElementsToString(includeAttributes: string[] | null = null): string {
    /**
     * Convert the processed DOM content to HTML.
     */
    const formattedText: string[] = [];

    if (!includeAttributes) {
      includeAttributes = DEFAULT_INCLUDE_ATTRIBUTES;
    }

    const processNode = (node: DOMBaseNode, depth: number): void => {
      let nextDepth = depth;
      const depthStr = '\t'.repeat(depth);

      if (node instanceof DOMElementNode) {
        // Add element with highlight_index
        if (node.highlightIndex !== null) {
          nextDepth += 1;

          const text = node.getAllTextTillNextClickableElement();
          let attributesHtmlStr: string | null = null;

          if (includeAttributes) {
            const attributesToInclude: Record<string, string> = {};

            for (const [key, value] of Object.entries(node.attributes)) {
              if (includeAttributes.includes(key) && String(value).trim() !== '') {
                attributesToInclude[key] = String(value).trim();
              }
            }

            // If value of any of the attributes is the same as ANY other value attribute only include the one that appears first in includeAttributes
            // WARNING: heavy vibes, but it seems good enough for saving tokens (it kicks in hard when it's long text)

            // Pre-compute ordered keys that exist in both lists (faster than repeated lookups)
            const orderedKeys = includeAttributes.filter(key => key in attributesToInclude);

            if (orderedKeys.length > 1) {
              // Only process if we have multiple attributes
              const keysToRemove = new Set<string>(); // Use set for O(1) lookups
              const seenValues: Record<string, string> = {}; // value -> first_key_with_this_value

              for (const key of orderedKeys) {
                const value = attributesToInclude[key];
                if (value.length > 5) {
                  // to not remove false, true, etc
                  if (value in seenValues) {
                    // This value was already seen with an earlier key, so remove this key
                    keysToRemove.add(key);
                  } else {
                    // First time seeing this value, record it
                    seenValues[value] = key;
                  }
                }
              }

              // Remove duplicate keys (no need to check existence since we know they exist)
              for (const key of keysToRemove) {
                delete attributesToInclude[key];
              }
            }

            // Easy LLM optimizations
            // if tag == role attribute, don't include it
            if (node.tagName === attributesToInclude.role) {
              delete attributesToInclude.role;
            }

            // Remove attributes that duplicate the node's text content
            const attrsToRemoveIfTextMatches = ['aria-label', 'placeholder', 'title'];
            for (const attr of attrsToRemoveIfTextMatches) {
              if (
                attributesToInclude[attr] &&
                attributesToInclude[attr].trim().toLowerCase() === text.trim().toLowerCase()
              ) {
                delete attributesToInclude[attr];
              }
            }

            if (Object.keys(attributesToInclude).length > 0) {
              // Format as key1='value1' key2='value2'
              attributesHtmlStr = Object.entries(attributesToInclude)
                .map(([key, value]) => `${key}=${capTextLength(value, 15)}`)
                .join(' ');
            }
          }

          // Build the line
          const highlightIndicator = node.isNew ? `*[${node.highlightIndex}]` : `[${node.highlightIndex}]`;

          let line = `${depthStr}${highlightIndicator}<${node.tagName}`;

          if (attributesHtmlStr) {
            line += ` ${attributesHtmlStr}`;
          }

          if (text) {
            // Add space before >text only if there were NO attributes added before
            const trimmedText = text.trim();
            if (!attributesHtmlStr) {
              line += ' ';
            }
            line += `>${trimmedText}`;
          }
          // Add space before /> only if neither attributes NOR text were added
          else if (!attributesHtmlStr) {
            line += ' ';
          }

          // makes sense to have if the website has lots of text -> so the LLM knows which things are part of the same clickable element and which are not
          line += ' />'; // 1 token
          formattedText.push(line);
        }

        // Process children regardless
        for (const child of node.children) {
          processNode(child, nextDepth);
        }
      } else if (node instanceof DOMTextNode) {
        // Add text only if it doesn't have a highlighted parent
        if (node.hasParentWithHighlightIndex()) {
          return;
        }

        if (node.parent && node.parent.isVisible && node.parent.isTopElement) {
          formattedText.push(`${depthStr}${node.text}`);
        }
      }
    };

    processNode(this, 0);
    return formattedText.join('\n');
  }

  getFileUploadElement(checkSiblings = true): DOMElementNode | null {
    // Check if current element is a file input
    if (this.tagName === 'input' && this.attributes?.type === 'file') {
      return this;
    }

    // Check children
    for (const child of this.children) {
      if (child instanceof DOMElementNode) {
        const result = child.getFileUploadElement(false);
        if (result) return result;
      }
    }

    // Check siblings only for the initial call
    if (checkSiblings && this.parent) {
      for (const sibling of this.parent.children) {
        if (sibling !== this && sibling instanceof DOMElementNode) {
          const result = sibling.getFileUploadElement(false);
          if (result) return result;
        }
      }
    }

    return null;
  }

  getEnhancedCssSelector(): string {
    return this.enhancedCssSelectorForElement();
  }

  convertSimpleXPathToCssSelector(xpath: string): string {
    if (!xpath) {
      return '';
    }

    // Remove leading slash if present
    const cleanXpath = xpath.replace(/^\//, '');

    // Split into parts
    const parts = cleanXpath.split('/');
    const cssParts: string[] = [];

    for (const part of parts) {
      if (!part) {
        continue;
      }

      // Handle custom elements with colons by escaping them
      if (part.includes(':') && !part.includes('[')) {
        const basePart = part.replace(/:/g, '\\:');
        cssParts.push(basePart);
        continue;
      }

      // Handle index notation [n]
      if (part.includes('[')) {
        const bracketIndex = part.indexOf('[');
        let basePart = part.substring(0, bracketIndex);

        // Handle custom elements with colons in the base part
        if (basePart.includes(':')) {
          basePart = basePart.replace(/:/g, '\\:');
        }

        const indexPart = part.substring(bracketIndex);

        // Handle multiple indices
        const indices = indexPart
          .split(']')
          .slice(0, -1)
          .map(i => i.replace('[', ''));

        for (const idx of indices) {
          // Handle numeric indices
          if (/^\d+$/.test(idx)) {
            try {
              const index = Number.parseInt(idx, 10) - 1;
              basePart += `:nth-of-type(${index + 1})`;
            } catch (error) {
              // continue
            }
          }
          // Handle last() function
          else if (idx === 'last()') {
            basePart += ':last-of-type';
          }
          // Handle position() functions
          else if (idx.includes('position()')) {
            if (idx.includes('>1')) {
              basePart += ':nth-of-type(n+2)';
            }
          }
        }

        cssParts.push(basePart);
      } else {
        cssParts.push(part);
      }
    }

    const baseSelector = cssParts.join(' > ');
    return baseSelector;
  }

  enhancedCssSelectorForElement(includeDynamicAttributes = true): string {
    try {
      if (!this.xpath) {
        return '';
      }

      // Get base selector from XPath
      let cssSelector = this.convertSimpleXPathToCssSelector(this.xpath);

      // Handle class attributes
      const classValue = this.attributes.class;
      if (classValue && includeDynamicAttributes) {
        // Define a regex pattern for valid class names in CSS
        const validClassNamePattern = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

        // Iterate through the class attribute values
        const classes = classValue.trim().split(/\s+/);
        for (const className of classes) {
          // Skip empty class names
          if (!className.trim()) {
            continue;
          }

          // Check if the class name is valid
          if (validClassNamePattern.test(className)) {
            // Append the valid class name to the CSS selector
            cssSelector += `.${className}`;
          }
        }
      }

      // Expanded set of safe attributes that are stable and useful for selection
      const SAFE_ATTRIBUTES = new Set([
        // Data attributes (if they're stable in your application)
        'id',
        // Standard HTML attributes
        'name',
        'type',
        'placeholder',
        // Accessibility attributes
        'aria-label',
        'aria-labelledby',
        'aria-describedby',
        'role',
        // Common form attributes
        'for',
        'autocomplete',
        'required',
        'readonly',
        // Media attributes
        'alt',
        'title',
        'src',
        // Custom stable attributes
        'href',
        'target',
      ]);

      // Handle other attributes
      if (includeDynamicAttributes) {
        SAFE_ATTRIBUTES.add('data-id');
        SAFE_ATTRIBUTES.add('data-qa');
        SAFE_ATTRIBUTES.add('data-cy');
        SAFE_ATTRIBUTES.add('data-testid');
      }

      // Handle other attributes
      for (const [attribute, value] of Object.entries(this.attributes)) {
        if (attribute === 'class') {
          continue;
        }

        // Skip invalid attribute names
        if (!attribute.trim()) {
          continue;
        }

        if (!SAFE_ATTRIBUTES.has(attribute)) {
          continue;
        }

        // Escape special characters in attribute names
        const safeAttribute = attribute.replace(':', '\\:');

        // Handle different value cases
        if (value === '') {
          cssSelector += `[${safeAttribute}]`;
        } else if (/["'<>`\n\r\t]/.test(value)) {
          // Use contains for values with special characters
          // Regex-substitute any whitespace with a single space, then trim
          const collapsedValue = value.replace(/\s+/g, ' ').trim();
          // Escape embedded double-quotes
          const safeValue = collapsedValue.replace(/"/g, '\\"');
          cssSelector += `[${safeAttribute}*="${safeValue}"]`;
        } else {
          cssSelector += `[${safeAttribute}="${value}"]`;
        }
      }

      return cssSelector;
    } catch (error) {
      // Fallback to a more basic selector if something goes wrong
      const tagName = this.tagName || '*';
      return `${tagName}[highlightIndex='${this.highlightIndex}']`;
    }
  }
}

export interface DOMState {
  elementTree: DOMElementNode;
  selectorMap: Map<number, DOMElementNode>;
}

export function domElementNodeToDict(elementTree: DOMBaseNode): unknown {
  function nodeToDict(node: DOMBaseNode): unknown {
    if (node instanceof DOMTextNode) {
      return {
        type: 'text',
        text: node.text,
      };
    }
    if (node instanceof DOMElementNode) {
      return {
        type: 'element',
        tagName: node.tagName,
        attributes: node.attributes,
        highlightIndex: node.highlightIndex,
        children: node.children.map(child => nodeToDict(child)),
      };
    }

    return {};
  }

  return nodeToDict(elementTree);
}

export async function calcBranchPathHashSet(state: DOMState): Promise<Set<string>> {
  const pathHashes = new Set(
    await Promise.all(Array.from(state.selectorMap.values()).map(async value => (await value.hash()).branchPathHash)),
  );
  return pathHashes;
}
