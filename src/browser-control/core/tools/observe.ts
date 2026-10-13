// The read-only tools: snapshot, find, read, screenshot. Observation is read-only.
import { LayerError } from '../../protocol/errors';
import type { FindArgs, ReadArgs, ScreenshotArgs, SnapshotArgs } from '../../protocol/schemas';
import type { FindMatch, ScreenshotData, SnapshotData } from '../../protocol/results';
import type { ToolContext, ToolOutcome } from '../controller';
import { lookupRef } from '../refs';
import type { RefRecord, Shown } from '../refs';
import { captureTier1 } from '../perception/capture';
import { buildObservation } from '../perception/observe';
import type { Observation } from '../perception/observe';
import type { ONode } from '../perception/outline';
import { renderLine } from '../perception/outline';
import { renderContent, sliceContent } from '../perception/read';
import { cleanText } from '../perception/ax';
import { quadBounds, scrollOffset, topLevelQuad } from '../geometry';
import { blankBoxes, drawLabels, presentedBoxes } from './labels';
import { compactOps, diffLines, renderDiff } from '../perception/diff';
import type { FrameRecord } from '../ports';
import { rememberSecret } from '../redact';
import { quote } from '../text';

/** A capture is reused by read-only helpers only right after it, with no action in between. */
const REUSE_MS = 2_000;

/** The refs with the print this observation showed for each. */
function shownOf(observation: Observation, refs: string[]): Array<[string, Shown]> {
  return refs.flatMap(ref => {
    const what = observation.shown.get(ref);
    return what ? [[ref, what] as [string, Shown]] : [];
  });
}

/** Captures the tab and builds an observation. Does not change the session's known set. */
export async function observeTab(
  ctx: ToolContext,
  options: { mode?: 'interactive' | 'all'; scope?: RefRecord; window?: 'viewport' | 'near' | 'page' } = {},
): Promise<Observation> {
  const attachment = await ctx.attach();
  const tab = ctx.tab();
  const capture = await captureTier1(tab.tabId, attachment.cdp, attachment.topology, tab.capture);
  ctx.controller.registry.reconcile(tab.tabId, capture.frames);
  if (capture.frames[0]?.status !== 'captured') {
    ctx.session.known.replace(tab.tabId, []);
    throw new LayerError(
      'CAPTURE_FAILED',
      `The page could not be captured: ${capture.frames[0]?.reason ?? 'no main frame'}`,
    );
  }
  const observation = buildObservation(capture, ctx.controller.registry, {
    mode: options.mode ?? 'all',
    window: options.window,
    scope: options.scope ? { frameId: options.scope.frameId, backendNodeId: options.scope.backendNodeId } : undefined,
    budget: ctx.session.config.budget,
  });
  for (const secret of observation.secrets) rememberSecret(tab.secrets, secret);
  if (!options.scope && (options.mode ?? 'all') === 'all') {
    tab.last = {
      observation,
      actionSeq: tab.actionSeq,
      at: Date.now(),
      loaders: capture.frames.map(f => [f.frameId, f.loaderId] as [string, string]),
    };
  }
  return observation;
}

/** The last full observation if it may be reused, else a new one. */
export async function recentObservation(ctx: ToolContext): Promise<Observation> {
  const tab = ctx.tab();
  const last = tab.last;
  if (last && last.actionSeq === tab.actionSeq && Date.now() - last.at < REUSE_MS && tab.attachment) {
    // Reuse only if no frame has loaded a new document since (a reload by the page or the user is not an action).
    const frames = await tab.attachment.topology.frames();
    const loaders = new Map(frames.map(f => [f.frameId, f.loaderId]));
    if (last.loaders.every(([frameId, loaderId]) => loaders.get(frameId) === loaderId)) return last.observation;
  }
  return observeTab(ctx);
}

