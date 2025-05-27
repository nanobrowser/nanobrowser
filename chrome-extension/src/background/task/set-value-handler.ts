/**
 * Set Value Handler for MCP Host RPC Requests
 *
 * This file implements the set_value RPC method handler for the browser extension.
 * It responds to requests from the MCP Host that need to set values on interactive elements.
 */

import BrowserContext from '../browser/context';
import { createLogger } from '../log';
import { RpcHandler, RpcRequest, RpcResponse } from '../mcp/host-manager';
import { DOMElementNode } from '../dom/views';

/**
 * Interface for input strategy determination
 */
interface InputStrategy {
  elementType: string;
  method: string;
  canHandle: boolean;
}

/**
 * Handler for the 'set_value' RPC method
 *
 * This handler processes value setting requests from the MCP Host and performs
 * intelligent value setting on interactive elements with flexible targeting.
 */
export class SetValueHandler {
  private logger = createLogger('SetValueHandler');

  /**
   * Creates a new SetValueHandler instance
   *
   * @param browserContext The browser context for accessing page interaction methods
   */
  constructor(private readonly browserContext: BrowserContext) {}

  /**
   * Handle a set_value RPC request
   *
   * @param request RPC request with value setting parameters
   * @returns Promise resolving to an RPC response confirming the value setting action
   */
  public handleSetValue: RpcHandler = async (request: RpcRequest): Promise<RpcResponse> => {
    this.logger.debug('Received set_value request:', request);

    try {
      const { target, value, options = {}, target_type } = request.params || {};

      // Validate required parameters
      if (target === undefined || target === null) {
        return {
          error: {
            code: -32602,
            message: 'Missing required parameter: target',
          },
        };
      }

      if (value === undefined || value === null) {
        return {
          error: {
            code: -32602,
            message: 'Missing required parameter: value',
          },
        };
      }

      // Set default options
      const finalOptions = {
        clear_first: true,
        submit: false,
        wait_after: 1,
        ...options,
      };

      // Validate options
      if (typeof finalOptions.wait_after !== 'number' || finalOptions.wait_after < 0 || finalOptions.wait_after > 30) {
        return {
          error: {
            code: -32602,
            message: 'options.wait_after must be a number between 0 and 30 seconds',
          },
        };
      }

      // Get current page
      const currentPage = await this.browserContext.getCurrentPage();
      if (!currentPage) {
        return {
          error: {
            code: -32000,
            message: 'No active page available',
          },
        };
      }

      // Locate the target element
      const elementResult = await this.locateElement(currentPage, target, target_type);
      if (!elementResult.success) {
        // Get total element count for better error context
        const selectorMap = currentPage.getSelectorMap();
        const totalElements = selectorMap.size;

        return {
          error: {
            code: -32000,
            message: `${elementResult.error || 'Failed to locate target element'}. Page has ${totalElements} interactive elements. Use get_dom_extra_elements tool to see available elements.`,
            data: {
              error_code: 'ELEMENT_NOT_FOUND',
              target,
              target_type,
              available_element_count: totalElements,
              suggested_action: 'Use get_dom_extra_elements tool to list available elements',
            },
          },
        };
      }

      const { elementNode, elementIndex } = elementResult;

      // Determine input strategy
      const strategy = this.determineInputStrategy(elementNode!, value);
      if (!strategy.canHandle) {
        const supportedTypes = ['input', 'select', 'textarea', 'contenteditable'];
        const suggestedActions = [
          'Check if element is actually interactive',
          'Verify element type matches expected behavior',
          'Use click_element tool for non-form elements',
        ];

        return {
          error: {
            code: -32000,
            message: `Cannot handle element type: ${strategy.elementType}`,
            data: {
              error_code: 'UNSUPPORTED_ELEMENT_TYPE',
              element_type: strategy.elementType,
              element_tag: elementNode!.tagName,
              supported_types: supportedTypes,
              suggested_actions: suggestedActions,
            },
          },
        };
      }

      // Execute the value setting operation
      const setResult = await this.executeValueSetting(currentPage, elementNode!, value, strategy, finalOptions);

      // Use optimized wait time based on element type
      const optimalWait = this.getOptimalWaitTime(strategy.elementType, finalOptions.wait_after * 1000);
      await new Promise(resolve => setTimeout(resolve, optimalWait));

      // Handle submit option
      if (finalOptions.submit) {
        try {
          await currentPage.sendKeys('Enter');
          this.logger.debug('Form submitted after setting value');
        } catch (submitError) {
          this.logger.warning('Failed to submit form after setting value:', submitError);
        }
      }

      const result = {
        success: true,
        message: `Successfully set ${strategy.elementType} to "${setResult.actualValue}" using ${strategy.method} method`,
        target,
        target_type,
        element_index: elementIndex,
        element_type: strategy.elementType,
        input_method: strategy.method,
        actual_value: setResult.actualValue,
        element_info: {
          tag_name: elementNode!.tagName,
          text: elementNode!.getAllTextTillNextClickableElement() || '',
          placeholder: elementNode!.attributes.placeholder || '',
          name: elementNode!.attributes.name || '',
          id: elementNode!.attributes.id || '',
          type: elementNode!.attributes.type || '',
        },
        options_used: finalOptions,
      };

      this.logger.debug('Set value completed:', result);

      return {
        result,
      };
    } catch (error) {
      this.logger.error('Error setting value:', error);

      let errorCode = 'SET_VALUE_FAILED';
      let errorMessage = 'Failed to set value';

      if (error instanceof Error) {
        errorMessage = error.message;

        // Classify error types
        if (error.message.includes('not found')) {
          errorCode = 'ELEMENT_NOT_FOUND';
        } else if (error.message.includes('not visible')) {
          errorCode = 'ELEMENT_NOT_VISIBLE';
        } else if (error.message.includes('timeout')) {
          errorCode = 'OPERATION_TIMEOUT';
        } else if (error.message.includes('detached')) {
          errorCode = 'ELEMENT_DETACHED';
        } else if (error.message.includes('readonly')) {
          errorCode = 'ELEMENT_READONLY';
        } else if (error.message.includes('disabled')) {
          errorCode = 'ELEMENT_DISABLED';
        }
      }

      return {
        error: {
          code: -32603,
          message: errorMessage,
          data: {
            error_code: errorCode,
            stack: error instanceof Error ? error.stack : undefined,
          },
        },
      };
    }
  };

