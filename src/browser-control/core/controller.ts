// The controller: sessions, tabs, refs and tool dispatch. It runs in the extension's service worker;
// its clients are in-process (the extension's agent, the test panel) and, later, an MCP bridge.
import { isLayerError, LayerError } from '../protocol/errors';
import type { ErrorCode, ProtocolError } from '../protocol/errors';
import { isReadOnly, listTools, toolSpec } from '../protocol/catalogue';
import type { Capability, ToolSpec } from '../protocol/catalogue';
import type { Observe, Target } from '../protocol/schemas';
import { resolveTarget } from './interaction/resolve';
import { waitForActionable } from './interaction/actionability';
import type { ActionReceipt, PageState, PendingModal, Result } from '../protocol/results';
import { TabLocks } from './lock';
import type { Attacher, EpochStore, TabAttachment, TabHost, UserPrompt, WriteDecision, WriteQuestion } from './ports';
import type { ConfirmPolicy } from './interaction/gate';
import { KnownSet, RefRegistry, reserveEpoch } from './refs';
import type { Epoch } from './refs';
import type { CaptureState } from './perception/capture';
import type { Observation } from './perception/observe';
import { NavigationGuard } from './navigation-guard';
import { ProbeClient } from './probe-client';
import { combinePolicies, EMPTY_POLICY, hasLists, isBlockedSite, normalizePolicy } from './url-policy';
import type { UrlPolicy } from './url-policy';
import { defuseQuotes, dialogDetail, errorLine, newNonce, pendingLines, quote, receiptLines, untrusted } from './text';
import type { ContentSource, DefuseOptions } from './text';
import { siteOf } from './site';
import { TOOL_HANDLERS } from './tools';
import { maskSecrets, redactArgs } from './redact';
import { MASK } from './perception/masking';

export interface ControllerHost {
  attacher: Attacher;
  tabs: TabHost;
  epochStore: EpochStore;
  /** The person: the side panel, or scripted answers in tests. Without it, sensitive actions fail with NEEDS_USER. */
  prompt?: UserPrompt;
}

export interface SessionConfig {
  capabilities?: Capability[];
  /** Page state returned with actions when the request does not say. */
  observeDefault?: Observe;
  /** Character budget of an outline. */
  budget?: number;
  /** Navigation policy. Only the user changes it, through the host; there is no protocol call. */
  urlPolicy?: UrlPolicy;
  /** Confirmation policy; 'sensitive' by default. Only the user changes it. */
  confirm?: ConfirmPolicy;
  /** Default: 120 s. */
  confirmTimeoutMs?: number;
  /** Default: 300 s. */
  askTimeoutMs?: number;
  /**
   * The hardened boundary: the host's own labels, defused inside page text and quotes, and chat-template sequences
   * to break (off unless the host gives some). Only the host sets it.
   */
  boundary?: DefuseOptions;
  /**
   * The hand-over policy, set by the host and absent from the protocol: a payment, an access grant, input into a secret
   * field and accepting a page's prompt dialog are refused with USER_STEP, and the `eval` and `devtools` capabilities
   * are refused. The extension's agent sessions set it; the test panel does not.
   */
  handover?: boolean;
  /**
   * The host's policy for writes: for a classified submit or delete, the gate asks it in place of the fixed `sensitive`
   * rule. Set by the extension from the conversation's mode and the site rules.
   */
  decideWrite?: (question: WriteQuestion) => WriteDecision | Promise<WriteDecision>;
  /**
   * Whether a tab the session switches to or opens becomes the visible tab of its window. The host decides: the
   * extension shows it only while the user is on one of the conversation's tabs. Null is a tab about to be opened.
   * Without it, the tab is shown, as the test panel expects.
   */
  reveal?: (tabId: number | null) => boolean | Promise<boolean>;
  /** A tab joined the session: the host places it (its group) and keeps it out of view as it sees fit. */
  onTabJoined?: (tabId: number, how: 'shared' | 'opened' | 'page-opened') => void;
  /**
   * Where `upload` may take files from, set by the host and absent from the protocol: local paths, bytes given with the
   * call, or both (the default). The extension's agent sessions take bytes only, so a model cannot name a file on the
   * user's disk.
   */
  uploadSources?: Array<'paths' | 'attachments'>;
}

