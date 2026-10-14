import { describe, expect, it } from 'vitest';
import { chainToTop } from '../geometry';
import type { CdpPort, FrameRecord } from '../ports';

const frames = [
  { frameId: 'main', sessionId: undefined, loaderId: 'l1', url: 'http://a.test/', depth: 0 },
  { frameId: 'child', parentFrameId: 'main', sessionId: 's1', loaderId: 'l2', url: 'http://b.test/', depth: 1 },
] as unknown as FrameRecord[];

/** A CDP whose only answers are the owner iframe of the child frame and that iframe's content quad. */
const cdpWith = (content: number[]) =>
  ({
    tabId: 1,
    send: async (_session: unknown, method: string) =>
      method === 'DOM.getFrameOwner' ? { backendNodeId: 7 } : { model: { content } },
    on: () => () => undefined,
  }) as unknown as CdpPort;
const viewport = async () => ({ width: 200, height: 100 });

describe('chainToTop: a point in an out-of-process frame, in the top-level viewport', () => {
  it('adds the iframe’s corner for an untransformed iframe', async () => {
    // Content box at (50, 30), 200 × 100.
    const steps = await chainToTop(
      cdpWith([50, 30, 250, 30, 250, 130, 50, 130]),
      frames,
      frames[1],
      { x: 20, y: 10 },
      viewport,
    );
    expect(steps[steps.length - 1].point).toEqual({ x: 70, y: 40 });
  });

  it('scales with a scaled iframe', async () => {
    // The same iframe drawn at half size.
    const steps = await chainToTop(
      cdpWith([50, 30, 150, 30, 150, 80, 50, 80]),
      frames,
      frames[1],
      { x: 20, y: 10 },
      viewport,
    );
    expect(steps[steps.length - 1].point).toEqual({ x: 60, y: 35 });
  });

  it('follows a rotated iframe', async () => {
    // Rotated a quarter turn clockwise about its top-left corner at (300, 30): the child's x axis runs down the page.
    const steps = await chainToTop(
      cdpWith([300, 30, 300, 230, 200, 230, 200, 30]),
      frames,
      frames[1],
      { x: 20, y: 10 },
      viewport,
    );
    expect(steps[steps.length - 1].point).toEqual({ x: 290, y: 50 });
  });
});
