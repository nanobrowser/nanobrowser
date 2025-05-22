import type { DOMState } from '../dom/views';
import type { DOMHistoryElement } from '../dom/history/view';

export interface BrowserContextWindowSize {
  width: number;
  height: number;
}

export interface BrowserContextConfig {
  /**
   * Minimum time to wait before getting page state for LLM input
   * @default 0.25
   */
  minimumWaitPageLoadTime: number;

  /**
   * Time to wait for network requests to finish before getting page state.
   * Lower values may result in incomplete page loads.
   * @default 0.5
   */
  waitForNetworkIdlePageLoadTime: number;

  /**
   * Maximum time to wait for page load before proceeding anyway
   * @default 5.0
   */
  maximumWaitPageLoadTime: number;

  /**
   * Time to wait between multiple actions in one step
   * @default 0.5
   */
  waitBetweenActions: number;

  /**
   * Default browser window size
   * @default { width: 1280, height: 1100 }
   */
  browserWindowSize: BrowserContextWindowSize;

  /**
   * Highlight elements in the DOM on the screen
   * @default true
   */
  highlightElements: boolean;

  /**
   * Viewport expansion in pixels. This amount will increase the number of elements
   * which are included in the state what the LLM will see.
   * If set to -1, all elements will be included (this leads to high token usage).
   * If set to 0, only the elements which are visible in the viewport will be included.
   * @default 0
   */
  viewportExpansion: number;

  /**
   * List of allowed domains that can be accessed. If None, all domains are allowed.
   * @default null
   */
  allowedUrls: string[];

  /**
   * List of denied domains that can be accessed. If None, all domains are allowed.
   * @default null
   */
  deniedUrls: string[];

  /**
   * Include dynamic attributes in the CSS selector. If you want to reuse the css_selectors, it might be better to set this to False.
   * @default true
   */
  includeDynamicAttributes: boolean;

  /**
   * Home page url
   * @default 'https://www.google.com'
   */
  homePageUrl: string;
}

export const DEFAULT_BROWSER_CONTEXT_CONFIG: BrowserContextConfig = {
  minimumWaitPageLoadTime: 0.25,
  waitForNetworkIdlePageLoadTime: 0.5,
  maximumWaitPageLoadTime: 5.0,
  waitBetweenActions: 0.5,
  browserWindowSize: { width: 1280, height: 1100 },
  highlightElements: true,
  viewportExpansion: 0,
  allowedUrls: [],
  deniedUrls: [],
  includeDynamicAttributes: true,
  homePageUrl: 'about:blank',
};

export interface PageState extends DOMState {
  tabId: number;
  url: string;
  title: string;
  screenshot: string | null;
  pixelsAbove: number;
  pixelsBelow: number;
}

export interface TabInfo {
  id: number;
  url: string;
  title: string;
}

export interface BrowserState extends PageState {
  tabs: TabInfo[];
  browser_errors: string[];
}

export interface BrowserStateHistory {
  url: string;
  title: string;
  tabs: TabInfo[];
  interactedElements: (DOMHistoryElement | null)[] | null[];
  screenshot: string | null;

  toDict(): {
    tabs: TabInfo[];
    screenshot: string | null;
    interactedElements: (Record<string, unknown> | null)[];
    url: string;
    title: string;
  };
}

export class BrowserError extends Error {
  /**
   * Base class for all browser errors
   */
  constructor(message?: string) {
    super(message);
    this.name = 'BrowserError';
  }
}

export class URLNotAllowedError extends BrowserError {
  /**
   * Error raised when a URL is not allowed
   */
  constructor(message?: string) {
    super(message);
    this.name = 'URLNotAllowedError';
  }
}