export interface AuditEntry {
  at: string;
  sessionId: string;
  tool: string;
  args: unknown;
  ok: boolean;
  error?: ProtocolError;
  receipt?: ActionReceipt;
  tabId?: number;
  ms: number;
}

export interface TabState {
  tabId: number;
  attachment: TabAttachment | null;
  attaching: Promise<TabAttachment> | null;
  capture: CaptureState;
  /** Revision of the last observation. */
  rev: number;
  /** Increases with every dispatched action; a capture taken before it is not reused. */
  actionSeq: number;
  last?: { observation: Observation; actionSeq: number; at: number; loaders: Array<[string, string]> };
  /** The user cancelled the debugger bar; nothing reattaches until the user shares the tab again. */
  detachedByUser: boolean;
  pending: PendingModal[];
  /** Layers 3 and 4 of the navigation policy, while attached. */
  guard: NavigationGuard | null;
  /** The probe's isolated worlds in this tab, while attached. */
  probe: ProbeClient | null;
  /**
   * The release of a mouse button or key held back while a dialog blocks the page; run once the dialog closes. It
   * resolves with a note when it withheld the release from the page instead of completing it.
   */
  pendingRelease: (() => Promise<string | undefined>) | null;
  /** The held release of the dialog that just closed, while it runs; `handle_dialog` waits for it and reports it. */
  released: Promise<string | undefined> | null;
  /** Values the tab's observations masked, or the agent set in a masked field: replaced in every result. */
  secrets: Set<string>;
  /** The open JavaScript dialog, with the session it opened on. */
  dialog: {
    sessionId: string | undefined;
    type: string;
    message: string;
    defaultPrompt?: string;
    /** Whether Chrome can show the dialog to the user (`Page.javascriptDialogOpening`), for the prompt hand-over. */
    hasBrowserHandler: boolean;
  } | null;
  /** The file chooser a page opened, intercepted so the OS dialog never opens; `upload` fills it. */
  fileChooser: { frameId: string; backendNodeId: number; mode: 'selectSingle' | 'selectMultiple' } | null;
  /** Whether the tab's file chooser is intercepted: the host turns it off while the user holds the tab. */
  interceptFileChooser: boolean;
}

/** What a tool handler returns; the session turns it into a Result. */
export interface ToolOutcome<T = unknown> {
  data?: T;
  receipt?: ActionReceipt;
  page?: PageState;
  /** The page state asked for after an action could not be read; the receipt stands. */
  pageError?: ProtocolError;
  /** Tool-generated lines, printed outside the boundary. */
  lines?: string[];
  /** Page-derived text, printed inside the untrusted boundary. */
  pageText?: string;
  /** Tool-generated lines after the page text. */
  notices?: string[];
}

export interface ToolContext {
  controller: Controller;
  session: Session;
  /** The tab the call acts on; null for calls that need none (tabs list). */
  tabId: number | null;
  tab(): TabState;
  attach(): Promise<TabAttachment>;
  /** Cancels the call: checked between pipeline stages. */
  signal?: AbortSignal;
}

/** Throws CANCELLED when the call was cancelled; call between stages, never after dispatch. */
export function checkCancelled(ctx: ToolContext): void {
  if (ctx.signal?.aborted) throw new LayerError('CANCELLED', 'The call was cancelled before anything was dispatched.');
}

export interface CallOptions {
  signal?: AbortSignal;
}

