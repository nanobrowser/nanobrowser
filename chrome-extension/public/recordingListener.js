/**
 * Recording Listener - Content script to capture DOM interactions
 * Enhanced to capture semantic information for procedural memory
 */

(() => {
  // Avoid re-injection
  if (window.__NANOBROWSER_RECORDING_LISTENER__) {
    return;
  }
  window.__NANOBROWSER_RECORDING_LISTENER__ = true;

  console.log('[Recording Listener] Loaded');

  let isRecording = false;
  let lastInputTime = {};
  let lastInputValues = {}; // Track last recorded value to avoid duplicates
  const INPUT_DEBOUNCE = 500;

  /**
   * Find the nearest semantic parent element (button, link, input, etc.)
   */
  function findSemanticElement(element) {
    const semanticTags = ['button', 'a', 'input', 'textarea', 'select'];
    const semanticRoles = ['button', 'link', 'menuitem', 'tab', 'option', 'textbox'];

    let current = element;
    let depth = 0;
    const maxDepth = 5; // Don't traverse too far up

    while (current && depth < maxDepth) {
      const tagName = current.tagName?.toLowerCase();
      const role = current.getAttribute('role');

      // Check if this is a semantic element
      if (semanticTags.includes(tagName) || semanticRoles.includes(role)) {
        return current;
      }

      // Check for clickable indicators
      if (
        current.onclick ||
        current.getAttribute('onclick') ||
        current.style?.cursor === 'pointer' ||
        role === 'button'
      ) {
        return current;
      }

      current = current.parentElement;
      depth++;
    }

    return element; // Return original if no semantic parent found
  }

  /**
   * Get semantic label for an element
   */
  function getSemanticLabel(element) {
    // Priority order for getting meaningful labels
    const sources = [
      element.getAttribute('aria-label'),
      element.getAttribute('aria-labelledby') &&
        document.getElementById(element.getAttribute('aria-labelledby'))?.textContent,
      element.getAttribute('title'),
      element.getAttribute('placeholder'),
      element.getAttribute('name'),
      element.getAttribute('data-label'),
      element.textContent?.trim(),
      element.value,
      element.getAttribute('alt'),
    ];

    for (const source of sources) {
      if (source && typeof source === 'string' && source.trim().length > 0) {
        return source.trim().slice(0, 100);
      }
    }

    return '';
  }

  /**
   * Get field label for input elements
   */
  function getInputLabel(element) {
    // Check for associated label
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      if (label?.textContent) {
        return label.textContent.trim();
      }
    }

    // Check for wrapping label
    const parentLabel = element.closest('label');
    if (parentLabel?.textContent) {
      return parentLabel.textContent.trim();
    }

    // Check for aria-label or placeholder
    return getSemanticLabel(element);
  }

  /**
   * Extract semantic role/purpose from element
   */
  function getElementRole(element) {
    const role = element.getAttribute('role');
    if (role) return role;

    const tagName = element.tagName.toLowerCase();

    // Map common tags to roles
    const roleMap = {
      button: 'button',
      a: 'link',
      input: 'input',
      textarea: 'input',
      select: 'select',
      form: 'form',
    };

    return roleMap[tagName] || tagName;
  }

  /**
   * Generate XPath for an element (improved)
   */
  function getXPath(element) {
    if (!element) return '';

    // Prefer ID if available
    if (element.id) {
      return `//*[@id="${element.id}"]`;
    }

    // Try to use data attributes for more stable paths
    if (element.getAttribute('data-testid')) {
      return `//*[@data-testid="${element.getAttribute('data-testid')}"]`;
    }
    if (element.getAttribute('data-id')) {
      return `//*[@data-id="${element.getAttribute('data-id')}"]`;
    }

    const parts = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 0;
      let sibling = current.previousSibling;

      while (sibling) {
        if (sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === current.tagName) {
          index++;
        }
        sibling = sibling.previousSibling;
      }

      const tagName = current.tagName.toLowerCase();
      const part = index > 0 ? `${tagName}[${index + 1}]` : tagName;
      parts.unshift(part);

      current = current.parentNode;
    }

    return parts.length ? `/${parts.join('/')}` : '';
  }

  /**
   * Get element attributes (filtered for relevant ones)
   */
  function getElementAttributes(element) {
    const attrs = {};
    const relevantAttrs = [
      'id',
      'name',
      'class',
      'type',
      'role',
      'aria-label',
      'placeholder',
      'title',
      'data-testid',
      'data-id',
      'data-label',
      'href',
      'value',
    ];

    if (element.attributes) {
      for (let i = 0; i < element.attributes.length; i++) {
        const attr = element.attributes[i];
        // Only include relevant attributes
        if (relevantAttrs.includes(attr.name) || attr.name.startsWith('data-')) {
          attrs[attr.name] = attr.value;
        }
      }
    }
    return attrs;
  }

  /**
   * Generate semantic description for the action
   */
  function generateDescription(action, element, semanticLabel, role, extraParams = {}) {
    let description = '';

    switch (action) {
      case 'click': {
        if (role === 'button' || role === 'link') {
          if (semanticLabel) {
            description = `Clicked ${role} "${semanticLabel}"`;
          } else {
            const tagName = element.tagName.toLowerCase();
            description = `Clicked ${tagName}`;
          }
        } else if (role === 'option' || role === 'menuitem') {
          description = `Selected "${semanticLabel || 'option'}"`;
        } else {
          description = semanticLabel ? `Clicked "${semanticLabel}"` : `Clicked ${element.tagName.toLowerCase()}`;
        }
        break;
      }

      case 'input': {
        const label = extraParams.fieldLabel || semanticLabel;
        const value = extraParams.value || '';

        if (label) {
          description = `Entered "${value}" in "${label}" field`;
        } else {
          description = `Entered text: "${value}"`;
        }
        break;
      }

      case 'submit': {
        description = semanticLabel ? `Submitted form "${semanticLabel}"` : 'Submitted form';
        break;
      }

      default:
        description = `Performed ${action}`;
    }

    return description;
  }

  /**
   * Send interaction event to background
   */
  function recordInteraction(action, element, extraParams = {}) {
    if (!isRecording) return;

    try {
      const xpath = getXPath(element);
      const attributes = getElementAttributes(element);
      const semanticLabel = getSemanticLabel(element);
      const role = getElementRole(element);

      // Generate semantic description
      const description = generateDescription(action, element, semanticLabel, role, extraParams);

      // Build semantic metadata
      const semanticData = {
        role,
        label: semanticLabel,
        interactionType: action,
      };

      // Add field-specific metadata for inputs
      if (action === 'input') {
        semanticData.fieldName = attributes.name || attributes.id || semanticLabel;
        semanticData.fieldLabel = extraParams.fieldLabel;
        semanticData.inputType = extraParams.inputType;
      }

      // Send message to background script
      chrome.runtime
        .sendMessage({
          type: 'recording_interaction',
          data: {
            action,
            parameters: {
              xpath,
              tagName: element.tagName.toLowerCase(),
              ...extraParams,
            },
            description,
            element: {
              tagName: element.tagName.toLowerCase(),
              xpath,
              attributes,
              textContent: semanticLabel,
              semantic: semanticData, // Add semantic metadata
            },
            url: window.location.href,
            pageTitle: document.title,
            timestamp: Date.now(),
          },
        })
        .catch(err => {
          console.debug('[Recording Listener] Failed to send message:', err);
        });
    } catch (error) {
      console.error('[Recording Listener] Error recording interaction:', error);
    }
  }

  /**
   * Handle click events
   */
  function handleClick(event) {
    if (!isRecording) return;

    // Find the semantic element (traverse up from clicked element)
    const semanticElement = findSemanticElement(event.target);
    if (!semanticElement) return;

    // Skip if we're clicking on an input (handled by input events)
    const tagName = semanticElement.tagName.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea') {
      return;
    }

    // Record the click with semantic element
    recordInteraction('click', semanticElement, {
      clientX: event.clientX,
      clientY: event.clientY,
      button: event.button,
    });
  }

  /**
   * Handle input events (debounced)
   */
  function handleInput(event) {
    if (!isRecording) return;

    const element = event.target;
    if (!element) return;

    // Only record input/textarea/contenteditable elements
    const tagName = element.tagName.toLowerCase();
    const isEditable = element.isContentEditable;
    if (tagName !== 'input' && tagName !== 'textarea' && !isEditable) {
      return;
    }

    // Get the current value
    const currentValue = element.value || element.textContent || '';

    // Debounce: only record after user stops typing
    const elementId = getXPath(element);
    if (lastInputTime[elementId]) {
      clearTimeout(lastInputTime[elementId]);
    }

    lastInputTime[elementId] = setTimeout(() => {
      const value = element.value || element.textContent || '';

      // Don't record if empty or unchanged
      if (!value || value.length > 1000) {
        delete lastInputTime[elementId];
        return;
      }

      // Don't record if value hasn't changed since last recording
      if (lastInputValues[elementId] === value) {
        delete lastInputTime[elementId];
        return;
      }

      // Get field label for better description
      const fieldLabel = getInputLabel(element);

      recordInteraction('input', element, {
        value: value.slice(0, 200),
        inputType: element.type || 'text',
        fieldLabel,
      });

      // Remember this value to avoid duplicates
      lastInputValues[elementId] = value;
      delete lastInputTime[elementId];
    }, INPUT_DEBOUNCE);
  }

  /**
   * Handle form submission
   */
  function handleSubmit(event) {
    if (!isRecording) return;

    const form = event.target;
    if (!form || form.tagName.toLowerCase() !== 'form') return;

    // Record form submission
    recordInteraction('submit', form, {
      action: form.action,
      method: form.method,
    });
  }

  /**
   * Start recording
   */
  function startRecording() {
    if (isRecording) return;

    console.log('[Recording Listener] Starting to capture interactions');
    isRecording = true;
    lastInputValues = {}; // Reset

    // Attach event listeners
    document.addEventListener('click', handleClick, true);
    document.addEventListener('input', handleInput, true);
    document.addEventListener('submit', handleSubmit, true);
  }

  /**
   * Stop recording
   */
  function stopRecording() {
    if (!isRecording) return;

    console.log('[Recording Listener] Stopping interaction capture');
    isRecording = false;

    // Remove event listeners
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('input', handleInput, true);
    document.removeEventListener('submit', handleSubmit, true);

    // Clear any pending debounced inputs
    for (const timeoutId of Object.values(lastInputTime)) {
      clearTimeout(timeoutId);
    }
    lastInputTime = {};
    lastInputValues = {};
  }

  /**
   * Listen for messages from background script
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'start_recording_listener') {
      startRecording();
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'stop_recording_listener') {
      stopRecording();
      sendResponse({ success: true });
      return true;
    }
  });

  // Notify background that listener is ready
  chrome.runtime
    .sendMessage({
      type: 'recording_listener_ready',
    })
    .catch(() => {
      // Ignore if background is not ready
    });
})();
