// The only entry other code may import. Everything the extension uses from the layer is exported here.
import { Controller } from './core/controller';
import { chromeEpochStore, chromeTabHost } from './host/chrome-host';
import { chromeAttacher } from './host/connection';
import type { UserPrompt } from './core/ports';

export * from './protocol';
export type * from './core/ports';
export { Controller, Session } from './core/controller';
export type { AuditEntry, ControllerHost, SessionConfig } from './core/controller';
export { TabLocks } from './core/lock';
export { applyDiff } from './core/perception/diff';
export { classify, enterSubmits } from './core/interaction/classify';
export type { ConfirmPolicy } from './core/interaction/gate';
export { ProbeClient } from './core/probe-client';
export { cutText, defuse, quote, untrusted } from './core/text';
export type { ContentSource, DefuseOptions } from './core/text';
export { siteOf } from './core/site';
export { PROBE_SOURCE, PROBE_WORLD_NAME } from './probe';
export type { ProbeState } from './probe';
export { isUrlAllowed, isBlockedSite, siteKey } from './core/url-policy';
export type { UrlPolicy } from './core/url-policy';
export { captureTier1 } from './core/perception/capture';
export type { Capture, FrameCapture } from './core/perception/capture';
export { sendRaw, CdpCommandError, CdpTimeoutError, PAGE_SESSION_ALIAS } from './host/cdp-session';
export { chromeAttacher, ChromeTabConnection, isRestrictedUrl } from './host/connection';
export { chromeTabHost, chromeEpochStore } from './host/chrome-host';
export { PuppeteerFrameTopology, listFrames, readFrameTree, checkFrameAccessors } from './host/frame-topology';
export type { FrameInfo, AccessorCheck } from './host/frame-topology';

/** The controller wired to Chrome: chrome.debugger through Puppeteer, chrome.tabs, chrome.storage. */
export function createChromeController(options: { prompt?: UserPrompt } = {}): Promise<Controller> {
  return Controller.create({
    attacher: chromeAttacher,
    tabs: chromeTabHost,
    epochStore: chromeEpochStore,
    prompt: options.prompt,
  });
}
