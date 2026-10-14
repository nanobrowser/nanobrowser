// `navigate` and the navigating actions of `tabs`. Layer 1 of the policy runs here, before any command is sent; layers
// 3 and 4 run in the tab's NavigationGuard.
import { LayerError } from '../../protocol/errors';
import type { NavigateArgs, Observe, TabsArgs } from '../../protocol/schemas';
import type { TabsData } from '../../protocol/results';
import type { ToolContext, ToolOutcome } from '../controller';
import { toProtocolError } from '../controller';
import type { CdpPort, TabAttachment } from '../ports';
import type { PolicyEvent } from '../navigation-guard';
import { SAFE_URL } from '../navigation-guard';
import { allows } from '../url-policy';
import { snapshot } from './observe';
import { sessionTabs } from './tabs';
import { quote } from '../text';

/** DOMContentLoaded plus network idle, capped at 5 s. */
const NAVIGATION_BUDGET_MS = 5_000;
const NAVIGATION_TIMEOUT_MS = 30_000;

function parseUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    throw new LayerError('INVALID_ARGUMENT', `Not an absolute URL: ${quote(url)}`);
  }
}

/** Waits for Chrome's networkIdle lifecycle event of the main frame's next document, or the budget. */
function trackReadiness(cdp: CdpPort, mainFrameId: () => string, start: number) {
  let idle = false;
  let wake: (() => void) | null = null;
  const off = cdp.on(
    'Page.lifecycleEvent',
    params => {
      const p = params as { frameId: string; name: string };
      if (p.frameId !== mainFrameId()) return;
      if (p.name === 'init') idle = false;
      if (p.name === 'networkIdle') {
        idle = true;
        wake?.();
      }
    },
    { sessionId: undefined },
  );
  return {
    async wait(): Promise<'network idle' | 'budget'> {
      const left = NAVIGATION_BUDGET_MS - (performance.now() - start);
      if (!idle && left > 0) await new Promise<void>(resolve => ((wake = resolve), setTimeout(resolve, left)));
      return idle ? 'network idle' : 'budget';
    },
    /** Removes the listener; called on every exit, a failed navigation included. */
    dispose: off,
  };
}

function policyError(events: PolicyEvent[], currentUrl: string): LayerError {
  const lines = events.map(e => e.detail);
  if (events.some(e => e.layer === 3))
    lines.push(`The page stayed on ${quote(currentUrl)}. Nothing was sent to the blocked address.`);
  return new LayerError('URL_NOT_ALLOWED', lines.join(' '), {
    delivered: false,
    details: events,
  });
}

/** Runs a navigation, waits for readiness, and turns policy events into URL_NOT_ALLOWED. */
async function runNavigation(
  ctx: ToolContext,
  attachment: TabAttachment,
  go: () => Promise<void>,
): Promise<{ url: string; title: string; readiness: string }> {
  const tab = ctx.tab();
  tab.guard?.drain();
  const start = performance.now();
  const readiness = trackReadiness(attachment.cdp, () => attachment.topology.mainFrameId(), start);
  tab.actionSeq++;
  let failure: unknown;
  try {
    try {
      await go();
    } catch (error) {
      failure = error;
    }
    const ready = failure ? 'failed' : await readiness.wait();
    const events = tab.guard?.drain() ?? [];
    const current = await ctx.controller.host.tabs.get(tab.tabId);
    if (events.length) throw policyError(events, current?.url ?? '');
    if (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      if (/timeout/i.test(message)) throw new LayerError('TIMEOUT', quote(message, 300), { delivered: 'unknown' });
      // The debugger detached or the tab left the session while it loaded: those errors say more.
      if (failure instanceof LayerError) throw failure;
      throw new LayerError('NAVIGATION_FAILED', `The navigation failed: ${quote(message, 300)}`, {
        delivered: 'unknown',
      });
    }
    return { url: current?.url ?? '', title: current?.title ?? '', readiness: ready };
  } finally {
    readiness.dispose();
  }
}

/**
 * Returns page state after an action when the request (or the session default) asks for it. The action has already
 * happened: if the page cannot be observed, the result keeps the receipt and reports the failure as `pageError`,
 * never as the call's error, which would say nothing was dispatched.
 */