export async function snapshot(
  ctx: ToolContext,
  args: SnapshotArgs,
  as: 'full' | 'diff' = 'full',
): Promise<ToolOutcome<SnapshotData>> {
  const tab = ctx.tab();
  const scope = args.scope ? lookupRef(ctx.controller.registry, ctx.session.known, args.scope, tab.tabId) : undefined;
  const observation = await observeTab(ctx, { mode: args.mode, scope, window: args.window });
  const previous = ctx.session.seen.get(tab.tabId);
  if (scope) ctx.session.known.add(tab.tabId, shownOf(observation, observation.refs));
  // A full outline, or a diff against it, leaves the known set equal to the fresh outline's refs: refs added by a
  // diff are accepted, refs it removed are not.
  else ctx.session.known.replace(tab.tabId, shownOf(observation, observation.refs));
  tab.rev++;
  const notices = [...observation.notices];
  const snapshotText = `${observation.header}\n${observation.body}`;
  const lines = snapshotText.split('\n');
  const data: SnapshotData = {
    status: observation.status,
    refs: observation.refs.length,
    frames: observation.frames,
    notices,
    captureMs: observation.captureMs,
  };
  const page = { tabId: tab.tabId, url: observation.url, title: observation.title, rev: tab.rev };
  if (!scope) ctx.session.seen.set(tab.tabId, { rev: tab.rev, lines });
  if (as === 'diff' && !scope && previous) {
    const ops = diffLines(previous.lines, lines);
    const changedLines = ops ? ops.filter(o => o.op !== 'keep').length : Infinity;
    // A diff larger than half the outline is no saving: the full outline is returned instead.
    if (ops && changedLines <= Math.max(10, lines.length / 2)) {
      const diff = renderDiff(ops, previous.rev);
      return {
        page: { ...page, changed: 'diff', snapshot: diff.text, diff: { since: previous.rev, ops: compactOps(ops) } },
        data: {
          ...data,
          diff: { since: previous.rev, ops: compactOps(ops), added: diff.added, removed: diff.removed },
        },
        lines: [
          `diff · tab ${tab.tabId} · rev ${previous.rev} → ${tab.rev} · +${diff.added.length} −${diff.removed.length} ~${diff.changed} refs`,
        ],
        pageText: diff.text,
        notices,
      };
    }
    notices.push('The changes are larger than half the outline; the full outline is returned.');
  } else if (as === 'diff' && !scope) {
    notices.push('No earlier outline of this tab was seen; the full outline is returned.');
  }
  return {
    page: { ...page, changed: 'full', snapshot: snapshotText },
    data,
    lines: [`snapshot · tab ${tab.tabId} · rev ${tab.rev} · ${observation.refs.length} refs`],
    pageText: snapshotText,
    notices: notices.filter(Boolean),
  };
}

function findNode(nodes: ONode[], frameId: string, backendNodeId: number): ONode | undefined {
  for (const n of nodes) {
    if (n.frameId === frameId && n.backendNodeId === backendNodeId) return n;
    const inner = findNode(n.children, frameId, backendNodeId);
    if (inner) return inner;
  }
  return undefined;
}

function actionableNodes(nodes: ONode[], out: ONode[] = []): ONode[] {
  for (const n of nodes) {
    if (n.ref) out.push(n);
    actionableNodes(n.children, out);
  }
  return out;
}

export async function find(ctx: ToolContext, args: FindArgs): Promise<ToolOutcome<FindMatch[]>> {
  if (!args.role && !args.name && !args.text) {
    throw new LayerError('INVALID_ARGUMENT', 'find needs at least one of role, name or text');
  }
  const tab = ctx.tab();
  const observation = await recentObservation(ctx);
  let roots = observation.tree;
  if (args.within) {
    const within = lookupRef(ctx.controller.registry, ctx.session.known, args.within, tab.tabId);
    const node = findNode(roots, within.frameId, within.backendNodeId);
    if (!node) throw new LayerError('NODE_DETACHED', `Ref ${args.within} is no longer in the page`);
    roots = node.children;
  }
  const role = args.role?.toLowerCase();
  const name = args.name ? cleanText(args.name).toLowerCase() : undefined;
  const text = args.text ? cleanText(args.text).toLowerCase() : undefined;
  const matches = actionableNodes(roots).filter(
    n =>
      (!role || n.role.toLowerCase() === role || n.rawRole.toLowerCase() === role) &&
      (!name || n.name.toLowerCase().includes(name)) &&
      (!text || n.name.toLowerCase().includes(text) || (!n.masked && (n.value ?? '').toLowerCase().includes(text))),
  );
  const limit = args.limit ?? 20;
  const shown = matches.slice(0, limit);
  // The baseline is what this observation shows, even when it is a reused one.
  ctx.session.known.add(
    tab.tabId,
    shownOf(
      observation,
      shown.map(n => n.ref!),
    ),
  );
  const data = shown.map(n => ({ ref: n.ref!, line: renderLine(n), tabId: tab.tabId }));
  const notices =
    matches.length > limit ? [`… ${matches.length - limit} more matches; raise limit or narrow the query.`] : [];
  return {
    data,
    lines: [`find · tab ${tab.tabId} · ${matches.length} match${matches.length === 1 ? '' : 'es'}`],
    pageText: data.length ? data.map(d => d.line).join('\n') : undefined,
    notices,
  };
}

