// Perception tier 1 capture: Accessibility.getFullAXTree per frame, on the frame's session.
// Observation is read-only: nothing here changes the page.
import type { CdpPort, FrameRecord, SessionId, TopologyPort } from '../ports';
import type { AXNode } from './ax';
import { LAYOUT_STYLES } from './layout';
import type { RawSnapshot } from './layout';
import { roleOf, valueOf } from './ax';

/** Limits: 20 frames, depth 5, minimum 10×10 px, ad frames skipped; 10 s per capture command. */
export const FRAME_LIMITS = { maxFrames: 20, maxDepth: 5, minSize: 10 };
export const CAPTURE_COMMAND_TIMEOUT_MS = 10_000;
const MAX_FIELD_LOOKUPS = 300;

/** DOM facts about a text field, read to decide masking (input type, autocomplete, name). */
export interface FieldFacts {
  tag: string;
  type?: string;
  autocomplete?: string;
  name?: string;
  id?: string;
}

export interface FrameCapture extends FrameRecord {
  /** The owner iframe element in the parent frame's document; null for the main frame. */
  ownerBackendNodeId: number | null;
  status: 'captured' | 'skipped' | 'failed';
  reason?: string;
  nodes: AXNode[];
  /** Keyed by backend node ID. */
  fields: Record<string, FieldFacts>;
}

export interface Viewport {
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
  contentWidth: number;
  contentHeight: number;
  /**
   * Device pixels per CSS pixel. The layout snapshot's bounds and scroll offsets are in device pixels; everything
   * else here is in CSS pixels. Absent in captures recorded before it was read: 1.
   */
  scale?: number;
}

/**
 * Device pixels per CSS pixel, from the two content sizes of `Page.getLayoutMetrics` (the deprecated one is in device
 * pixels). The longer side gives the better ratio.
 */
export function deviceScale(metrics: {
  contentSize?: { width: number; height: number };
  cssContentSize: { width: number; height: number };
}): number {
  const device = metrics.contentSize;
  const css = metrics.cssContentSize;
  if (!device) return 1;
  const ratio = css.height >= css.width ? device.height / css.height : device.width / css.width;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

export interface Capture {
  tabId: number;
  url: string;
  title: string;
  frames: FrameCapture[];
  viewport: Viewport | null;
  /** Tier 2: the raw layout snapshot of each session (key: session ID, '' for the root), when it was captured. */
  layout?: Record<string, RawSnapshot>;
  /** Why tier 2 is missing, when it is. */
  layoutError?: string;
  ms: number;
}

/** Domains the layer enables once per session and never disables. */
export async function enableDomains(cdp: CdpPort, sessionId: SessionId, enabled: Set<string>): Promise<void> {
  const key = sessionId ?? '';
  if (enabled.has(key)) return;
  await Promise.all([cdp.send(sessionId, 'DOM.enable'), cdp.send(sessionId, 'Accessibility.enable')]);
  enabled.add(key);
}

const FIELD_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);

function attributes(list: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; list && i + 1 < list.length; i += 2) out[list[i].toLowerCase()] = list[i + 1];
  return out;
}

async function fieldFacts(cdp: CdpPort, sessionId: SessionId, nodes: AXNode[]): Promise<Record<string, FieldFacts>> {
  const targets = nodes
    // A listbox has no value, but its attributes decide whether its options are masked (outline.ts).
    .filter(
      n => !n.ignored && n.backendDOMNodeId && ((FIELD_ROLES.has(roleOf(n)) && valueOf(n)) || roleOf(n) === 'listbox'),
    )
    .slice(0, MAX_FIELD_LOOKUPS);
  const out: Record<string, FieldFacts> = {};
  await Promise.all(
    targets.map(async n => {
      try {
        const { node } = await cdp.send<{ node: { nodeName: string; attributes?: string[] } }>(
          sessionId,
          'DOM.describeNode',
          { backendNodeId: n.backendDOMNodeId },
        );
        const a = attributes(node.attributes);
        out[String(n.backendDOMNodeId)] = {
          tag: node.nodeName.toLowerCase(),
          type: a.type?.toLowerCase(),
          autocomplete: a.autocomplete?.toLowerCase(),
          name: a.name,
          id: a.id,
        };
      } catch {
        // Unknown facts: the layout snapshot's attributes are used, or the value is masked (outline.ts).
      }
    }),
  );
  return out;
}

async function viewportOf(cdp: CdpPort): Promise<Viewport | null> {
  try {
    const m = await cdp.send<{
      cssLayoutViewport: { pageX: number; pageY: number; clientWidth: number; clientHeight: number };
      cssContentSize: { width: number; height: number };
      contentSize?: { width: number; height: number };
    }>(undefined, 'Page.getLayoutMetrics');
    return {
      scrollX: m.cssLayoutViewport.pageX,
      scrollY: m.cssLayoutViewport.pageY,
      width: m.cssLayoutViewport.clientWidth,
      height: m.cssLayoutViewport.clientHeight,
      contentWidth: m.cssContentSize.width,
      contentHeight: m.cssContentSize.height,
      scale: deviceScale(m),
    };
  } catch {
    return null;
  }
}