export type ToolHandler = (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolOutcome>;

export class Controller {
  readonly registry: RefRegistry;
  readonly locks = new TabLocks();
  #tabs = new Map<number, TabState>();
  #sessions = new Map<string, Session>();
  #audit = new Set<(entry: AuditEntry) => void>();
  #nextSession = 1;

  private constructor(
    readonly host: ControllerHost,
    readonly epoch: Epoch,
  ) {
    this.registry = new RefRegistry(epoch);
    host.tabs.onRemoved(tabId => this.#tabRemoved(tabId));
    host.tabs.onNavigationTarget(event => void this.#pageOpenedTab(event));
  }

  /** Reserves the ref epoch before any ref can be issued. */
  static async create(host: ControllerHost): Promise<Controller> {
    return new Controller(host, await reserveEpoch(host.epochStore));
  }

  createSession(config: SessionConfig = {}): Session {
    const session = new Session(this, `s${this.#nextSession++}`, config);
    this.#sessions.set(session.id, session);
    return session;
  }

  sessions(): Session[] {
    return [...this.#sessions.values()];
  }

  /** Ends a session: its tabs are released (detached when no other session holds them) and it is forgotten. */
  async closeSession(session: Session): Promise<void> {
    this.#sessions.delete(session.id);
    for (const tabId of session.tabIds()) {
      session.forgetTab(tabId);
      await this.release(tabId);
    }
  }

  onAudit(listener: (entry: AuditEntry) => void): () => void {
    this.#audit.add(listener);
    return () => this.#audit.delete(listener);
  }

  /** Sends an entry to the audit listeners, with typed and set values redacted (never a credential in a log). */
  audit(entry: AuditEntry): void {
    const safe = { ...entry, args: redactArgs(entry.tool, entry.args) };
    for (const listener of this.#audit) listener(safe);
  }

  tabState(tabId: number): TabState {
    let state = this.#tabs.get(tabId);
    if (!state) {
      state = {
        tabId,
        attachment: null,
        attaching: null,
        capture: { enabledSessions: new Set() },
        rev: 0,
        actionSeq: 0,
        detachedByUser: false,
        pending: [],
        guard: null,
        probe: null,
        pendingRelease: null,
        released: null,
        secrets: new Set(),
        dialog: null,
        fileChooser: null,
        interceptFileChooser: true,
      };
      this.#tabs.set(tabId, state);
    }
    return state;
  }

  /**
   * Turns the interception of a tab's file chooser on or off. The host turns it off while the user holds the tab (a
   * hand-over, Take over), so a file the user picks goes through Chrome's own dialog.
   */
  async setFileChooserInterception(tabId: number, enabled: boolean): Promise<void> {
    const state = this.tabState(tabId);
    state.interceptFileChooser = enabled;
    if (!enabled) {
      state.fileChooser = null;
      state.pending = state.pending.filter(m => m.kind !== 'file-chooser');
    }
    const attachment = state.attachment;
    if (attachment && !attachment.detached) {
      await attachment.cdp.send(undefined, 'Page.setInterceptFileChooserDialog', { enabled }).catch(() => undefined);
    }
  }

  /** The tab's attachment, attaching on first use. */
  async attach(tabId: number): Promise<TabAttachment> {
    // A tab no session holds is never attached, not even by a call that began while it was shared.
    // The call may already have dispatched input, so what reached the page is unknown.
    if (!this.sessions().some(s => s.hasTab(tabId))) {
      throw new LayerError(
        'TAB_NOT_IN_SESSION',
        `Tab ${tabId} is not shared with any session; it was not attached. It may have been unshared during the call.`,
        { delivered: 'unknown' },
      );
    }
    const state = this.tabState(tabId);
    if (state.attachment && !state.attachment.detached) return state.attachment;
    if (state.detachedByUser) {
      throw new LayerError(
        'DEBUGGER_DETACHED',
        `The user detached the debugger from tab ${tabId}. The tab must be shared again before it can be controlled.`,
      );
    }
    if (!state.attaching) {
      state.attaching = this.host.attacher
        .attach(tabId)
        .then(async attachment => {
          // The tab was released (unshared or closed) while it was being attached: nothing keeps this connection.
          if (this.#tabs.get(tabId) !== state) {
            await attachment.close().catch(() => undefined);
            throw new LayerError('DEBUGGER_DETACHED', `Tab ${tabId} was released while it was being attached.`);
          }
          state.attachment = attachment;
          state.capture = { enabledSessions: new Set() };
          state.probe = new ProbeClient(attachment.cdp);
          // Any navigation ends the reuse of the last capture.
          attachment.topology.onFrameEvent(event => {
            if (event.type !== 'attached') state.last = undefined;
            // A chooser's input goes with its document.
            if (event.type !== 'attached' && state.fileChooser?.frameId === event.frameId) {
              state.fileChooser = null;
              state.pending = state.pending.filter(m => m.kind !== 'file-chooser');
            }
          });
          // Modal states: a JavaScript dialog blocks the tab until it is handled, whoever opened it.
          attachment.cdp.on('Page.javascriptDialogOpening', (params, sessionId) => {
            const p = params as { type: string; message: string; defaultPrompt?: string; hasBrowserHandler?: boolean };
            state.dialog = {
              sessionId,
              type: p.type,
              message: p.message,
              defaultPrompt: p.defaultPrompt,
              hasBrowserHandler: p.hasBrowserHandler ?? true,
            };
            const detail = dialogDetail(p);
            if (!state.pending.some(m => m.kind === 'dialog')) state.pending.push({ kind: 'dialog', detail });
          });
          // A page's file chooser: intercepted, it becomes the `file-chooser` pending modal, which
          // `upload` without a target fills; the OS dialog never opens while the agent holds the tab.
          attachment.cdp.on('Page.fileChooserOpened', params => {
            const p = params as { frameId: string; backendNodeId?: number; mode: 'selectSingle' | 'selectMultiple' };
            if (p.backendNodeId === undefined) return;
            state.fileChooser = { frameId: p.frameId, backendNodeId: p.backendNodeId, mode: p.mode };
            state.pending = state.pending.filter(m => m.kind !== 'file-chooser');
            state.pending.push({
              kind: 'file-chooser',
              detail: p.mode === 'selectMultiple' ? 'several files may be chosen' : 'one file may be chosen',
            });
          });
          if (state.interceptFileChooser) {
            await attachment.cdp
              .send(undefined, 'Page.setInterceptFileChooserDialog', { enabled: true })
              .catch(() => undefined);
          }
          attachment.cdp.on('Page.javascriptDialogClosed', () => {
            state.dialog = null;
            state.pending = state.pending.filter(m => m.kind !== 'dialog');
            // The release of a click or key whose press opened the dialog goes out now: completed if its target is
            // still what was judged, withheld from the page otherwise.
            const release = state.pendingRelease;
            state.pendingRelease = null;
            state.released = release ? release().catch(() => undefined) : null;
          });
          attachment.onDetach(info => {
            if (state.attachment !== attachment) return;
            state.guard?.dispose();
            state.guard = null;
            state.probe = null;
            state.attachment = null;
            state.last = undefined;
            state.pending = [];
            state.dialog = null;
            state.fileChooser = null;
            state.pendingRelease = null;
            state.released = null;
            if (info.reason === 'canceled_by_user') state.detachedByUser = true;
            this.registry.tabDetached(tabId);
          });
          return attachment;
        })
        .then(async attachment => {
          // Layer 3 is active before any action on the tab.
          state.guard = new NavigationGuard(
            attachment,
            url => this.allowedFor(tabId)(url),
            () => this.#policiesFor(tabId).some(hasLists),
          );
          await state.guard.sync();
          return attachment;
        })
        .finally(() => {
          state.attaching = null;
        });
    }
    return state.attaching;
  }

  #policiesFor(tabId: number): UrlPolicy[] {
    return this.sessions()
      .filter(s => s.hasTab(tabId))
      .map(s => s.urlPolicy);
  }

  /** Whether a main-frame URL is allowed in a tab: by every session that holds it, and never a blocked scheme. */
  allowedFor(tabId: number): (url: string) => boolean {
    return combinePolicies(this.#policiesFor(tabId));
  }

  /** Re-applies layer 3 to every attached tab after a policy changed. */
  async syncPolicies(): Promise<void> {
    await Promise.all([...this.#tabs.values()].map(state => state.guard?.sync().catch(() => undefined)));
  }

  /** A session holds the tab: Memory Saver must not discard it meanwhile. */
  held(tabId: number): void {
    void this.host.tabs.setDiscardable?.(tabId, false);
  }

  /** Detaches from a tab (when no session holds it any more). */
  async release(tabId: number): Promise<void> {
    if (this.sessions().some(s => s.hasTab(tabId))) return;
    void this.host.tabs.setDiscardable?.(tabId, true);
    const state = this.#tabs.get(tabId);
    // Removed first: an attach still in progress sees its state gone and closes what it attached.
    this.#tabs.delete(tabId);
    if (state?.attachment) await state.attachment.close().catch(() => undefined);
    this.registry.tabDetached(tabId);
  }

  /**
   * A tab opened by a page (window.open, target=_blank) is not attached when its first request starts, so layer 3
   * cannot pause it. A disallowed URL closes the tab at once and is reported; an allowed one is attached and
   * joins the sessions that hold the opener, and layer 3 applies from then on.
   */
  async #pageOpenedTab(event: { sourceTabId: number; tabId: number; url: string }): Promise<void> {
    const holders = this.sessions().filter(s => s.hasTab(event.sourceTabId));
    if (!holders.length) return;
    const source = this.tabState(event.sourceTabId);
    if (!this.allowedFor(event.sourceTabId)(event.url)) {
      await this.host.tabs.close(event.tabId).catch(() => undefined);
      source.guard?.report({
        layer: 2,
        url: event.url,
        at: Date.now(),
        detail: `The page opened a new tab for ${quote(event.url)}, which is not allowed; the tab was closed. Its first request may already have been sent.`,
      });
      return;
    }
    for (const session of holders) session.adoptTab(event.tabId);
    await this.attach(event.tabId).catch(() => undefined);
  }

  #tabRemoved(tabId: number): void {
    for (const session of this.#sessions.values()) session.forgetTab(tabId);
    this.registry.tabDetached(tabId);
    this.#tabs.delete(tabId);
  }
}

export function toProtocolError(error: unknown, readOnly: boolean): ProtocolError {
  if (isLayerError(error)) return error.toProtocol();
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'CdpTimeoutError' || name === 'TimeoutError') {
    return new LayerError('TIMEOUT', message, { delivered: readOnly ? false : 'unknown' }).toProtocol();
  }
  // An INTERNAL error is a bug in the layer: keep its stack in the worker's console (it holds no page content).
  console.error(
    `[layer] internal error: ${(error instanceof Error ? error.stack : String(error))?.replace(/\n\s*/g, ' | ')}`,
  );
  return new LayerError('INTERNAL', message, { delivered: readOnly ? false : 'unknown' }).toProtocol();
}

export class Session {
  readonly nonce = newNonce();
  /** The refs this session was shown, with what it was shown for each. */
  readonly known = new KnownSet();
  /** The outline the session last saw per tab, for diffs. */
  readonly seen = new Map<number, { rev: number; lines: string[] }>();
  readonly capabilities: Set<Capability>;
  readonly config: Required<
    Omit<
      SessionConfig,
      'capabilities' | 'urlPolicy' | 'confirm' | 'boundary' | 'handover' | 'decideWrite' | 'reveal' | 'onTabJoined'
    >
  >;
  readonly hooks: Pick<SessionConfig, 'reveal' | 'onTabJoined'>;
  readonly decideWrite: SessionConfig['decideWrite'];
  /** Fixed when the session is made: a session never gains or loses its hand-over policy. */
  readonly handover: boolean;
  #boundary: DefuseOptions;
  #urlPolicy: UrlPolicy;
  #confirm: ConfirmPolicy;
  /** Sites where the user chose "do not ask again" for submit, for this session only. */
  readonly rememberedSubmitOrigins = new Set<string>();
  #tabs = new Set<number>();
  #active: number | null = null;

  constructor(
    readonly controller: Controller,
    readonly id: string,
    config: SessionConfig,
  ) {
    this.handover = config.handover ?? false;
    this.decideWrite = config.decideWrite;
    this.hooks = { reveal: config.reveal, onTabJoined: config.onTabJoined };
    this.capabilities = new Set(this.#allowed(config.capabilities ?? []));
    this.config = {
      observeDefault: config.observeDefault ?? 'none',
      budget: config.budget ?? 30_000,
      confirmTimeoutMs: config.confirmTimeoutMs ?? 120_000,
      askTimeoutMs: config.askTimeoutMs ?? 300_000,
      uploadSources: config.uploadSources ?? ['paths', 'attachments'],
    };
    this.#urlPolicy = normalizePolicy(config.urlPolicy ?? EMPTY_POLICY);
    this.#confirm = config.confirm ?? 'sensitive';
    this.#boundary = config.boundary ?? {};
  }

  get boundary(): DefuseOptions {
    return this.#boundary;
  }

  /** For the host: its labels and template tokens. Never from the protocol. */
  setBoundary(boundary: DefuseOptions): void {
    this.#boundary = boundary;
  }

  /** Wraps untrusted content with this session's nonce and boundary options; the host wraps attachments with it. */
  wrap(content: string, source?: ContentSource): string {
    return untrusted(this.nonce, content, { ...this.#boundary, source });
  }

  get confirmPolicy(): ConfirmPolicy {
    return this.#confirm;
  }

  /** For the host (the user's settings), never for the agent. */
  setConfirmPolicy(policy: ConfirmPolicy): void {
    this.#confirm = policy;
    if (policy !== 'sensitive') this.rememberedSubmitOrigins.clear();
  }

  /** For the host: the capabilities the user enabled for this session. */
  setCapabilities(capabilities: Capability[]): void {
    this.capabilities.clear();
    for (const c of this.#allowed(capabilities)) this.capabilities.add(c);
  }

  /** A session with a hand-over policy never has page script or devtools. */
  #allowed(capabilities: Capability[]): Capability[] {
    return this.handover ? capabilities.filter(c => c !== 'eval' && c !== 'devtools') : capabilities;
  }

  /** Refuses a tab whose page is on a blocked site. */
  async checkTabSite(tabId: number): Promise<void> {
    if (!this.#urlPolicy.blocked?.length) return;
    const tab = await this.controller.host.tabs.get(tabId);
    if (tab && isBlockedSite(tab.url, this.#urlPolicy.blocked)) {
      throw new LayerError(
        'URL_NOT_ALLOWED',
        `Tab ${tabId} is on ${quote(siteOf(tab.url))}, a site the user blocked. Nothing was done on it.`,
      );
    }
  }

  /** Shares a tab after checking its site: the host's way to add a tab to a product session. */
  async share(tabId: number): Promise<void> {
    await this.checkTabSite(tabId);
    this.shareTab(tabId);
  }

  get urlPolicy(): UrlPolicy {
    return this.#urlPolicy;
  }

  /** For the host (the user's settings), never for the agent: the protocol has no call that changes the policy. */
  async setUrlPolicy(policy: UrlPolicy): Promise<void> {
    this.#urlPolicy = normalizePolicy(policy);
    await this.controller.syncPolicies();
  }

  get activeTabId(): number | null {
    return this.#active;
  }

  tabIds(): number[] {
    return [...this.#tabs];
  }

  hasTab(tabId: number): boolean {
    return this.#tabs.has(tabId);
  }

  /** The user shares a tab with the session (or the session opened it). It becomes the active tab. */
  shareTab(tabId: number, how: 'shared' | 'opened' = 'shared'): void {
    this.#tabs.add(tabId);
    this.#active = tabId;
    this.controller.tabState(tabId).detachedByUser = false;
    void this.controller.syncPolicies();
    this.controller.held(tabId);
    this.hooks.onTabJoined?.(tabId, how);
  }

  /** A tab opened by an action joins the session; the active tab stays (the agent decides whether to switch). */
  adoptTab(tabId: number): void {
    this.#tabs.add(tabId);
    if (this.#active === null) this.#active = tabId;
    void this.controller.syncPolicies();
    this.controller.held(tabId);
    this.hooks.onTabJoined?.(tabId, 'page-opened');
  }

  /** Whether a tab should become the visible tab, as the host decides. */
  async shouldReveal(tabId: number | null): Promise<boolean> {
    return this.hooks.reveal ? await this.hooks.reveal(tabId) : true;
  }

  async unshareTab(tabId: number): Promise<void> {
    this.forgetTab(tabId);
    await this.controller.release(tabId);
  }

  forgetTab(tabId: number): void {
    this.#tabs.delete(tabId);
    this.known.forget(tabId);
    this.seen.delete(tabId);
    if (this.#active === tabId) this.#active = this.#tabs.values().next().value ?? null;
  }

  setActive(tabId: number): void {
    if (!this.#tabs.has(tabId)) throw new LayerError('TAB_NOT_IN_SESSION', `Tab ${tabId} is not in the session`);
    this.#active = tabId;
  }

  /**
   * Diagnostics for the test extension, not a protocol tool: resolve, revalidate and check a target as an action
   * would, without dispatching anything.
   */
  async inspectTarget(target: Target, needs: { pointer: boolean; editable?: boolean; budgetMs?: number }) {
    const tabId = this.#resolveTab('inspect', { target });
    if (tabId === null) throw new LayerError('TAB_NOT_IN_SESSION', 'No tab');
    const ctx: ToolContext = {
      controller: this.controller,
      session: this,
      tabId,
      tab: () => this.controller.tabState(tabId),
      attach: () => this.controller.attach(tabId),
    };
    return this.controller.locks.run(tabId, async () => {
      try {
        const resolved = await resolveTarget(ctx, target);
        try {
          const actionable = await waitForActionable(ctx, resolved, needs);
          return {
            ok: true as const,
            description: resolved.description,
            point: actionable.point,
            state: actionable.state,
          };
        } finally {
          await this.controller.tabState(tabId).probe?.release(resolved.frame, resolved.objectId);
        }
      } catch (error) {
        return { ok: false as const, error: toProtocolError(error, true) };
      }
    });
  }

  listTools(): ToolSpec[] {
    return listTools(this.capabilities);
  }

  /** Resolves the tab a call acts on (a ref target names its own tab). */
  #resolveTab(tool: string, args: Record<string, unknown>): number | null {
    if (tool === 'tabs') return null;
    const explicit = typeof args.tabId === 'number' ? args.tabId : undefined;
    const target = args.target as { ref?: string } | undefined;
    const ref = target?.ref ?? ((args.ref ?? args.scope ?? args.within) as string | undefined);
    if (ref) {
      const record = this.controller.registry.get(ref);
      // A label this registry never issued can never become valid, whatever the tab.
      if (!record) throw new LayerError('REF_UNKNOWN', `Ref ${ref} is not known`);
      if (explicit !== undefined && explicit !== record.tabId) {
        throw new LayerError('REF_TAB_MISMATCH', `Ref ${ref} belongs to tab ${record.tabId}, not tab ${explicit}`);
      }
      // Checked before any handler runs: a tab the user unshared is never attached again for a ref.
      if (!this.#tabs.has(record.tabId)) {
        throw new LayerError(
          'TAB_NOT_IN_SESSION',
          `Ref ${ref} belongs to tab ${record.tabId}, which is not in the session`,
        );
      }
      return record.tabId;
    }
    const tabId = explicit ?? this.#active;
    if (tabId === null)
      throw new LayerError('TAB_NOT_IN_SESSION', 'The session has no tab. Share or open a tab first.');
    if (!this.#tabs.has(tabId)) throw new LayerError('TAB_NOT_IN_SESSION', `Tab ${tabId} is not in the session`);
    return tabId;
  }

  async call(tool: string, rawArgs: unknown = {}, options: CallOptions = {}): Promise<Result> {
    const start = performance.now();
    const spec = toolSpec(tool);
    let args: Record<string, unknown> = (rawArgs ?? {}) as Record<string, unknown>;
    let tabId: number | null = null;
    const readOnly = spec ? isReadOnly(spec, args) : true;
    let result: Result;
    try {
      if (!spec || !spec.available) throw new LayerError('INVALID_ARGUMENT', `Unknown tool ${tool}`);
      if (this.handover && (spec.capability === 'eval' || spec.capability === 'devtools')) {
        throw new LayerError('CAPABILITY_DISABLED', `Tool ${tool} is not available in this session`);
      }
      if (spec.capability !== 'core' && !this.capabilities.has(spec.capability)) {
        throw new LayerError('CAPABILITY_DISABLED', `Tool ${tool} needs the capability "${spec.capability}"`);
      }
      const parsed = spec.args.safeParse(rawArgs ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues.map(i => `${i.path.join('.') || '(arguments)'}: ${i.message}`).join('; ');
        throw new LayerError('INVALID_ARGUMENT', `Invalid arguments for ${tool}: ${issues}`);
      }
      args = parsed.data as Record<string, unknown>;
      tabId = this.#resolveTab(tool, args);
      if (tabId !== null) await this.checkTabSite(tabId);
      // A JavaScript dialog blocks the renderer: nothing but handle_dialog can work on the tab meanwhile.
      // While the user is asked to confirm or to do something, the tab belongs to the user.
      if (tabId !== null) {
        const pending = this.controller.tabState(tabId).pending;
        const dialog = pending.find(m => m.kind === 'dialog');
        if (dialog && tool !== 'handle_dialog') {
          throw new LayerError('MODAL_PENDING', `A dialog is open on this tab: ${dialog.detail}. Use handle_dialog.`);
        }
        const person = pending.find(m => m.kind === 'confirmation' || m.kind === 'user-request');
        if (person)
          throw new LayerError(
            'MODAL_PENDING',
            `The user is being asked on this tab (${person.kind}: ${person.detail}).`,
          );
      }
      const handler = TOOL_HANDLERS[tool];
      if (!handler) throw new LayerError('INVALID_ARGUMENT', `Tool ${tool} is not implemented`);
      const ctx: ToolContext = {
        controller: this.controller,
        session: this,
        tabId,
        tab: () => this.controller.tabState(tabId!),
        attach: () => this.controller.attach(tabId!),
        signal: options.signal,
      };
      const run = () => {
        checkCancelled(ctx);
        return handler(ctx, args);
      };
      const outcome = tabId === null ? await run() : await this.controller.locks.run(tabId, run);
      result = this.#render(tool, outcome, tabId);
    } catch (error) {
      const protocolError = toProtocolError(error, readOnly);
      const pending = tabId !== null ? this.controller.tabState(tabId).pending : [];
      const partial = isLayerError(error) ? error.partial : undefined;
      result = {
        ok: false,
        error: protocolError,
        data: partial?.data,
        pending: pending.length ? pending : undefined,
        text: [
          errorLine(protocolError),
          ...(partial?.lines ?? []),
          ...this.#policyNotices(tabId),
          ...pendingLines(pending),
        ].join('\n'),
      };
    }
    // Whatever path printed it, a value the tab's observations mask does not leave in a result.
    if (tabId !== null) result = maskSecrets(result, this.controller.tabState(tabId).secrets, MASK);
    // The host's labels are defused inside every quoted page fragment too.
    result = { ...result, text: defuseQuotes(result.text, this.#boundary) };
    this.controller.audit({
      at: new Date().toISOString(),
      sessionId: this.id,
      tool,
      args,
      ok: result.ok,
      error: result.error,
      receipt: result.receipt,
      tabId: tabId ?? undefined,
      ms: Math.round(performance.now() - start),
    });
    return result;
  }

  /** Policy events that happened outside a navigation call (a script, the page itself), reported once. */
  #policyNotices(tabId: number | null): string[] {
    const tabs = tabId !== null ? [tabId, ...this.tabIds().filter(t => t !== tabId)] : this.tabIds();
    return tabs.flatMap(t =>
      (this.controller.tabState(t).guard?.drain() ?? []).map(
        e => `policy: URL_NOT_ALLOWED${t === tabId ? '' : ` on tab ${t}`} · ${e.detail}`,
      ),
    );
  }

  #render(tool: string, outcome: ToolOutcome, tabId: number | null): Result {
    const pending = tabId !== null ? this.controller.tabState(tabId).pending : [];
    const text: string[] = [];
    const policy = this.#policyNotices(tabId);
    if (outcome.receipt) text.push(...receiptLines(outcome.receipt));
    text.push(...(outcome.lines ?? []));
    if (outcome.pageError) {
      text.push(
        `page: ${outcome.pageError.code} · ${outcome.pageError.message} The page state could not be read after the action; the receipt above says what was dispatched.`,
      );
    }
    if (outcome.pageText !== undefined) {
      const url = outcome.page?.url ?? (tabId !== null ? this.controller.tabState(tabId).last?.observation.url : '');
      text.push(untrusted(this.nonce, outcome.pageText, { ...this.#boundary, source: { site: siteOf(url ?? '') } }));
    }
    text.push(...(outcome.notices ?? []));
    text.push(...policy);
    text.push(...pendingLines(pending));
    return {
      ok: true,
      receipt: outcome.receipt,
      page: outcome.page,
      pageError: outcome.pageError,
      pending: pending.length ? [...pending] : undefined,
      data: outcome.data,
      text: text.join('\n') || `${tool}: ok`,
    };
  }
}

export type { ErrorCode };
