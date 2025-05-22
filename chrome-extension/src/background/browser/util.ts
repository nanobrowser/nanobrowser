/**
 * Checks if a URL is allowed based on firewall configuration
 * @param url The URL to check
 * @param allowList The allow list
 * @param denyList The deny list
 * @returns True if the URL is allowed, false otherwise
 */
export function isUrlAllowed(url: string, allowList: string[], denyList: string[]): boolean {
  // Normalize and validate input
  const trimmedUrl = url.trim();
  if (trimmedUrl.length === 0) {
    return false;
  }

  const lowerCaseUrl = trimmedUrl.toLowerCase();

  // ALWAYS block dangerous URLs, even if firewall is disabled
  const DANGEROUS_PREFIXES = [
    'chrome-extension://',
    'chrome://',
    'javascript:',
    'data:',
    'file:',
    'vbscript:',
    'ws:',
    'wss:',
  ];

  if (DANGEROUS_PREFIXES.some(prefix => lowerCaseUrl.startsWith(prefix))) {
    return false;
  }

  // If firewall is disabled, allow all other URLs
  if (allowList.length === 0 && denyList.length === 0) {
    return true;
  }

  // Special case: Allow 'about:blank' explicitly
  if (trimmedUrl === 'about:blank') {
    return true;
  }

  try {
    const parsedUrl = new URL(trimmedUrl);

    // 1. Remove protocol prefix for further comparisons
    const urlWithoutProtocol = lowerCaseUrl.replace(/^https?:\/\//, '');

    // 2. First check full URL against deny list
    for (const deniedEntry of denyList) {
      if (urlWithoutProtocol === deniedEntry) {
        return false;
      }
    }

    // 3. Check full URL against allow list
    for (const allowedEntry of allowList) {
      if (urlWithoutProtocol === allowedEntry) {
        return true;
      }
    }

    // 4. Extract domain for domain-based checks
    let domain = parsedUrl.hostname.toLowerCase();

    // Remove port number if present
    const portIndex = domain.indexOf(':');
    if (portIndex > -1) {
      domain = domain.substring(0, portIndex);
    }

    // 5. Check domain against deny list
    for (const deniedEntry of denyList) {
      if (domain === deniedEntry || domain.endsWith(`.${deniedEntry}`)) {
        return false;
      }
    }

    // 6. Check domain against allow list
    for (const allowedEntry of allowList) {
      if (domain === allowedEntry || domain.endsWith(`.${allowedEntry}`)) {
        return true;
      }
    }

    // Default policy
    return allowList.length === 0;
  } catch (error) {
    // Invalid URL format - deny by default
    return false;
  }
}
