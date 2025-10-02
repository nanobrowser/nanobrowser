/**
 * Recording Listener - Content script to capture DOM interactions
 * This script is injected into web pages during demonstration recording
 * to capture clicks, text inputs, and form submissions.
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
  const INPUT_DEBOUNCE = 500; // ms - delay before recording input to avoid recording every keystroke

  /**
   * Generate XPath for an element
   */
  function getXPath(element) {
    if (!element) return '';

    if (element.id) {
      return `//*[@id="${element.id}"]`;
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
   * Get element attributes
   */
  function getElementAttributes(element) {
    const attrs = {};
    if (element.attributes) {
      for (let i = 0; i < element.attributes.length; i++) {
        const attr = element.attributes[i];
        attrs[attr.name] = attr.value;
      }
    }
    return attrs;
  }

  /**
   * Get text content from element
   */
  function getElementText(element) {
    if (!element) return '';

    // Get text from various sources
    const text =
      element.textContent?.trim() ||
      element.innerText?.trim() ||
      element.value ||
      element.getAttribute('aria-label') ||
      element.getAttribute('placeholder') ||
      element.getAttribute('title') ||
      element.getAttribute('alt') ||
      '';

    return text.slice(0, 200); // Limit length
  }

  /**
   * Send interaction event to background
   */
  function recordInteraction(action, element, extraParams = {}) {
    if (!isRecording) return;

    try {
      const xpath = getXPath(element);
      const attributes = getElementAttributes(element);
      const textContent = getElementText(element);
      const tagName = element.tagName.toLowerCase();

      // Build description
      let description = '';
      switch (action) {
        case 'click':
          description = `Clicked ${tagName}`;
          if (textContent) {
            description += ` "${textContent.slice(0, 50)}"`;
          }
          break;
        case 'input':
          description = `Entered text into ${tagName}`;
          if (attributes.placeholder) {
            description += ` (${attributes.placeholder})`;
          }
          break;
        case 'submit':
          description = `Submitted form`;
          break;
      }

      // Send message to background script
      chrome.runtime
        .sendMessage({
          type: 'recording_interaction',
          data: {
            action,
            parameters: {
              xpath,
              tagName,
              ...extraParams,
            },
            description,
            element: {
              tagName,
              xpath,
              attributes,
              textContent,
            },
            url: window.location.href,
            pageTitle: document.title,
            timestamp: Date.now(),
          },
        })
        .catch(err => {
          // Ignore errors if background is not connected
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

    const element = event.target;
    if (!element) return;

    // Record the click
    recordInteraction('click', element, {
      clientX: event.clientX,
      clientY: event.clientY,
      button: event.button,
    });
  }

  /**
   * Handle input events (debounced to avoid recording every keystroke)
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

    // Debounce: only record after user stops typing
    const elementId = getXPath(element);
    if (lastInputTime[elementId]) {
      clearTimeout(lastInputTime[elementId]);
    }

    lastInputTime[elementId] = setTimeout(() => {
      const value = element.value || element.textContent || '';

      // Don't record empty values or very long values
      if (!value || value.length > 1000) {
        return;
      }

      recordInteraction('input', element, {
        value: value.slice(0, 200), // Limit value length
        inputType: element.type || 'text',
      });

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
