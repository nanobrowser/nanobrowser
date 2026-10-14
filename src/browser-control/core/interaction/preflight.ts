// Policy layer 2: before dispatch, the probe reports where the target would navigate, and a disallowed destination is
// URL_NOT_ALLOWED with nothing dispatched. Covers links that open a new tab.
import { LayerError } from '../../protocol/errors';
import type { NavigationTarget } from '../../probe';
import type { ToolContext } from '../controller';
import type { FrameRecord } from '../ports';
import { quote } from '../text';

export async function preflightNavigation(
  ctx: ToolContext,
  frame: FrameRecord,
  objectId: string,
  mode: 'activate' | 'enter',
  description: string,
): Promise<NavigationTarget | null> {
  const probe = ctx.tab().probe!;
  const nav = await probe.call<NavigationTarget | null>(frame, objectId, 'navigationTarget', mode).catch(() => null);
  if (!nav) return null;
  // The policy applies to main-frame documents: a link inside a frame that targets its own frame does not.
  if (frame.parentFrameId && !nav.newTab) return nav;
  if (!ctx.controller.allowedFor(ctx.tab().tabId)(nav.url)) {
    const what =
      nav.kind === 'link' ? `links to ${quote(nav.url)}` : `submits the form to ${quote(nav.url)} (${nav.method})`;
    throw new LayerError(
      'URL_NOT_ALLOWED',
      `${description} ${what}${nav.newTab ? ' in a new tab' : ''}, which is not allowed. Nothing was dispatched.`,
      {
        delivered: false,
      },
    );
  }
  return nav;
}

/**
 * The focused element: the deepest frame whose document has focus, and its active element. The probe follows open
 * shadow roots; closed ones hide their active element from page script, so the controller resolves each closed root
 * through CDP (which can reach it) and asks the probe for the root's active element (the element classified is the
 * element the key goes to, not its shadow host).
 */
export async function focusedElement(
  ctx: ToolContext,
): Promise<{ frame: FrameRecord; objectId: string; backendNodeId: number } | null> {
  const attachment = await ctx.attach();
  const frames = [...(await attachment.topology.frames())].sort((a, b) => b.depth - a.depth);
  for (const frame of frames) {
    const found = await ctx
      .tab()
      .probe!.focusedIn(frame)
      .catch(() => null);
    if (found) return { frame, ...(await throughShadowRoots(ctx, frame, found)) };
  }
  return null;
}

/** Descends from a focused shadow host into its shadow roots' active elements, closed roots included. */
async function throughShadowRoots(
  ctx: ToolContext,
  frame: FrameRecord,
  start: { objectId: string; backendNodeId: number },
): Promise<{ objectId: string; backendNodeId: number }> {
  const { cdp } = await ctx.attach();
  const probe = ctx.tab().probe!;
  let current = start;
  // Shadow roots nest; a bound keeps a page from making this loop forever.
  for (let depth = 0; depth < 32; depth++) {
    const { node } = await cdp
      .send<{ node: { shadowRoots?: Array<{ backendNodeId: number; shadowRootType?: string }> } }>(
        frame.sessionId,
        'DOM.describeNode',
        { backendNodeId: current.backendNodeId, depth: 1, pierce: true },
      )
      .catch(() => ({ node: {} as { shadowRoots?: Array<{ backendNodeId: number; shadowRootType?: string }> } }));
    const root = node.shadowRoots?.find(r => r.shadowRootType !== 'user-agent');
    if (!root) return current;
    let rootObject: string;
    try {
      rootObject = await probe.resolve(frame, root.backendNodeId);
    } catch {
      return current;
    }
    try {
      const inner = await probe.callForNode(frame, rootObject, 'activeIn').catch(() => null);
      if (!inner || inner === current.backendNodeId) return current;
      const objectId = await probe.resolve(frame, inner);
      await probe.release(frame, current.objectId);
      current = { objectId, backendNodeId: inner };
    } finally {
      await probe.release(frame, rootObject);
    }
  }
  return current;
}
