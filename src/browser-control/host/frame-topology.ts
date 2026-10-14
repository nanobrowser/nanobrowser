// FrameTopology: the only code that reads Puppeteer's frame objects.
// Frame, parent and session IDs come from Puppeteer's frame manager. The loader ID comes from Page.getFrameTree
// on the frame's session, because Puppeteer's own is empty for documents that committed before it attached.
import type { CdpPort, FrameEvent, FrameRecord, SessionId, TopologyPort } from '../core/ports';
import { normalizeSessionId, sendRaw } from './cdp-session';
import type { Frame, Page, PageEvent } from './puppeteer';

// PageEvent is a const enum, which isolated modules cannot read at runtime; its values are these strings.
const FRAME_ATTACHED = 'frameattached' as PageEvent.FrameAttached;
const FRAME_NAVIGATED = 'framenavigated' as PageEvent.FrameNavigated;
const FRAME_DETACHED = 'framedetached' as PageEvent.FrameDetached;

/** The internal accessors relied on. A Puppeteer upgrade that changes them must fail loudly. */
interface CdpFrameInternals {
  _id: string;
  _parentId?: string;
  _client(): { id(): string };
}

export interface AccessorCheck {
  ok: boolean;
  missing: string[];
}

export function checkFrameAccessors(frame: Frame): AccessorCheck {
  const f = frame as unknown as Partial<CdpFrameInternals>;
  const missing: string[] = [];
  if (typeof f._id !== 'string' || !f._id) missing.push('_id');
  if (typeof f._client !== 'function') missing.push('_client()');
  else if (typeof f._client()?.id !== 'function') missing.push('_client().id()');
  return { ok: missing.length === 0, missing };
}

function internals(frame: Frame): CdpFrameInternals {
  const check = checkFrameAccessors(frame);
  if (!check.ok) throw new Error(`Puppeteer frame accessors changed: missing ${check.missing.join(', ')}`);
  return frame as unknown as CdpFrameInternals;
}

export function frameId(frame: Frame): string {
  return internals(frame)._id;
}

interface FrameTreeNode {
  frame: {
    id: string;
    parentId?: string;
    loaderId: string;
    url: string;
    urlFragment?: string;
    adFrameStatus?: { adFrameType: 'none' | 'child' | 'root' };
  };
  childFrames?: FrameTreeNode[];
}

interface TreeFacts {
  loaderId: string;
  url: string;
  adFrame: boolean;
}

export class PuppeteerFrameTopology implements TopologyPort {
  constructor(
    private readonly page: Page,
    private readonly cdp: CdpPort,
  ) {}

  mainFrameId(): string {
    return frameId(this.page.mainFrame());
  }

  /** Frames from Puppeteer, in tree order, without loader IDs. */
  structure(): Array<Omit<FrameRecord, 'loaderId' | 'adFrame'>> {
    const out: Array<Omit<FrameRecord, 'loaderId' | 'adFrame'>> = [];
    const walk = (frame: Frame, parentFrameId: string | undefined, depth: number) => {
      const f = internals(frame);
      out.push({
        frameId: f._id,
        parentFrameId,
        sessionId: normalizeSessionId(f._client().id()),
        url: frame.url(),
        depth,
      });
      for (const child of frame.childFrames()) walk(child, f._id, depth + 1);
    };
    walk(this.page.mainFrame(), undefined, 0);
    return out;
  }

  async frames(): Promise<FrameRecord[]> {
    const structure = this.structure();
    const sessions = [...new Set(structure.map(f => f.sessionId))];
    const facts = new Map<string, TreeFacts>();
    await Promise.all(
      sessions.map(async sessionId => {
        try {
          const { frameTree } = await this.cdp.send<{ frameTree: FrameTreeNode }>(sessionId, 'Page.getFrameTree');
          const walk = (node: FrameTreeNode) => {
            facts.set(node.frame.id, {
              loaderId: node.frame.loaderId,
              url: node.frame.url + (node.frame.urlFragment ?? ''),
              adFrame: (node.frame.adFrameStatus?.adFrameType ?? 'none') !== 'none',
            });
            node.childFrames?.forEach(walk);
          };
          walk(frameTree);
        } catch {
          // A session that just went away: its frames are reported with an empty loader ID and fail at use.
        }
      }),
    );
    return structure.map(frame => {
      const fact = facts.get(frame.frameId);
      return { ...frame, loaderId: fact?.loaderId ?? '', url: fact?.url ?? frame.url, adFrame: fact?.adFrame ?? false };
    });
  }

  onFrameEvent(handler: (event: FrameEvent) => void): () => void {
    const attached = (frame: Frame) => {
      const parent = frame.parentFrame();
      handler({ type: 'attached', frameId: frameId(frame), parentFrameId: parent ? frameId(parent) : undefined });
    };
    const navigated = (frame: Frame) => handler({ type: 'navigated', frameId: frameId(frame), url: frame.url() });
    const detached = (frame: Frame) => handler({ type: 'detached', frameId: frameId(frame) });
    this.page.on(FRAME_ATTACHED, attached);
    this.page.on(FRAME_NAVIGATED, navigated);
    this.page.on(FRAME_DETACHED, detached);
    return () => {
      this.page.off(FRAME_ATTACHED, attached);
      this.page.off(FRAME_NAVIGATED, navigated);
      this.page.off(FRAME_DETACHED, detached);
    };
  }
}

/** Step 0.2 spike helpers, kept for the Session tab. */
export interface FrameInfo {
  frameId: string;
  parentFrameId: string | undefined;
  sessionId: string;
  loaderId: string;
  url: string;
  depth: number;
}

export function listFrames(page: Page): FrameInfo[] {
  const out: FrameInfo[] = [];
  const walk = (frame: Frame, parentFrameId: string | undefined, depth: number) => {
    const f = internals(frame);
    const loaderId = (frame as unknown as { _loaderId?: string })._loaderId ?? '';
    out.push({ frameId: f._id, parentFrameId, sessionId: f._client().id(), loaderId, url: frame.url(), depth });
    for (const child of frame.childFrames()) walk(child, f._id, depth + 1);
  };
  walk(page.mainFrame(), undefined, 0);
  return out;
}

export async function readFrameTree(
  tabId: number,
  sessionId: SessionId | string,
): Promise<Array<Omit<FrameInfo, 'depth' | 'sessionId'>>> {
  const { frameTree } = await sendRaw<{ frameTree: FrameTreeNode }>(tabId, sessionId, 'Page.getFrameTree');
  const out: Array<Omit<FrameInfo, 'depth' | 'sessionId'>> = [];
  const walk = (node: FrameTreeNode) => {
    out.push({
      frameId: node.frame.id,
      parentFrameId: node.frame.parentId,
      loaderId: node.frame.loaderId,
      url: node.frame.url + (node.frame.urlFragment ?? ''),
    });
    node.childFrames?.forEach(walk);
  };
  walk(frameTree);
  return out;
}
