// Effect evidence, version 1, and settle, and postconditions.
// The layer does not judge success: it reports whether the page moved, and where, by comparing a baseline taken
// just before dispatch with what it sees during the settle window.
import type { Expectation } from '../../protocol/schemas';
import type { ActionReceipt } from '../../protocol/results';
import type { ProbeState, PageFacts } from '../../probe';
import type { TabState, ToolContext } from '../controller';
import type { ResolvedTarget } from './resolve';
import type { DialogInfo } from './pointer';
import { focusedElement } from './preflight';
import { isSensitiveState } from '../perception/masking';
import { dialogDetail, quote } from '../text';
import { siteOf } from '../site';

/** Settle: poll 100 ms; cap 1.5 s; 500 ms with no evidence and no request. */
const POLL_MS = 100;
const CAP_MS = 1_500;
const NAVIGATION_READY_MS = 5_000;
/** How long the block is watched after settle when the only evidence is its own mutations. */
const VOLATILITY_MS = 400;
/** Weak signals: mutations alone do not say the action did something. */
const WEAK = / mutations? in /;

interface Snapshot {
  url: string;
  state: ProbeState | null;
  removed: boolean;
  block: number;
}

interface TrackedRequest {
  method: string;
  url: string;
  done: boolean;
}

export interface EvidenceResult {
  effect: ActionReceipt['effect'];
  navigation?: ActionReceipt['navigation'];
  newTab?: ActionReceipt['newTab'];
  downloads?: ActionReceipt['downloads'];
  dialog?: DialogInfo;
  postcondition?: ActionReceipt['postcondition'];
}

/**
 * A request's URL as evidence prints it: its path, and its origin when that differs from the page's, without user
 * information, query or fragment, and only the scheme of a URL that is not http or https (a data: URL is its content).
 * A page's background request can carry what was typed into a masked field (a code sent to `/verify` in its query), and
 * the receipt goes to the agent and the audit; that a request was made is the evidence.
 */
export function requestUrl(url: string, base: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return `${u.protocol}…`;
    const sameOrigin = u.origin === new URL(base).origin;
    const where = sameOrigin ? '' : `${u.protocol}//${u.host}`;
    return `${where}${u.pathname}${u.search ? '?…' : ''}`;
  } catch {
    return '(unreadable URL)';
  }
}

export class Evidence {
  #offs: Array<() => void> = [];
  #requests = new Map<string, TrackedRequest>();
  #navigation: ActionReceipt['navigation'] | undefined;
  #newTab: ActionReceipt['newTab'] | undefined;
  #dialog: DialogInfo | undefined;
  /** Downloads the page began during the action: reported, not held. */
  #downloads: Array<{ name: string; url: string }> = [];
  #baseline!: Snapshot;
  #block = '';
  #idle = false;
  #abandoned = false;
  #factsBefore: PageFacts | null = null;
  #focusBefore: string | null = null;
  /** The caller masked the value, or the target was a sensitive field at the baseline: it stays masked,
   *  whatever it becomes (a password field the page turns into a text field). */
  #maskedBefore = false;
  /** The tab's state when the baseline was taken: its probe goes away when the tab closes or the debugger detaches. */
  #tab!: TabState;

  private constructor(
    private readonly ctx: ToolContext,
    private readonly target: ResolvedTarget | null,
    private readonly masked: boolean,
  ) {}

  /** Takes the baseline and starts listening; call just before dispatch. */
  static async begin(
    ctx: ToolContext,
    target: ResolvedTarget | null,
    options: { masked?: boolean } = {},
  ): Promise<Evidence> {
    const evidence = new Evidence(ctx, target, options.masked ?? false);
    await evidence.#start();
    return evidence;
  }

