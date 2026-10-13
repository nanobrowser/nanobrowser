import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RefRegistry } from '../refs';
import type { Capture } from '../perception/capture';
import { buildObservation } from '../perception/observe';
import { decodeLayout, MAX_TREE_DEPTH } from '../perception/outline';

// d-deep.html?depth=1500: a button near the top, then 1,500 nested divs built by script with a button at the bottom.
const deep = JSON.parse(readFileSync(`${__dirname}/payloads/d-deep.capture.json`, 'utf8')) as Capture;

describe('pages nested far deeper than real ones (degrade loudly)', () => {
  const o = buildObservation(deep, new RefRegistry('e'), { mode: 'all', budget: 30_000 });

  it('builds the observation, keeps what is above the limit and says what it cut', () => {
    expect(o.body).toMatch(/\[e\d+\] button "Top button"/);
    expect(o.notices).toContain(
      `… 1 part of the page is nested deeper than ${MAX_TREE_DEPTH} levels: only controls the layout snapshot finds there are listed, under the deepest element shown.`,
    );
  });

  it('lists a control below the limit from the layout snapshot, and nothing below it without layout', () => {
    expect(o.body).toMatch(/\[e\d+\] clickable "Bottom button"/);
    const bare = buildObservation({ ...deep, layout: undefined }, new RefRegistry('e'), {
      mode: 'all',
      budget: 30_000,
    });
    expect(bare.body).toMatch(/button "Top button"/);
    expect(bare.body).not.toContain('Bottom button');
  });

  it('prints exactly the refs it returns', () => {
    const printed = [...o.body.matchAll(/\[(e\d+)\]/g)].map(m => m[1]);
    expect(printed.sort()).toEqual(o.entries.map(e => e.ref).sort());
  });

  it('joins layout text at any depth', () => {
    const doc = [...decodeLayout(deep).values()][0];
    const body = doc.byIndex.find(n => n?.tag === 'body')!;
    expect(doc.text(body.index, 200)).toContain('Bottom button');
  });
});
