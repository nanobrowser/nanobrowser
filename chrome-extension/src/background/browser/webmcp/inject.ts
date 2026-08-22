/**
 * Installs the WebMCP bridge into pages.
 *
 * The bridge has to run in the MAIN world at `document_start`, before any page script calls
 * `navigator.modelContext`. That is only reliable through a registered content script, so the
 * bridge is registered dynamically and kept in sync with the user's WebMCP setting - when the
 * feature is off nothing is injected into any page at all.
 */

import { createLogger } from '@src/background/log';
import { WEBMCP_BRIDGE_SCRIPT, WEBMCP_CONTENT_SCRIPT_ID } from './types';

const logger = createLogger('WebMCP');

async function isBridgeRegistered(): Promise<boolean> {
  try {
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [WEBMCP_CONTENT_SCRIPT_ID] });
    return registered.length > 0;
  } catch {
    return false;
  }
}

async function registerBridge(): Promise<void> {
  if (await isBridgeRegistered()) return;

  await chrome.scripting.registerContentScripts([
    {
      id: WEBMCP_CONTENT_SCRIPT_ID,
      js: [WEBMCP_BRIDGE_SCRIPT],
      matches: ['http://*/*', 'https://*/*'],
      runAt: 'document_start',
      world: 'MAIN',
      allFrames: false,
      persistAcrossSessions: true,
    },
  ]);
  logger.info('WebMCP bridge content script registered');
}

async function unregisterBridge(): Promise<void> {
  if (!(await isBridgeRegistered())) return;

  await chrome.scripting.unregisterContentScripts({ ids: [WEBMCP_CONTENT_SCRIPT_ID] });
  logger.info('WebMCP bridge content script unregistered');
}

/**
 * Register or unregister the bridge so it matches the user's setting.
 * Safe to call repeatedly; it is a no-op when already in the requested state.
 */
export async function syncWebMCPBridgeRegistration(enabled: boolean): Promise<void> {
  try {
    if (enabled) {
      await registerBridge();
    } else {
      await unregisterBridge();
    }
  } catch (error) {
    logger.error('Failed to sync WebMCP bridge registration:', error);
  }
}

/**
 * Inject the bridge into a tab that is already open.
 *
 * A registered content script only covers navigations that happen after registration, so a tab
 * loaded before the user enabled WebMCP would otherwise have no bridge until it is reloaded.
 * Late injection cannot observe tools declared before it ran, but it does pick up native
 * implementations and anything the page declares from then on. The bridge itself is idempotent.
 */
export async function injectWebMCPBridge(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [WEBMCP_BRIDGE_SCRIPT],
      world: 'MAIN',
    });
  } catch (error) {
    // The tab may be a restricted page or gone entirely - not worth surfacing.
    logger.debug('Failed to inject WebMCP bridge:', error);
  }
}
