// Wrap everything in an IIFE to avoid global scope pollution
(() => {
    // Only initialize if we haven't already
    if (window.__nanoTabObserver) {
        return;
    }

    // Function to generate a fallback ID when tab ID is unavailable
    function generateFallbackId() {
        return `fallback-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    // Function to ensure ID is assigned
    function ensureTabId() {
        if (!document.body.hasAttribute('data-nano-tab-id')) {
            // Get tab ID from chrome runtime
            chrome.runtime.sendMessage({ type: 'GET_TAB_ID' }, (response) => {
                let uniqueId;
                if (response?.tabId) {
                    uniqueId = `nano-tab-${response.tabId}`;
                } else {
                    uniqueId = generateFallbackId();
                    console.warn('Using fallback ID: Tab ID was unavailable');
                }
                document.body.setAttribute('data-nano-tab-id', uniqueId);
            });
        }
        return document.body.getAttribute('data-nano-tab-id');
    }

    // Run immediately when script loads
    ensureTabId();

    // Create observer and store it in a window property to prevent duplicate initialization
    window.__nanoTabObserver = new MutationObserver(ensureTabId);
    window.__nanoTabObserver.observe(document.body, {
        attributes: true
    });
})();