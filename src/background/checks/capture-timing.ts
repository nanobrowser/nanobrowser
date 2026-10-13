// Time the two raw capture calls on real sites, before anything is built on them: Accessibility.getFullAXTree per
// frame and DOMSnapshot.captureSnapshot per session, several times each, with no cleaning or rendering.
import { CdpTimeoutError, listFrames, PAGE_SESSION_ALIAS, sendRaw } from '@src/browser-control';
import type { FrameInfo } from '@src/browser-control';
import { call } from '../rpc';
import { connectionFor } from '../spike-session';
import { defineCheck } from './registry';
import { sleep, withTab } from './helpers';

export const DEFAULT_SITES = [
  'https://en.wikipedia.org/wiki/World_War_II',
  'https://github.com/puppeteer/puppeteer',
  'https://www.amazon.com/',
  'https://www.nytimes.com/',
  'https://www.youtube.com/',
  'https://www.reddit.com/r/programming/',
  'https://edition.cnn.com/',
  'https://www.booking.com/',
  'https://stackoverflow.com/questions',
  'https://www.bbc.com/news',
  'https://news.ycombinator.com/',
  'https://developer.mozilla.org/en-US/docs/Web/HTML/Element',
];

/** The computed styles tier 2 needs (about ten). */
export const SNAPSHOT_STYLES = [
  'display',
  'visibility',
  'opacity',
  'cursor',
  'pointer-events',
  'overflow-x',
  'overflow-y',
  'position',
  'z-index',
  'content-visibility',
];

const CAPTURE_TIMEOUT_MS = 30_000;

interface Iteration {
  /** Wall time with every call of the iteration started at once. */
  parallelMs: number;
  /** Sum of the AX calls, one after another. */
  axSequentialMs: number;
  /** Sum of the snapshot calls, one after another. */
  snapshotSequentialMs: number;
}

export interface SiteTiming {
  url: string;
  finalUrl: string;
  title: string;
  frames: number;
  sessions: number;
  axNodes: number;
  snapshotNodes: number;
  axBytes: number;
  snapshotBytes: number;
  enableMs: number;
  firstAxMs: number;
  iterations: Iteration[];
  errors: string[];
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const value = await fn();
  return [value, performance.now() - start];
}

function axCall(tabId: number, frame: FrameInfo) {
  return sendRaw<{ nodes: unknown[] }>(
    tabId,
    frame.sessionId,
    'Accessibility.getFullAXTree',
    { frameId: frame.frameId },
    CAPTURE_TIMEOUT_MS,
  );
}

function snapshotCall(tabId: number, sessionId: string) {
  return sendRaw<{ documents: Array<{ nodes: { nodeName?: unknown[] } }>; strings: string[] }>(
    tabId,
    sessionId,
    'DOMSnapshot.captureSnapshot',
    { computedStyles: SNAPSHOT_STYLES, includeDOMRects: true, includePaintOrder: false },
    CAPTURE_TIMEOUT_MS,
  );
}

