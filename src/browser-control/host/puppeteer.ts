// The only module that imports Puppeteer. It connects through ExtensionTransport (chrome.debugger) and
// hands out the page whose frame manager tracks frames, out-of-process iframes included.
import { connect, ExtensionTransport } from 'puppeteer-core/internal/puppeteer-core-browser.js';
import type { KeyInput, PageEvent, ProtocolType } from 'puppeteer-core/internal/puppeteer-core-browser.js';
import type { Browser } from 'puppeteer-core/internal/api/Browser.js';
import type { Frame } from 'puppeteer-core/internal/api/Frame.js';
import type { Page } from 'puppeteer-core/internal/api/Page.js';
import { _keyDefinitions } from 'puppeteer-core/internal/common/USKeyboardLayout.js';

export type { Browser, Frame, KeyInput, Page, PageEvent };

/** Whether Puppeteer's US layout has a key of this name (or for this character). */
export function isKnownKey(key: string): key is KeyInput {
  return Object.prototype.hasOwnProperty.call(_keyDefinitions, key);
}

export interface PuppeteerConnection {
  tabId: number;
  browser: Browser;
  page: Page;
}

export async function connectTab(tabId: number): Promise<PuppeteerConnection> {
  const transport = await ExtensionTransport.connectTab(tabId);
  // The debugger is attached from here on: any failure detaches it again, or the tab could not be attached later.
  let browser: Browser | undefined;
  try {
    browser = await connect({ transport, defaultViewport: null, protocol: 'cdp' as ProtocolType });
    const [page] = await browser.pages();
    if (!page) throw new Error(`No page target for tab ${tabId}`);
    return { tabId, browser, page };
  } catch (error) {
    // Disconnecting closes the transport; without a browser, the transport is closed directly.
    if (browser) await browser.disconnect().catch(() => transport.close());
    else transport.close();
    throw error;
  }
}

export async function disconnectTab(connection: PuppeteerConnection): Promise<void> {
  // Disconnecting closes the transport, which detaches the debugger.
  await connection.browser.disconnect();
}