export async function withPageState(
  ctx: ToolContext,
  observe: Observe | undefined,
  outcome: ToolOutcome,
): Promise<ToolOutcome> {
  const mode = observe ?? ctx.session.config.observeDefault;
  if (mode === 'none') return outcome;
  let snap: ToolOutcome;
  try {
    // A dialog the action opened blocks the renderer: a capture would only time out.
    const dialog = ctx.tab().pending.find(m => m.kind === 'dialog');
    if (dialog) {
      throw new LayerError('MODAL_PENDING', `A dialog is open: ${dialog.detail}. Use handle_dialog, then observe.`);
    }
    snap = await snapshot(ctx, {}, mode === 'diff' ? 'diff' : 'full');
  } catch (error) {
    return { ...outcome, pageError: toProtocolError(error, true) };
  }
  const notices = [...(outcome.notices ?? []), ...(snap.notices ?? [])];
  return {
    ...outcome,
    page: snap.page,
    pageText: snap.pageText,
    notices,
    lines: [...(outcome.lines ?? []), ...(snap.lines ?? [])],
  };
}

export async function navigate(ctx: ToolContext, args: NavigateArgs): Promise<ToolOutcome> {
  if (!!args.url === !!args.action)
    throw new LayerError('INVALID_ARGUMENT', 'navigate needs exactly one of url or action');
  const tab = ctx.tab();
  const allowed = ctx.controller.allowedFor(tab.tabId);
  const timeout = args.timeoutMs ?? NAVIGATION_TIMEOUT_MS;
  let target: string;
  // Layer 1: the destination is checked before any command is sent.
  if (args.url) {
    target = parseUrl(args.url);
    if (!allowed(target)) throw new LayerError('URL_NOT_ALLOWED', `${quote(target)} is not allowed. Nothing was sent.`);
  }
  let attachment: TabAttachment;
  try {
    attachment = await ctx.attach();
  } catch (error) {
    if (!args.url || !(error instanceof LayerError) || error.code !== 'PAGE_NOT_SUPPORTED') throw error;
    return navigateFromRestricted(ctx, args, target!, allowed, timeout);
  }
  if (args.action === 'back' || args.action === 'forward') {
    const history = await attachment.cdp.send<{ currentIndex: number; entries: Array<{ url: string }> }>(
      undefined,
      'Page.getNavigationHistory',
    );
    const entry = history.entries[history.currentIndex + (args.action === 'back' ? -1 : 1)];
    if (!entry) throw new LayerError('INVALID_ARGUMENT', `There is no page to go ${args.action} to`);
    target = entry.url;
    if (!allowed(target)) throw new LayerError('URL_NOT_ALLOWED', `${quote(target)} is not allowed. Nothing was sent.`);
  } else if (args.action === 'reload') {
    target = (await ctx.controller.host.tabs.get(tab.tabId))?.url ?? '';
    if (!allowed(target)) throw new LayerError('URL_NOT_ALLOWED', `${quote(target)} is not allowed. Nothing was sent.`);
  }
  const page = attachment.page;
  const result = await runNavigation(ctx, attachment, () =>
    args.url
      ? page.goto(target, timeout)
      : args.action === 'back'
        ? page.goBack(timeout)
        : args.action === 'forward'
          ? page.goForward(timeout)
          : page.reload(timeout),
  );
  return withPageState(ctx, args.observe, {
    data: { url: result.url, title: result.title, readiness: result.readiness },
    page: { tabId: tab.tabId, url: result.url, title: result.title, rev: tab.rev, changed: 'none' },
    lines: [`navigate · tab ${tab.tabId} · ${args.url ? 'url' : args.action} · ${result.readiness}`],
    pageText: `${result.title || '(untitled)'} · ${result.url}`,
  });
}

/**
 * `navigate` with a URL from a page the debugger cannot attach to (chrome://, the Web Store): the URL is loaded
 * through chrome.tabs, and the tab is attached once it has loaded. Layer 1 has checked the URL; layer 3 cannot pause
 * the first request or its redirects, since no debugger is attached yet, so the address the tab ends on is checked
 * after the load, as layer 4 does (a known gap).
 */
