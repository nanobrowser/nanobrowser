import { DOMElementNode } from '../views';

/**
 * Get all clickable elements hashes in the DOM tree
 */
export async function getClickableElementsHashes(domElement: DOMElementNode): Promise<Set<string>> {
  const clickableElements = getClickableElements(domElement);
  const hashPromises = clickableElements.map(element => hashDomElement(element));
  const hashes = await Promise.all(hashPromises);
  return new Set(hashes);
}

/**
 * Get all clickable elements in the DOM tree
 */
export function getClickableElements(domElement: DOMElementNode): DOMElementNode[] {
  const clickableElements: DOMElementNode[] = [];

  for (const child of domElement.children) {
    if (child instanceof DOMElementNode) {
      if (child.highlightIndex !== null) {
        clickableElements.push(child);
      }

      clickableElements.push(...getClickableElements(child));
    }
  }

  return clickableElements;
}

/**
 * Hash a DOM element for identification
 */
export async function hashDomElement(domElement: DOMElementNode): Promise<string> {
  const parentBranchPath = _getParentBranchPath(domElement);

  // Run all hash operations in parallel
  const [branchPathHash, attributesHash, xpathHash] = await Promise.all([
    _parentBranchPathHash(parentBranchPath),
    _attributesHash(domElement.attributes),
    _xpathHash(domElement.xpath),
    // _textHash(domElement) // Uncomment if needed
  ]);

  return _hashString(`${branchPathHash}-${attributesHash}-${xpathHash}`);
}

/**
 * Get the branch path from parent elements
 */
function _getParentBranchPath(domElement: DOMElementNode): string[] {
  const parents: DOMElementNode[] = [];
  let currentElement: DOMElementNode | null = domElement;

  while (currentElement?.parent !== null) {
    parents.push(currentElement);
    currentElement = currentElement.parent;
  }

  parents.reverse();

  return parents.map(parent => parent.tagName || '');
}

/**
 * Create a hash from the parent branch path
 */
async function _parentBranchPathHash(parentBranchPath: string[]): Promise<string> {
  const parentBranchPathString = parentBranchPath.join('/');
  return createSHA256Hash(parentBranchPathString);
}

/**
 * Create a hash from the element attributes
 */
async function _attributesHash(attributes: Record<string, string>): Promise<string> {
  const attributesString = Object.entries(attributes)
    .map(([key, value]) => `${key}=${value}`)
    .join('');
  return createSHA256Hash(attributesString);
}

/**
 * Create a hash from the element xpath
 */
async function _xpathHash(xpath: string | null): Promise<string> {
  return createSHA256Hash(xpath || '');
}

/**
 * Create a hash from the element text
 * Currently unused but kept for potential future use
 */
/* 
async function _textHash(domElement: DOMElementNode): Promise<string> {
  const textString = domElement.getAllTextTillNextClickableElement();
  return createSHA256Hash(textString);
}
*/

/**
 * Create a SHA-256 hash from a string using Web Crypto API
 */
async function createSHA256Hash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create a hash from a string - synchronous version for combining hashes
 * Used only for the final string combination
 */
function _hashString(string: string): string {
  // Simple hash for combining existing hashes
  // Real hashing is done in createSHA256Hash
  return string;
}

/**
 * ClickableElementProcessor namespace for backward compatibility
 */
export const ClickableElementProcessor = {
  getClickableElementsHashes,
  getClickableElements,
  hashDomElement,
};