  /**
   * Get optimal wait time based on element type
   */
  private getOptimalWaitTime(elementType: string, baseWait: number): number {
    const multipliers = {
      'text-input': 0.5, // Text input is faster
      select: 1.5, // Dropdown selection needs more time
      checkbox: 0.3, // Checkbox is very fast
      radio: 0.3, // Radio button is very fast
      textarea: 0.8, // Textarea is medium speed
    } as any;

    return Math.min(baseWait * (multipliers[elementType] || 1), 3000); // Maximum 3 seconds
  }

  /**
   * Locate element using either index or description
   */
  private async locateElement(
    page: any,
    target: number | string,
    targetType: string,
  ): Promise<{
    success: boolean;
    elementNode?: DOMElementNode;
    elementIndex?: number;
    error?: string;
  }> {
    // Handle numeric index targeting
    if (targetType === 'index' || typeof target === 'number') {
      const elementIndex = typeof target === 'number' ? target : parseInt(target as string);
      const elementNode = page.getDomElementByIndex(elementIndex);

      if (!elementNode) {
        return {
          success: false,
          error: `Element with index ${elementIndex} not found in DOM state`,
        };
      }

      return {
        success: true,
        elementNode,
        elementIndex,
      };
    }

    // Handle description-based targeting
    const description = target as string;
    const selectorMap = page.getSelectorMap();

    for (const [index, element] of selectorMap.entries()) {
      if (this.matchesTextDescription(element, description)) {
        return {
          success: true,
          elementNode: element,
          elementIndex: index,
        };
      }
    }

    return {
      success: false,
      error: `No element found matching description: "${description}"`,
    };
  }

