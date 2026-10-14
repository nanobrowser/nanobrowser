// The Session tab: share a tab with the test session, see its frames, send raw commands.
// The layer's controller owns the attachment; this file only exposes it to the panel and the checks.
import { PAGE_SESSION_ALIAS } from '@src/browser-control';
import type { ChromeTabConnection, FrameRecord, listFrames, TabAttachment } from '@src/browser-control';
import { layer } from './layer';
import { emit, register } from './rpc';

const watched = new WeakSet<TabAttachment>();

/** Shares the tab with the test session and attaches. */
export async function attach(tabId: number): Promise<TabAttachment> {
  const { controller, session } = await layer();
  session.shareTab(tabId);
  const attachment = await controller.attach(tabId);
  if (!watched.has(attachment)) {
    watched.add(attachment);
    attachment.onDetach(info => emit('session.detached', { tabId, reason: info.reason }));
  }
  return attachment;
}

export async function attachmentFor(tabId: number): Promise<TabAttachment> {
  const { controller } = await layer();
  const a = controller.tabState(tabId).attachment;
  if (!a || a.detached) throw new Error(`Tab ${tabId} is not attached`);
  return a;
}

/** Puppeteer's page behind an attachment, for the checks that inspect Puppeteer itself. */
export function connectionFor(tabId: number): { page: Parameters<typeof listFrames>[0] } {
  return { page: diagnosticPages.get(tabId) as Parameters<typeof listFrames>[0] };
}
const diagnosticPages = new Map<number, unknown>();

export interface FrameReport {
  tabId: number;
  frames: Array<FrameRecord & { session: string }>;
}

export async function frameReport(tabId: number): Promise<FrameReport> {
  const frames = await (await attachmentFor(tabId)).topology.frames();
  return { tabId, frames: frames.map(f => ({ ...f, session: f.sessionId ?? PAGE_SESSION_ALIAS })) };
}

register('session.attach', async params => {
  const { tabId } = params as { tabId: number };
  const a = await attach(tabId);
  diagnosticPages.set(tabId, (a as ChromeTabConnection).diagnosticPage);
  return frameReport(tabId);
});

register('session.detach', async params => {
  const { tabId } = params as { tabId: number };
  const { session } = await layer();
  diagnosticPages.delete(tabId);
  await session.unshareTab(tabId);
  return null;
});

register('session.frames', async params => frameReport((params as { tabId: number }).tabId));

register('session.attached', async () => (await layer()).session.tabIds());

register('session.raw', async params => {
  const {
    tabId,
    sessionId,
    method,
    params: commandParams,
  } = params as {
    tabId: number;
    sessionId?: string;
    method: string;
    params?: Record<string, unknown>;
  };
  const session = sessionId === PAGE_SESSION_ALIAS ? undefined : sessionId;
  return (await attachmentFor(tabId)).cdp.send(session, method, commandParams ?? {});
});