  async #start(): Promise<void> {
    const attachment = await this.ctx.attach();
    const { cdp, topology } = attachment;
    this.#tab = this.ctx.tab();
    const tabId = this.#tab.tabId;
    if (this.target) {
      this.#block = await this.ctx
        .tab()
        .probe!.call<string>(this.target.frame, this.target.objectId, 'watchBlock')
        .catch(() => '');
    }
    this.#baseline = await this.#snapshot();
    this.#maskedBefore =
      this.masked || (!!this.target && isSensitiveState(this.#baseline.state, this.target.record.print.name));
    [this.#factsBefore, this.#focusBefore] = await Promise.all([this.#pageFacts(), this.#focus()]);
    this.#offs.push(
      cdp.on('Page.frameNavigated', params => {
        const { frame } = params as { frame: { id: string; parentId?: string; url: string; urlFragment?: string } };
        if (!frame.parentId && frame.id === topology.mainFrameId()) {
          this.#navigation = { url: frame.url + (frame.urlFragment ?? ''), kind: 'new-document' };
          this.#idle = false;
        }
      }),
      cdp.on('Page.navigatedWithinDocument', params => {
        const { frameId, url } = params as { frameId: string; url: string };
        if (frameId === topology.mainFrameId() && !this.#navigation) this.#navigation = { url, kind: 'same-document' };
      }),
      cdp.on('Page.lifecycleEvent', params => {
        const p = params as { frameId: string; name: string };
        if (p.frameId === topology.mainFrameId() && p.name === 'networkIdle') this.#idle = true;
      }),
      cdp.on('Page.javascriptDialogOpening', params => {
        this.#dialog ??= params as DialogInfo;
      }),
      cdp.on('Page.downloadWillBegin', params => {
        const p = params as { url: string; suggestedFilename: string };
        this.#downloads.push({ name: p.suggestedFilename, url: p.url });
      }),
      cdp.on('Network.requestWillBeSent', (params, sessionId) => {
        const p = params as { requestId: string; type?: string; request: { method: string; url: string } };
        if (p.type !== 'Document' && p.type !== 'XHR' && p.type !== 'Fetch') return;
        this.#requests.set(`${sessionId ?? ''}|${p.requestId}`, {
          method: p.request.method,
          url: p.request.url,
          done: false,
        });
      }),
      cdp.on('Network.loadingFinished', (params, sessionId) => this.#finish(params, sessionId)),
      cdp.on('Network.loadingFailed', (params, sessionId) => this.#finish(params, sessionId)),
      this.ctx.controller.host.tabs.onCreated(tab => {
        if (tab.openerTabId === tabId && !this.#newTab) this.#newTab = { tabId: tab.tabId, url: tab.url };
      }),
      // A page in a background tab opens a tab: Chrome gives it the window's active tab as its opener, so the
      // navigation target event, which names the real source, is what attributes it (agent plan step 6.6).
      this.ctx.controller.host.tabs.onNavigationTarget(event => {
        if (event.sourceTabId === tabId && !this.#newTab) this.#newTab = { tabId: event.tabId, url: event.url };
      }),
    );
  }

  #finish(params: unknown, sessionId: string | undefined): void {
    const request = this.#requests.get(`${sessionId ?? ''}|${(params as { requestId: string }).requestId}`);
    if (request) request.done = true;
  }

  /** A dialog seen by the dispatch race. */
  noteDialog(dialog: DialogInfo | undefined): void {
    if (dialog) this.#dialog ??= dialog;
  }

  async #snapshot(): Promise<Snapshot> {
    const tab = await this.ctx.controller.host.tabs.get(this.ctx.tab().tabId);
    let state: ProbeState | null = null;
    let removed = false;
    let block = 0;
    if (this.target) {
      const probe = this.ctx.tab().probe!;
      try {
        state = await probe.call<ProbeState>(this.target.frame, this.target.objectId, 'state');
        removed = !state.connected;
        block = await probe.callGlobal<number>(this.target.frame, 'blockMutations');
      } catch {
        removed = true;
      }
    }
    return { url: tab?.url ?? '', state, removed, block };
  }

  #signals(now: Snapshot): string[] {
    const signals: string[] = [];
    const base = this.#baseline;
    if (this.#navigation) {
      signals.push(
        this.#navigation.kind === 'new-document'
          ? `new document ${quote(this.#navigation.url)}`
          : `URL → ${quote(this.#navigation.url)}`,
      );
    } else if (now.url !== base.url) {
      signals.push(`URL → ${quote(now.url)}`);
    }
    if (this.#dialog) signals.push(`dialog ${dialogDetail(this.#dialog)}`);
    if (this.#newTab) signals.push(`new tab ${this.#newTab.tabId}`);
    for (const d of this.#downloads) {
      const from = d.url.startsWith('blob:') || d.url.startsWith('data:') ? 'the page' : siteOf(d.url) || d.url;
      // Only the start is seen: the browser may still be waiting in its save dialog, or the download may fail.
      signals.push(`download started ${quote(d.name, 120)} from ${quote(from, 120)}; whether it finished is not known`);
    }
    if (this.target) {
      if (now.removed && !base.removed) signals.push('target removed');
      else if (now.state && base.state) {
        // Masked when the caller said so or when the field is sensitive before or after, whatever the tool.
        const name = this.target.record.print.name;
        const masked = this.#maskedBefore || isSensitiveState(now.state, name);
        if (now.state.value !== base.state.value)
          signals.push(masked ? 'target value changed (masked)' : `target value → ${quote(now.state.value)}`);
        if (now.state.checked !== base.state.checked)
          signals.push(`target ${now.state.checked ? 'checked' : 'unchecked'}`);
        if (now.state.visible !== base.state.visible) signals.push(`target ${now.state.visible ? 'shown' : 'hidden'}`);
        if (now.state.enabled !== base.state.enabled)
          signals.push(`target ${now.state.enabled ? 'enabled' : 'disabled'}`);
      }
      const mutations = now.block - base.block;
      if (mutations > 0)
        signals.push(
          `${mutations} mutation${mutations === 1 ? '' : 's'} in ${this.#block ? quote(this.#block, 80) : 'the enclosing block'}`,
        );
    }
    const requests = [...this.#requests.values()];
    for (const r of requests.slice(0, 3))
      signals.push(`request: ${r.method} ${quote(requestUrl(r.url, base.url))}${r.done ? '' : ' (pending)'}`);
    if (requests.length > 3) signals.push(`… ${requests.length - 3} more requests`);
    return signals;
  }

  /**
   * Polls until a new document commits, a dialog or new tab appears, the expectation is met, the evidence is the
   * same on two polls with no tracked request in flight, or the cap.
   */
  async settle(expect?: Expectation): Promise<EvidenceResult> {
    const start = performance.now();
    let previous = '';
    let met: ActionReceipt['postcondition'] | undefined;
    try {
      for (;;) {
        await new Promise(resolve => setTimeout(resolve, POLL_MS));
        // Cancelled after dispatch: the wait is abandoned, and the receipt still says the input was dispatched.
        if (this.ctx.signal?.aborted) {
          this.#abandoned = true;
          break;
        }
        if (this.#navigation?.kind === 'new-document') {
          await this.#waitReady(start);
          break;
        }
        if (this.#dialog || this.#newTab || !this.#tab.probe) break;
        if (expect) {
          met = await checkExpectation(this.ctx, this.target, expect, this.#maskedBefore).catch(() => undefined);
          if (met?.status === 'met') break;
        }
        const now = await this.#snapshot();
        const signals = this.#signals(now);
        const key = JSON.stringify(signals.map(s => s.replace(' (pending)', '')));
        const inflight = [...this.#requests.values()].some(r => !r.done);
        const elapsed = performance.now() - start;
        if (elapsed >= CAP_MS) break;
        // With an explicit expectation, settle waits for it up to the cap instead of stopping on quiet evidence.
        if (!expect && !inflight && key === previous) break;
        previous = key;
      }
      // The page cannot be read: a dialog blocks its renderer (every read would only time out), or the action closed
      // the tab or the debugger detached. What the listeners saw is the evidence; the target is not read again.
      const lost = !this.#tab.probe;
      if (lost || this.#dialog) {
        const seen = this.#signals(this.#baseline);
        if (lost) seen.push('the tab closed or the debugger detached');
        if (this.#abandoned) seen.push('settle abandoned: the call was cancelled');
        return {
          effect: { verdict: seen.length ? 'changed' : 'none', signals: seen },
          navigation: this.#navigation,
          newTab: this.#newTab,
          downloads: this.#downloads.length ? [...this.#downloads] : undefined,
          dialog: this.#dialog,
          postcondition:
            expect && met?.status !== 'met'
              ? { status: 'not_checked', detail: lost ? 'the tab is gone' : 'a dialog is open' }
              : met,
        };
      }
      const now =
        this.#navigation?.kind === 'new-document'
          ? { ...this.#baseline, url: this.#navigation.url }
          : await this.#snapshot();
      const signals = this.#signals(now);
      // Version 2: focus, alert and validation text, top-level layers; strong and weak signals.
      const strong = signals.filter(s => !WEAK.test(s));
      const weak = signals.filter(s => WEAK.test(s));
      if (this.#navigation?.kind !== 'new-document' && !this.#dialog) {
        const [facts, focus] = await Promise.all([this.#pageFacts(), this.#focus()]);
        if (facts && this.#factsBefore) {
          for (const a of facts.alerts) if (!this.#factsBefore.alerts.includes(a)) strong.push(`alert ${quote(a)}`);
          for (const v of facts.invalid)
            if (!this.#factsBefore.invalid.includes(v)) strong.push(`validation ${quote(v)}`);
          const layers = facts.layers.filter(l => !this.#factsBefore!.layers.includes(l));
          if (layers.length)
            strong.push(`+${layers.length} top-level layer: ${layers.map(l => quote(l, 80)).join(', ')}`);
        }
        if (focus && focus !== this.#focusBefore && focus !== 'the target') strong.push(`focus → ${quote(focus, 80)}`);
      }
      let verdict: EvidenceResult['effect']['verdict'] = strong.length || weak.length ? 'changed' : 'none';
      // Only weak evidence: watch the block a little longer; a page that keeps changing by itself is not this action.
      if (!strong.length && weak.length && this.target && (await this.#keepsChanging())) {
        verdict = 'unattributable';
        weak.push('the page changes by itself');
      }
      const all = [...strong, ...weak];
      if (this.#abandoned) all.push('settle abandoned: the call was cancelled');
      if (expect && met?.status !== 'met')
        met = await checkExpectation(this.ctx, this.target, expect, this.#maskedBefore).catch(e => ({
          status: 'unmet' as const,
          detail: String(e),
        }));
      return {
        effect: { verdict, signals: all },
        navigation: this.#navigation,
        newTab: this.#newTab,
        downloads: this.#downloads.length ? [...this.#downloads] : undefined,
        dialog: this.#dialog,
        postcondition: met,
      };
    } finally {
      this.dispose();
    }
  }

  async #pageFacts(): Promise<PageFacts | null> {
    const frame = this.target?.frame ?? (await (await this.ctx.attach()).topology.frames())[0];
    if (!frame) return null;
    return this.ctx
      .tab()
      .probe!.callGlobal<PageFacts>(frame, 'pageFacts')
      .catch(() => null);
  }

  /** The focused element, described, or null. Focus on the target itself is not evidence (a click focuses it). */
  async #focus(): Promise<string | null> {
    const focused = await focusedElement(this.ctx).catch(() => null);
    if (!focused) return null;
    const probe = this.ctx.tab().probe!;
    if (
      this.target &&
      focused.frame.frameId === this.target.frame.frameId &&
      focused.backendNodeId === this.target.record.backendNodeId
    ) {
      await probe.release(focused.frame, focused.objectId);
      return 'the target';
    }
    try {
      return await probe.call<string>(focused.frame, focused.objectId, 'describe');
    } catch {
      return null;
    } finally {
      await probe.release(focused.frame, focused.objectId);
    }
  }

  /** Whether the target's block keeps mutating with nothing more dispatched (a volatility check). */
  async #keepsChanging(): Promise<boolean> {
    const probe = this.ctx.tab().probe!;
    const frame = this.target!.frame;
    const before = await probe.callGlobal<number>(frame, 'blockMutations').catch(() => 0);
    await new Promise(resolve => setTimeout(resolve, VOLATILITY_MS));
    const after = await probe.callGlobal<number>(frame, 'blockMutations').catch(() => before);
    return after > before;
  }

  /** After a new document: DOMContentLoaded plus network idle, capped. */
  async #waitReady(start: number): Promise<void> {
    while (!this.#idle && performance.now() - start < NAVIGATION_READY_MS) {
      await new Promise(resolve => setTimeout(resolve, POLL_MS));
    }
  }

  dispose(): void {
    this.#offs.forEach(off => off());
    this.#offs = [];
  }
}

/** A postcondition: met, unmet with the live reading (masked for a sensitive field), or not checked. */
export async function checkExpectation(
  ctx: ToolContext,
  target: ResolvedTarget | null,
  expect: Expectation,
  masked = false,
): Promise<ActionReceipt['postcondition']> {
  const failures: string[] = [];
  const attachment = await ctx.attach();
  const probe = ctx.tab().probe!;
  const frames = await attachment.topology.frames();
  const main = frames[0];
  if (expect.url !== undefined) {
    const url = (await ctx.controller.host.tabs.get(ctx.tab().tabId))?.url ?? '';
    if (!url.includes(expect.url)) failures.push(`URL is ${quote(url)}`);
  }
  if (expect.text !== undefined && !(await probe.callGlobal<boolean>(main, 'hasText', expect.text))) {
    failures.push(`${quote(expect.text)} is not on the page`);
  }
  if (expect.textGone !== undefined && (await probe.callGlobal<boolean>(main, 'hasText', expect.textGone))) {
    failures.push(`${quote(expect.textGone)} is still on the page`);
  }
  if (expect.value !== undefined || expect.checked !== undefined || expect.gone !== undefined) {
    if (!target) return { status: 'not_checked', detail: 'value, checked and gone need a target' };
    let state: ProbeState | null = null;
    try {
      state = await probe.call<ProbeState>(target.frame, target.objectId, 'state');
    } catch {
      state = null;
    }
    const gone = !state || !state.connected || !state.visible;
    if (expect.gone !== undefined && gone !== expect.gone)
      failures.push(gone ? 'the target is gone' : 'the target is still there');
    if (expect.value !== undefined && state?.value !== expect.value) {
      const hidden = masked || isSensitiveState(state, target.record.print.name);
      failures.push(hidden ? 'value differs (masked)' : `value is ${quote(state?.value ?? '')}`);
    }
    if (expect.checked !== undefined && state?.checked !== expect.checked)
      failures.push(`checked is ${state?.checked}`);
  }
  return failures.length ? { status: 'unmet', detail: failures.join('; ') } : { status: 'met' };
}

/**
 * Runs one dispatch between a baseline and settle, and fills the receipt's evidence fields. A dialog opened by the
 * action becomes a pending modal; a tab opened by it joins the session without becoming active.
 */
export async function withEvidence<T extends { dialog?: DialogInfo }>(
  ctx: ToolContext,
  target: ResolvedTarget | null,
  expect: Expectation | undefined,
  options: { masked?: boolean },
  dispatch: () => Promise<T>,
): Promise<{ outcome: T; evidence: EvidenceResult }> {
  const evidence = await Evidence.begin(ctx, target, options);
  let outcome: T;
  try {
    outcome = await dispatch();
  } catch (error) {
    evidence.dispose();
    throw error;
  }
  evidence.noteDialog(outcome.dialog);
  const result = await evidence.settle(expect);
  if (result.dialog) {
    const detail = dialogDetail(result.dialog);
    if (!ctx.tab().pending.some(p => p.kind === 'dialog' && p.detail === detail))
      ctx.tab().pending.push({ kind: 'dialog', detail });
  }
  // A tab the page opened for a disallowed URL was closed by the controller; it is not part of the result.
  if (result.newTab && !(await ctx.controller.host.tabs.get(result.newTab.tabId))) result.newTab = undefined;
  if (result.newTab) ctx.session.adoptTab(result.newTab.tabId);
  return { outcome, evidence: result };
}