async function navigateFromRestricted(
  ctx: ToolContext,
  args: NavigateArgs,
  target: string,
  allowed: (url: string) => boolean,
  timeout: number,
): Promise<ToolOutcome> {
  const tab = ctx.tab();
  const tabs = ctx.controller.host.tabs;
  if (!tabs.load) throw new LayerError('PAGE_NOT_SUPPORTED', `Tab ${tab.tabId} shows a page that cannot be controlled`);
  tab.actionSeq++;
  await tabs.load(tab.tabId, target, timeout);
  let attachment: TabAttachment;
  try {
    attachment = await ctx.attach();
  } catch (error) {
    if (!(error instanceof LayerError) || error.code !== 'PAGE_NOT_SUPPORTED') throw error;
    const now = await tabs.get(tab.tabId);
    throw new LayerError('NAVIGATION_FAILED', `The tab loaded ${quote(now?.url ?? '')}, which cannot be controlled`, {
      delivered: true,
    });
  }
  const current = await tabs.get(tab.tabId);
  const url = current?.url ?? '';
  if (!allowed(url)) {
    await attachment.cdp.send(undefined, 'Page.navigate', { url: SAFE_URL }).catch(() => undefined);
    throw new LayerError(
      'URL_NOT_ALLOWED',
      `${quote(url)} was loaded although it is not allowed; the tab was sent to ${SAFE_URL}. The tab was loaded from a page the debugger cannot attach to, so its requests were not checked before they were sent.`,
      { delivered: true },
    );
  }
  return withPageState(ctx, args.observe, {
    data: { url, title: current?.title ?? '', readiness: 'load' },
    page: { tabId: tab.tabId, url, title: current?.title ?? '', rev: tab.rev, changed: 'none' },
    lines: [`navigate · tab ${tab.tabId} · url · load (through chrome.tabs)`],
    pageText: `${current?.title || '(untitled)'} · ${url}`,
  });
}

/** `tabs open`: the tab starts blank and is attached before its first request, so layer 3 covers it from the start. */
export async function openTab(ctx: ToolContext, args: TabsArgs): Promise<ToolOutcome<TabsData & { opened: number }>> {
  const url = args.url ? parseUrl(args.url) : SAFE_URL;
  // Layer 1: the new tab belongs to this session only, so its policy decides.
  if (!allows(ctx.session.urlPolicy, url)) {
    throw new LayerError('URL_NOT_ALLOWED', `${quote(url)} is not allowed. No tab was opened.`);
  }
  // In the background unless the host shows it, next to the tab the session works in.
  const tab = await ctx.controller.host.tabs.open(SAFE_URL, {
    active: await ctx.session.shouldReveal(null),
    openerTabId: ctx.session.activeTabId ?? undefined,
  });
  ctx.session.shareTab(tab.tabId, 'opened');
  const attachment = await ctx.controller.attach(tab.tabId);
  const child: ToolContext = {
    ...ctx,
    tabId: tab.tabId,
    tab: () => ctx.controller.tabState(tab.tabId),
    attach: () => ctx.controller.attach(tab.tabId),
  };
  if (url !== SAFE_URL) await runNavigation(child, attachment, () => attachment.page.goto(url, NAVIGATION_TIMEOUT_MS));
  const data = { ...(await sessionTabs(ctx)), opened: tab.tabId };
  return { data, lines: [`tabs open · tab ${tab.tabId} · ${quote(url)}`] };
}

export async function closeTab(ctx: ToolContext, args: TabsArgs): Promise<ToolOutcome<TabsData>> {
  const tabId = args.tabId ?? ctx.session.activeTabId;
  if (tabId === null || tabId === undefined || !ctx.session.hasTab(tabId)) {
    throw new LayerError('TAB_NOT_IN_SESSION', `Tab ${tabId} is not in the session`);
  }
  await ctx.controller.host.tabs.close(tabId);
  // Released, not only forgotten: a tab that stays open (its page asked "Leave site?" and the user stayed) must not
  // keep the debugger when no session holds it.
  await ctx.session.unshareTab(tabId);
  const data = await sessionTabs(ctx);
  return { data, lines: [`tabs close · tab ${tabId}`] };
}