/** Decides which frames are captured, before any AX call. */
async function planFrames(cdp: CdpPort, frames: FrameRecord[]): Promise<FrameCapture[]> {
  const byId = new Map(frames.map(f => [f.frameId, f]));
  const planned = new Map<string, FrameCapture>();
  let captured = 0;
  for (const frame of frames) {
    const base: FrameCapture = { ...frame, ownerBackendNodeId: null, status: 'captured', nodes: [], fields: {} };
    planned.set(frame.frameId, base);
    if (!frame.parentFrameId) {
      captured++;
      continue;
    }
    const parent = planned.get(frame.parentFrameId);
    const parentRecord = byId.get(frame.parentFrameId);
    const skip = (reason: string) => Object.assign(base, { status: 'skipped', reason });
    if (!parent || !parentRecord) {
      skip('its parent frame is unknown');
      continue;
    }
    try {
      const { backendNodeId } = await cdp.send<{ backendNodeId: number }>(parentRecord.sessionId, 'DOM.getFrameOwner', {
        frameId: frame.frameId,
      });
      base.ownerBackendNodeId = backendNodeId;
    } catch {
      // The owner is not in the parent's DOM any more; the frame is going away.
    }
    if (parent.status !== 'captured') {
      skip('inside a frame that was not captured');
      continue;
    }
    if (frame.adFrame) {
      skip('ad frame (skipped by policy)');
      continue;
    }
    if (frame.depth > FRAME_LIMITS.maxDepth) {
      skip(`nested deeper than ${FRAME_LIMITS.maxDepth}`);
      continue;
    }
    if (base.ownerBackendNodeId === null) {
      skip('its iframe element is gone');
      continue;
    }
    try {
      const { model } = await cdp.send<{ model: { width: number; height: number } }>(
        parentRecord.sessionId,
        'DOM.getBoxModel',
        { backendNodeId: base.ownerBackendNodeId },
      );
      if (model.width < FRAME_LIMITS.minSize || model.height < FRAME_LIMITS.minSize) {
        skip(`smaller than ${FRAME_LIMITS.minSize}×${FRAME_LIMITS.minSize} px`);
        continue;
      }
    } catch {
      skip('not rendered');
      continue;
    }
    if (captured >= FRAME_LIMITS.maxFrames) {
      skip(`more than ${FRAME_LIMITS.maxFrames} frames`);
      continue;
    }
    captured++;
  }
  return [...planned.values()];
}

export interface CaptureState {
  /** Sessions whose domains are enabled; kept per attachment. */
  enabledSessions: Set<string>;
  /** Test hook: make the layout snapshot fail, to check the tier 1 fallback (fixture set D). */
  failLayout?: boolean;
}

/** Tier 2: DOMSnapshot.captureSnapshot per session that has a captured frame. */
async function captureLayout(
  cdp: CdpPort,
  frames: FrameCapture[],
  state: CaptureState,
): Promise<{ layout?: Record<string, RawSnapshot>; error?: string }> {
  if (state.failLayout) return { error: 'the layout snapshot failed (test hook)' };
  const sessions = [...new Set(frames.filter(f => f.status === 'captured').map(f => f.sessionId))];
  try {
    const entries = await Promise.all(
      sessions.map(async sessionId => {
        const snapshot = await cdp.send<RawSnapshot>(
          sessionId,
          'DOMSnapshot.captureSnapshot',
          { computedStyles: [...LAYOUT_STYLES], includeDOMRects: true, includePaintOrder: false },
          CAPTURE_COMMAND_TIMEOUT_MS,
        );
        return [sessionId ?? '', snapshot] as const;
      }),
    );
    return { layout: Object.fromEntries(entries) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function captureTier1(
  tabId: number,
  cdp: CdpPort,
  topology: TopologyPort,
  state: CaptureState,
): Promise<Capture> {
  const start = performance.now();
  const frames = await topology.frames();
  await Promise.all([...new Set(frames.map(f => f.sessionId))].map(s => enableDomains(cdp, s, state.enabledSessions)));
  const planned = await planFrames(cdp, frames);
  const layoutPromise = captureLayout(cdp, planned, state);
  await Promise.all(
    planned
      .filter(f => f.status === 'captured')
      .map(async frame => {
        try {
          const { nodes } = await cdp.send<{ nodes: AXNode[] }>(
            frame.sessionId,
            'Accessibility.getFullAXTree',
            { frameId: frame.frameId },
            CAPTURE_COMMAND_TIMEOUT_MS,
          );
          frame.nodes = nodes;
          frame.fields = await fieldFacts(cdp, frame.sessionId, nodes);
        } catch (error) {
          frame.status = 'failed';
          frame.reason = error instanceof Error ? error.message : String(error);
        }
      }),
  );
  const viewport = await viewportOf(cdp);
  const layout = await layoutPromise;
  const main = planned[0];
  const root = main?.nodes.find(n => roleOf(n) === 'RootWebArea');
  return {
    tabId,
    url: main?.url ?? '',
    title: typeof root?.name?.value === 'string' ? root.name.value : '',
    frames: planned,
    viewport,
    layout: layout.layout,
    layoutError: layout.error,
    ms: Math.round(performance.now() - start),
  };
}