export async function read(
  ctx: ToolContext,
  args: ReadArgs,
): Promise<ToolOutcome<{ content: string; offset: number; remaining: number }>> {
  const tab = ctx.tab();
  const observation = await recentObservation(ctx);
  let roots = observation.tree;
  if (args.ref) {
    const record = lookupRef(ctx.controller.registry, ctx.session.known, args.ref, tab.tabId);
    const node = findNode(roots, record.frameId, record.backendNodeId);
    if (!node) throw new LayerError('NODE_DETACHED', `Ref ${args.ref} is no longer in the page`);
    roots = [node];
  }
  const content = renderContent(roots, args.format ?? 'markdown');
  const offset = args.offset ?? 0;
  const { text, remaining } = sliceContent(content, offset, args.maxChars ?? 20_000);
  const notices = remaining ? [`… ${remaining} more characters; continue with offset ${offset + text.length}.`] : [];
  return {
    data: { content: text, offset, remaining },
    lines: [`read · tab ${tab.tabId} · ${quote(observation.title)} · ${text.length} characters`],
    pageText: text,
    notices,
  };
}

export async function screenshot(ctx: ToolContext, args: ScreenshotArgs): Promise<ToolOutcome<ScreenshotData>> {
  const attachment = await ctx.attach();
  const tab = ctx.tab();
  const { cdp } = attachment;
  const frames = await attachment.topology.frames();
  const scroll = await scrollOffset(cdp, undefined);
  let clip: { x: number; y: number; width: number; height: number } | undefined;
  let origin = { x: scroll.x, y: scroll.y };
  if (args.ref) {
    const record = lookupRef(ctx.controller.registry, ctx.session.known, args.ref, tab.tabId);
    const frame = frames.find(f => f.frameId === record.frameId);
    if (!frame) throw new LayerError('FRAME_DETACHED', `The frame of ${args.ref} is gone`);
    const quad = await topLevelQuad(cdp, frames, frame, record.backendNodeId, root =>
      tab.probe!.callGlobal(root, 'viewport'),
    );
    if (!quad) throw new LayerError('NOT_VISIBLE', `${args.ref} has no box to capture`);
    const b = quadBounds(quad);
    // Page.captureScreenshot clips in document coordinates; quads are viewport coordinates.
    clip = { x: b.x + scroll.x, y: b.y + scroll.y, width: Math.max(1, b.width), height: Math.max(1, b.height) };
    origin = { x: clip.x, y: clip.y };
  } else if (args.fullPage) {
    origin = { x: 0, y: 0 };
  }
  // The outline says which field values are masked; the image hides the same ones.
  const observation = await recentObservation(ctx);
  const shot = await attachment.page.screenshot({ fullPage: !args.ref && args.fullPage, clip });
  // A clipped image is as wide as its clip. A viewport image is as wide as the viewport with its scrollbar, which
  // the layout viewport of Page.getLayoutMetrics leaves out, so that width is read in the page (the probe).
  let cssWidth = clip?.width;
  if (cssWidth === undefined) {
    cssWidth = args.fullPage
      ? (await cdp.send<{ cssContentSize: { width: number } }>(undefined, 'Page.getLayoutMetrics')).cssContentSize.width
      : (await tab.probe!.callGlobal<{ width: number }>(frames[0], 'viewport')).width;
  }
  const scale = shot.width / Math.max(1, cssWidth);
  let base64 = shot.base64;
  try {
    const hidden = [...hiddenNodes(observation.tree), ...observation.unplaced];
    base64 = await blankBoxes(base64, await boxesOf(ctx, hidden, frames, origin, true), scale);
  } catch (error) {
    // The next screenshot captures afresh rather than reuse an observation the page has moved on from.
    tab.last = undefined;
    throw new LayerError(
      'CAPTURE_FAILED',
      `The screenshot could not be returned with its sensitive values masked: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let labelled = 0;
  if (args.labels) {
    // Only what the image shows is presented: a ref outside a cropped image keeps the baseline it had.
    const image = clip ?? { width: shot.width / scale, height: shot.height / scale };
    const boxes = presentedBoxes(await boxesOf(ctx, observation.entries.slice(0, 300), frames, origin), image);
    labelled = boxes.length;
    base64 = await drawLabels(base64, boxes, scale);
    ctx.session.known.add(
      tab.tabId,
      shownOf(
        observation,
        boxes.map(b => b.ref),
      ),
    );
  }
  return {
    data: { mimeType: 'image/png', base64, width: shot.width, height: shot.height, scale, origin },
    lines: [
      `screenshot · tab ${tab.tabId} · ${shot.width}×${shot.height} px · scale ${scale.toFixed(2)}${args.labels ? ` · ${labelled} labels` : ''}`,
    ],
  };
}

/** Nodes a screenshot paints over: masked values and options, and frames whose content was not captured or placed. */
function hiddenNodes(roots: ONode[]): Array<{ frameId: string; backendNodeId: number }> {
  const out: Array<{ frameId: string; backendNodeId: number }> = [];
  const walk = (n: ONode) => {
    if ((n.masked || n.unseen) && n.backendNodeId !== undefined)
      out.push({ frameId: n.frameId, backendNodeId: n.backendNodeId });
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

/**
 * The boxes of the given nodes in CSS pixels relative to the image's top-left. With `required` (the nodes a
 * screenshot paints over), a node without a box must still be in its document, where it is not shown; one that has
 * left it was re-rendered after the capture, and its replacement may show the value, so the image fails.
 */
async function boxesOf<T extends { frameId: string; backendNodeId: number; ref?: string }>(
  ctx: ToolContext,
  nodes: T[],
  frames: FrameRecord[],
  origin: { x: number; y: number },
  required = false,
): Promise<Array<{ ref: string; x: number; y: number; width: number; height: number }>> {
  const attachment = await ctx.attach();
  const scroll = await scrollOffset(attachment.cdp, undefined);
  const boxes = await Promise.all(
    nodes.map(async e => {
      const frame = frames.find(f => f.frameId === e.frameId);
      if (!frame) return null;
      const quad = await topLevelQuad(attachment.cdp, frames, frame, e.backendNodeId, root =>
        ctx.tab().probe!.callGlobal(root, 'viewport'),
      ).catch(() => null);
      if (!quad && required && !(await inDocument(ctx, frame, e.backendNodeId))) {
        throw new Error('a masked element left the page after the capture; take the screenshot again');
      }
      if (!quad) return null;
      const b = quadBounds(quad);
      return {
        ref: e.ref ?? '',
        x: b.x + scroll.x - origin.x,
        y: b.y + scroll.y - origin.y,
        width: b.width,
        height: b.height,
      };
    }),
  );
  return boxes.filter((b): b is NonNullable<typeof b> => b !== null && b.width > 0 && b.height > 0);
}

/** Whether a node is still in its frame's document (read in the probe's world, which the page cannot change). */
async function inDocument(ctx: ToolContext, frame: FrameRecord, backendNodeId: number): Promise<boolean> {
  const probe = ctx.tab().probe;
  if (!probe) return false;
  let objectId: string;
  try {
    objectId = await probe.resolve(frame, backendNodeId);
  } catch {
    return false;
  }
  try {
    const { result } = await (
      await ctx.attach()
    ).cdp.send<{ result: { value?: unknown } }>(frame.sessionId, 'Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: 'function () { return this.isConnected; }',
      returnByValue: true,
    });
    return result.value === true;
  } catch {
    return false;
  } finally {
    await probe.release(frame, objectId);
  }
}
