// The host interfaces the core works through. Core code never imports Puppeteer or chrome.*; host/ implements these for
// the Chrome extension, and unit tests implement them with recorded payloads.

/** A CDP session: undefined is the tab's root session. */
export type SessionId = string | undefined;

export interface CdpPort {
  readonly tabId: number;
  /** Rejects with LayerError DEBUGGER_DETACHED once the tab is detached, and with CdpTimeoutError on timeout. */
  send<T = unknown>(sessionId: SessionId, method: string, params?: object, timeoutMs?: number): Promise<T>;
  /** Subscribes to an event from every session of the tab, or with `only` from one session. */
  on(
    method: string,
    handler: (params: unknown, sessionId: SessionId) => void,
    only?: { sessionId: SessionId },
  ): () => void;
}

export interface FrameRecord {
  frameId: string;
  parentFrameId: string | undefined;
  sessionId: SessionId;
  /** Document epoch; a new document in the frame has a new loaderId. */
  loaderId: string;
  url: string;
  depth: number;
  /** Chrome's ad-frame classification, when it reports one. */
  adFrame: boolean;
}

export type FrameEvent =
  | { type: 'attached'; frameId: string; parentFrameId: string | undefined }
  | { type: 'navigated'; frameId: string; url: string }
  | { type: 'detached'; frameId: string };

/** FrameTopology: frames as plain values, read from Puppeteer's frame manager. */
export interface TopologyPort {
  mainFrameId(): string;
  /** Frames in tree order with current loader IDs. */
  frames(): Promise<FrameRecord[]>;
  onFrameEvent(handler: (event: FrameEvent) => void): () => void;
}

export interface ScreenshotOptions {
  fullPage?: boolean;
  /** Page CSS pixels. */
  clip?: { x: number; y: number; width: number; height: number };
}

/** The jobs Puppeteer keeps besides frames: keyboard, navigation with load waits, screenshots. */
export interface PagePort {
  screenshot(options: ScreenshotOptions): Promise<{ base64: string; width: number; height: number }>;
  /** A chord as it is pressed: modifiers mapped (ControlOrMeta) and checked, then the key; unknown keys throw. */
  chord(keys: string): { modifiers: string[]; key: string };
  /** One key event each, so the controller can check between them and stop after a dialog. */
  keyDown(key: string): Promise<void>;
  keyUp(key: string): Promise<void>;
  /** Whether typing this character presses a key (the keyboard layout knows it) rather than inserting text. */
  isKey(char: string): boolean;
  /** Inserts a character the layout has no key for, as typing does. */
  insertCharacter(char: string): Promise<void>;
  goto(url: string, timeoutMs: number): Promise<void>;
  goBack(timeoutMs: number): Promise<void>;
  goForward(timeoutMs: number): Promise<void>;
  reload(timeoutMs: number): Promise<void>;
}

export interface DetachInfo {
  reason: string;
}

/** One attached tab. */
export interface TabAttachment {
  readonly tabId: number;
  readonly cdp: CdpPort;
  readonly topology: TopologyPort;
  readonly page: PagePort;
  /** Set once the debugger has detached; every later command fails with DEBUGGER_DETACHED. */
  readonly detached: DetachInfo | null;
  onDetach(handler: (info: DetachInfo) => void): () => void;
  /** Detaches the debugger. */
  close(): Promise<void>;
}

export interface Attacher {
  /** Attaches to the tab. Fails with PAGE_NOT_SUPPORTED for pages the debugger cannot attach to. */
  attach(tabId: number): Promise<TabAttachment>;
}

export interface HostTab {
  tabId: number;
  windowId: number;
  url: string;
  title: string;
  active: boolean;
  openerTabId?: number;
  status: 'loading' | 'complete' | 'unloaded';
}

/** chrome.tabs behind a small interface. */
export interface TabHost {
  get(tabId: number): Promise<HostTab | null>;
  list(): Promise<HostTab[]>;
  open(url: string, options?: { active?: boolean; openerTabId?: number }): Promise<HostTab>;
  /**
   * Loads a URL in the tab through chrome.tabs, without the debugger, and resolves once the load has finished.
   * `navigate` uses it to leave a page the debugger cannot attach to.
   */
  load?(tabId: number, url: string, timeoutMs: number): Promise<void>;
  /** Makes the tab the visible tab of its window. It never focuses the window. */
  activate(tabId: number): Promise<void>;
  /** While a session holds a tab, Chrome's Memory Saver must not discard it. */
  setDiscardable?(tabId: number, discardable: boolean): Promise<void>;
  close(tabId: number): Promise<void>;
  onRemoved(handler: (tabId: number) => void): () => void;
  onCreated(handler: (tab: HostTab) => void): () => void;
  /** A tab opened by a page (window.open, target=_blank), with the URL it is about to load (chrome.webNavigation). */
  onNavigationTarget(handler: (event: { sourceTabId: number; tabId: number; url: string }) => void): () => void;
}

/** A sensitive action waiting for the user. */
export interface ConfirmRequest {
  id: string;
  tabId: number;
  /** 'action' when the confirmation policy is 'always' and the action is not submit, pay or delete. */
  category: 'submit' | 'pay' | 'delete' | 'grant' | 'upload' | 'script' | 'action';
  action: string;
  /** For example 'button "Delete" in row "INV-1042 Acme Corp"'. */
  target: string;
  origin: string;
  /** The tab's site (`siteOf`), which the request is charged to. */
  site: string;
  /** The host of the frame the target is in, when it differs from the site. */
  frameHost?: string;
  /** Where the action sends the page (a link, a form's address), when that host differs from the site. */
  destinationHost?: string;
  intent?: string;
  /** Why it was classified so. */
  reason: string;
  /**
   * "Always allow on this site" may be offered: under a host write policy, for every write unless the site is set to
   * Ask; otherwise for submit only.
   */
  canRemember: boolean;
}

/** A write the gate classified, put to the host's policy. */
export interface WriteQuestion {
  category: 'submit' | 'delete' | 'upload';
  site: string;
  tabId: number;
}

/**
 * The host's answer: run it (by the site's Allow rule or by Auto mode), or ask the user. `canRemember` is false on a
 * site set to Ask, whose card has no "Always allow".
 */
export interface WriteDecision {
  decision: 'run' | 'ask';
  by?: 'site-rule' | 'auto';
  canRemember: boolean;
}

export type ConfirmAnswer = 'approve' | 'approve-remember' | 'decline';

/** A step handed to the user. */
export interface AskRequest {
  id: string;
  tabId: number;
  kind: 'takeover' | 'input';
  message: string;
  origin: string;
}

export type AskAnswer = { outcome: 'continue'; data?: string } | { outcome: 'cancel' };

/**
 * The person: the side panel in the extension, scripted answers in tests. When `signal` aborts (the
 * wait ended, or the call was cancelled), the prompt must be withdrawn so a late answer has no effect.
 */
export interface UserPrompt {
  confirm(request: ConfirmRequest, signal: AbortSignal): Promise<ConfirmAnswer>;
  ask(request: AskRequest, signal: AbortSignal): Promise<AskAnswer>;
}

/** Persistent storage for the ref epoch counter. */
export interface EpochStore {
  /** Reads the last reserved epoch number, or null when none was ever stored. */
  read(): Promise<number | null>;
  /** Writes the epoch number; resolves only once the write is confirmed. */
  write(epoch: number): Promise<void>;
}
