import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RefRegistry } from '../refs';
import type { Capture } from '../perception/capture';
import { buildObservation } from '../perception/observe';
import type { WindowMode } from '../perception/window';

const load = (page: string): Capture =>
  JSON.parse(readFileSync(`${__dirname}/payloads/${page}.capture.json`, 'utf8')) as Capture;
const observe = (capture: Capture, window?: WindowMode, budget = 30_000) =>
  buildObservation(capture, new RefRegistry('e'), { mode: 'all', budget, window });
const opened = (body: string) => [...body.matchAll(/button "Open (\d+)"/g)].map(m => Number(m[1]));
const scrolled = (capture: Capture, y: number): Capture => ({
  ...capture,
  viewport: { ...capture.viewport!, scrollY: y },
});

describe('window', () => {
  const capture = load('d-long');

  it('prints the viewport plus one viewport height each way by default, and counts the rest', () => {
    const o = observe(capture);
    const items = opened(o.body);
    expect(items[0]).toBe(1);
    // 757 px viewport at the top: the window ends at 1,514 px, about 50 items of 29 px.
    expect(items.length).toBeGreaterThan(40);
    expect(items.length).toBeLessThan(60);
    expect(o.notices.find(n => n.includes('below the window'))).toMatch(
      new RegExp(`^… ${120 - items.length} more actionable elements below the window`),
    );
  });

  it('narrows to the viewport, or prints the page', () => {
    expect(opened(observe(capture, 'viewport').body).length).toBeLessThan(30);
    expect(opened(observe(capture, 'page').body)).toHaveLength(120);
  });

  it('follows the scroll position, with notices above and below', () => {
    const o = observe(scrolled(capture, 1800));
    const items = opened(o.body);
    expect(items[0]).toBeGreaterThan(20);
    expect(items[items.length - 1]).toBeLessThan(120);
    expect(o.notices.some(n => n.includes('above the window'))).toBe(true);
    expect(o.notices.some(n => n.includes('below the window'))).toBe(true);
  });

  it('cuts the lines farthest from the viewport first, and prints exactly the refs it returns', () => {
    const o = observe(scrolled(capture, 1800), 'page', 3_000);
    const items = opened(o.body);
    // The kept items are around the viewport (1,800 to 2,557 px is items 60 to 85), not the first ones.
    expect(Math.min(...items)).toBeGreaterThan(30);
    expect(Math.max(...items)).toBeLessThan(110);
    expect(o.notices.find(n => n.startsWith('… outline cut'))).toMatch(/farthest from the viewport first/);
    const printed = [...o.body.matchAll(/\[(e\d+)\]/g)].map(m => m[1]);
    expect(printed).toEqual(o.refs);
    expect(o.body.length).toBeLessThanOrEqual(3_000);
  });
});

describe('window on a display with a device scale factor', () => {
  // Recorded in Chrome with --force-device-scale-factor=2: 30 buttons, one every 200 CSS px, scrolled to 2,400 px,
  // viewport 557 px high. The layout snapshot gives bounds in device pixels (a button at 2,400 px is at 4,800).
  const capture = load('d-hidpi');
  const at = (body: string) => [...body.matchAll(/button "Button at (\d+)"/g)].map(m => Number(m[1]));

  it('prints the elements around the viewport, in CSS pixels', () => {
    const o = observe(capture);
    // The window is 1,843 to 3,514 px: the buttons at 2,000 to 3,400.
    expect(at(o.body)).toEqual([2000, 2200, 2400, 2600, 2800, 3000, 3200, 3400]);
    expect(o.notices.some(n => /^… 10 more actionable elements above the window/.test(n))).toBe(true);
    expect(o.notices.some(n => /^… 12 more actionable elements below the window/.test(n))).toBe(true);
  });

  it('narrows to the viewport', () => {
    expect(at(observe(capture, 'viewport').body)).toEqual([2400, 2600, 2800]);
  });
});