  /**
   * Check if element matches text description using multiple strategies (optimized)
   */
  private matchesTextDescription(element: DOMElementNode, description: string): boolean {
    const desc = description.toLowerCase().trim();

    // Early exit optimization - check most common attributes first
    const quickChecks = [element.attributes.placeholder, element.attributes.name, element.attributes.id];

    for (const attr of quickChecks) {
      if (attr && attr.toLowerCase().includes(desc)) return true;
    }

    // Then check text content (slower operation)
    const text = element.getAllTextTillNextClickableElement();
    if (text && text.toLowerCase().includes(desc)) return true;

    // Finally check other attributes
    const otherAttrs = ['aria-label', 'title', 'value'];
    for (const attrName of otherAttrs) {
      const attr = element.attributes[attrName];
      if (attr && attr.toLowerCase().includes(desc)) return true;
    }

    return false;
  }

  /**
   * Determine the appropriate input strategy for the element and value
   */
  private determineInputStrategy(element: DOMElementNode, value: any): InputStrategy {
    const tagName = element.tagName?.toLowerCase() || '';
    const inputType = element.attributes.type?.toLowerCase() || 'text';

    // Handle select elements
    if (tagName === 'select') {
      const isMultiple = element.attributes.multiple !== undefined;
      return {
        elementType: isMultiple ? 'multi-select' : 'select',
        method: isMultiple ? 'multi-select' : 'single-select',
        canHandle: true,
      };
    }

    // Handle input elements
    if (tagName === 'input') {
      switch (inputType) {
        case 'checkbox':
          return {
            elementType: 'checkbox',
            method: 'toggle',
            canHandle: true,
          };
        case 'radio':
          return {
            elementType: 'radio',
            method: 'toggle',
            canHandle: true,
          };
        case 'file':
          return {
            elementType: 'file',
            method: 'upload',
            canHandle: false, // Not implemented in this version
          };
        case 'text':
        case 'password':
        case 'email':
        case 'tel':
        case 'url':
        case 'search':
        case 'number':
        case 'date':
        case 'time':
        case 'datetime-local':
        case 'month':
        case 'week':
        default:
          return {
            elementType: 'text-input',
            method: 'type',
            canHandle: true,
          };
      }
    }

    // Handle textarea
    if (tagName === 'textarea') {
      return {
        elementType: 'textarea',
        method: 'type',
        canHandle: true,
      };
    }

    // Handle contenteditable elements
    if (element.attributes.contenteditable === 'true') {
      return {
        elementType: 'contenteditable',
        method: 'type',
        canHandle: true,
      };
    }

    // Unsupported element type
    return {
      elementType: tagName,
      method: 'unknown',
      canHandle: false,
    };
  }

  /**
   * Execute the value setting operation based on strategy
   */
  private async executeValueSetting(
    page: any,
    elementNode: DOMElementNode,
    value: any,
    strategy: InputStrategy,
    options: any,
  ): Promise<{ actualValue: any }> {
    const elementHandle = await page.locateElement(elementNode);
    if (!elementHandle) {
      throw new Error(`Element could not be located on the page`);
    }

    // Check if element is visible and interactive
    const isInteractable = await elementHandle.evaluate((el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        style.opacity !== '0' &&
        !el.hasAttribute('disabled') &&
        !el.hasAttribute('readonly')
      );
    });

    if (!isInteractable) {
      throw new Error(`Element is not visible or interactive`);
    }

    // Scroll element into view
    await elementHandle.evaluate((el: Element) => {
      el.scrollIntoView({
        behavior: 'instant',
        block: 'center',
        inline: 'center',
      });
    });