export async function measureSite(url: string, iterations: number, settleMs: number): Promise<SiteTiming> {
  return withTab(url, async tab => {
    await sleep(settleMs);
    await call('session.attach', { tabId: tab.tabId });
    await sleep(1000);
    const { page } = connectionFor(tab.tabId);
    const frames = listFrames(page).slice(0, 50);
    const sessions = [...new Set(frames.map(f => f.sessionId))];
    const errors: string[] = [];
    const current = await chrome.tabs.get(tab.tabId);

    // Domains are enabled once per session, as the layer will do.
    const [, enableMs] = await timed(() =>
      Promise.all(
        sessions.map(async s => {
          for (const domain of ['DOM', 'Accessibility', 'DOMSnapshot']) {
            await sendRaw(tab.tabId, s, `${domain}.enable`, {}, CAPTURE_TIMEOUT_MS).catch(e =>
              errors.push(`${domain}.enable on ${s === PAGE_SESSION_ALIAS ? 'root' : s}: ${String(e)}`),
            );
          }
        }),
      ),
    );

    // The first AX call after enabling builds the renderer's tree; timed separately.
    const [, firstAxMs] = await timed(() => Promise.all(frames.map(f => axCall(tab.tabId, f).catch(() => null))));

    let axNodes = 0;
    let snapshotNodes = 0;
    let axBytes = 0;
    let snapshotBytes = 0;
    const runs: Iteration[] = [];
    for (let i = 0; i < iterations; i++) {
      const [, parallelMs] = await timed(() =>
        Promise.all([
          ...frames.map(f => axCall(tab.tabId, f).catch(e => errors.push(`AX ${f.url}: ${String(e)}`))),
          ...sessions.map(s => snapshotCall(tab.tabId, s).catch(e => errors.push(`snapshot ${s}: ${String(e)}`))),
        ]),
      );
      let axSequentialMs = 0;
      let snapshotSequentialMs = 0;
      axNodes = 0;
      for (const frame of frames) {
        try {
          const [result, ms] = await timed(() => axCall(tab.tabId, frame));
          axSequentialMs += ms;
          axNodes += result.nodes.length;
          if (i === 0) axBytes += JSON.stringify(result).length;
        } catch (e) {
          if (e instanceof CdpTimeoutError) axSequentialMs += CAPTURE_TIMEOUT_MS;
          errors.push(`AX ${frame.url}: ${String(e)}`);
        }
      }
      snapshotNodes = 0;
      for (const sessionId of sessions) {
        try {
          const [result, ms] = await timed(() => snapshotCall(tab.tabId, sessionId));
          snapshotSequentialMs += ms;
          snapshotNodes += result.documents.reduce((n, d) => n + (d.nodes.nodeName?.length ?? 0), 0);
          if (i === 0) snapshotBytes += JSON.stringify(result).length;
        } catch (e) {
          errors.push(`snapshot ${sessionId}: ${String(e)}`);
        }
      }
      runs.push({
        parallelMs: Math.round(parallelMs),
        axSequentialMs: Math.round(axSequentialMs),
        snapshotSequentialMs: Math.round(snapshotSequentialMs),
      });
    }
    return {
      url,
      finalUrl: current.url ?? '',
      title: current.title ?? '',
      frames: frames.length,
      sessions: sessions.length,
      axNodes,
      snapshotNodes,
      axBytes,
      snapshotBytes,
      enableMs: Math.round(enableMs),
      firstAxMs: Math.round(firstAxMs),
      iterations: runs,
      errors: [...new Set(errors)].slice(0, 10),
    };
  });
}

defineCheck({
  name: 'capture-timing',
  title: 'Capture timing',
  description:
    'For each site: load, attach, enable DOM, Accessibility and DOMSnapshot once per session, then time getFullAXTree per frame and captureSnapshot per session several times. Arguments: {"urls": [...], "iterations": 5, "settleMs": 3000}.',
  async run(args) {
    const urls = (args.urls as string[] | undefined) ?? DEFAULT_SITES;
    const iterations = Number(args.iterations ?? 5);
    const settleMs = Number(args.settleMs ?? 3000);
    const sites: Array<SiteTiming | { url: string; error: string }> = [];
    for (const url of urls) {
      try {
        sites.push(await measureSite(url, iterations, settleMs));
      } catch (error) {
        sites.push({ url, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { iterations, settleMs, styles: SNAPSHOT_STYLES, sites };
  },
});

defineCheck({
  name: 'ax-composition',
  title: 'AX tree composition',
  description:
    'For one URL: counts the nodes of Accessibility.getFullAXTree per role, how many are ignored, and how large the payload is. Arguments: {"url": "..."}.',
  async run(args) {
    const url = String(args.url);
    return withTab(url, async tab => {
      await sleep(Number(args.settleMs ?? 3000));
      await call('session.attach', { tabId: tab.tabId });
      const { page } = connectionFor(tab.tabId);
      const main = listFrames(page)[0];
      const { nodes } = await sendRaw<{
        nodes: Array<{ role?: { value?: string }; ignored?: boolean; name?: { value?: string } }>;
      }>(tab.tabId, main.sessionId, 'Accessibility.getFullAXTree', { frameId: main.frameId }, CAPTURE_TIMEOUT_MS);
      const roles: Record<string, number> = {};
      let ignored = 0;
      let bytes = 0;
      for (const node of nodes) {
        const role = `${node.role?.value ?? '?'}${node.ignored ? ' (ignored)' : ''}`;
        roles[role] = (roles[role] ?? 0) + 1;
        if (node.ignored) ignored++;
        bytes += JSON.stringify(node).length;
      }
      const top = Object.entries(roles)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25);
      return { url, nodes: nodes.length, ignored, bytes, top };
    });
  },
});