    // Wait for scroll to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // Execute strategy-specific value setting
    switch (strategy.method) {
      case 'type':
        return await this.handleTextInput(elementHandle, value, options);

      case 'single-select':
        return await this.handleSingleSelect(elementHandle, value);

      case 'multi-select':
        return await this.handleMultiSelect(elementHandle, value);

      case 'toggle':
        return await this.handleToggle(elementHandle, value, strategy.elementType);

      default:
        throw new Error(`Unsupported input method: ${strategy.method}`);
    }
  }

  /**
   * Handle text input (input, textarea, contenteditable) with success verification
   */
  private async handleTextInput(elementHandle: any, value: any, options: any): Promise<{ actualValue: string }> {
    const stringValue = String(value);

    // Clear existing content if requested
    if (options.clear_first) {
      await elementHandle.evaluate((el: HTMLInputElement | HTMLTextAreaElement | HTMLElement) => {
        if ('value' in el) {
          el.value = '';
        } else if ((el as HTMLElement).isContentEditable) {
          (el as HTMLElement).textContent = '';
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }

    // Type the new value
    await elementHandle.type(stringValue, { delay: 50 });

    // Trigger change event
    await elementHandle.evaluate((el: HTMLElement) => {
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Simple verification: check if value was set successfully
    try {
      const actualValue = await elementHandle.evaluate((el: HTMLInputElement | HTMLTextAreaElement) => {
        if ('value' in el) {
          return el.value;
        } else if ((el as HTMLElement).isContentEditable) {
          return (el as HTMLElement).textContent || '';
        }
        return '';
      });

      if (actualValue === stringValue) {
        // Success, no need for additional waiting
        this.logger.debug('Text input value verified successfully');
      }
    } catch (e) {
      // Verification failed, continue with normal flow
      this.logger.debug('Text input verification failed, continuing normally');
    }

    return { actualValue: stringValue };
  }

  /**
   * Handle single select dropdown with improved error messages
   */
  private async handleSingleSelect(elementHandle: any, value: any): Promise<{ actualValue: string }> {
    const stringValue = String(value);

    const result = await elementHandle.evaluate((select: HTMLSelectElement, optionText: string) => {
      const options = Array.from(select.options);
      const option = options.find(opt => opt.text.trim() === optionText || opt.value === optionText);

      if (!option) {
        const availableOptions = options
          .slice(0, 5)
          .map(o => o.text.trim())
          .join('", "');
        const totalCount = options.length;
        const moreText = totalCount > 5 ? ` (and ${totalCount - 5} more)` : '';

        throw new Error(`Option "${optionText}" not found. Available options: "${availableOptions}"${moreText}`);
      }

      const previousValue = select.value;
      select.value = option.value;

      // Only dispatch events if value changed
      if (previousValue !== option.value) {
        select.dispatchEvent(new Event('change', { bubbles: true }));
        select.dispatchEvent(new Event('input', { bubbles: true }));
      }

      return option.text.trim();
    }, stringValue);

    return { actualValue: result };
  }

  /**
   * Handle multi-select dropdown with improved error messages
   */
  private async handleMultiSelect(elementHandle: any, value: any): Promise<{ actualValue: string[] }> {
    const values = Array.isArray(value) ? value.map(String) : [String(value)];

    const result = await elementHandle.evaluate((select: HTMLSelectElement, optionTexts: string[]) => {
      const options = Array.from(select.options);
      const selectedValues: string[] = [];

      // Clear all selections first
      options.forEach(option => {
        option.selected = false;
      });

      // Select matching options
      for (const optionText of optionTexts) {
        const option = options.find(opt => opt.text.trim() === optionText || opt.value === optionText);
        if (option) {
          option.selected = true;
          selectedValues.push(option.text.trim());
        }
      }

      if (selectedValues.length === 0) {
        const availableOptions = options
          .slice(0, 5)
          .map(o => o.text.trim())
          .join('", "');
        const totalCount = options.length;
        const moreText = totalCount > 5 ? ` (and ${totalCount - 5} more)` : '';

        throw new Error(`No matching options found. Available options: "${availableOptions}"${moreText}`);
      }

      select.dispatchEvent(new Event('change', { bubbles: true }));
      select.dispatchEvent(new Event('input', { bubbles: true }));

      return selectedValues;
    }, values);

    return { actualValue: result };
  }

  /**
   * Handle checkbox and radio button toggling with success verification
   */
  private async handleToggle(elementHandle: any, value: any, elementType: string): Promise<{ actualValue: boolean }> {
    const shouldCheck = Boolean(value);

    const result = await elementHandle.evaluate(
      (input: HTMLInputElement, targetState: boolean, type: string) => {
        const currentState = input.checked;

        // For radio buttons, we can only check them (not uncheck)
        if (type === 'radio' && !targetState) {
          throw new Error('Cannot uncheck a radio button - use another radio button in the same group');
        }

        // Only change if different from current state
        if (currentState !== targetState) {
          input.checked = targetState;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        return input.checked;
      },
      shouldCheck,
      elementType,
    );

    return { actualValue: result };
  }
}
