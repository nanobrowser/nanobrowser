import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RefRegistry } from '../refs';
import type { Capture } from '../perception/capture';
import { buildObservation } from '../perception/observe';
import { looksLikeCardNumber } from '../perception/masking';

const load = (page: string): Capture =>
  JSON.parse(readFileSync(`${__dirname}/payloads/${page}.capture.json`, 'utf8')) as Capture;
const observe = (capture: Capture, registry = new RefRegistry('e'), options = {}) =>
  buildObservation(capture, registry, { mode: 'all', budget: 30_000, ...options });

describe('outline of the form fixture', () => {
  const o = observe(load('form'));
  const lines = o.body.split('\n').map(l => l.trim());

  it('prints roles, names, states and values', () => {
    expect(lines).toContain('[e3] textbox "Full name" (required) = "Ada Lovelace"');
    expect(lines).toContain('[e4] textbox "Email" (readonly) = "ada@example.test"');
    expect(lines).toContain('[e9] combobox "Status" (collapsed) = "Overdue"');
    expect(lines).toContain('[e10] checkbox "Overdue only" (checked)');
    expect(lines).toContain('[e11] checkbox "Include archived" (unchecked)');
    expect(lines).toContain('[e13] radio "Pro" (checked)');
    expect(lines).toContain('[e14] switch "Notifications" (checked)');
    expect(lines).toContain('[e18] button "More options" (collapsed)');
    expect(lines).toContain('[e19] button "Bold" (pressed)');
    expect(lines).toContain('[e20] button "Save" (disabled)');
    expect(lines).toContain('[e21] tab "Table" (selected)');
    expect(lines).toContain('heading "Observation form" (level 1)');
  });

  it('masks password, card, security-code and one-time-code values, and never prints them', () => {
    for (const label of ['Password', 'Card number', 'Security code', 'One-time code']) {
      expect(lines).toContainEqual(expect.stringMatching(new RegExp(`textbox "${label}" = "••••••" \\(masked\\)$`)));
    }
    for (const secret of ['hunter2', '4111', '654321', '= "123"']) expect(o.body).not.toContain(secret);
  });

  it('labels rows from their cells and drops text that repeats a name', () => {
    expect(lines).toContain('row "INV-1042 Acme Corp Delete"');
    expect(lines).not.toContain('text "Acme Corp"');
    expect(lines).not.toContain('text "Full name"');
  });

  it('stitches the same-process frame under its iframe and states the frames it skipped', () => {
    const i = lines.indexOf('[e29] iframe "Embedded"');
    expect(lines.slice(i + 1, i + 3)).toEqual(['[e30] textbox "Coupon" = "SPRING"', '[e31] button "Apply"']);
    expect(lines).toContain('[e32] iframe "Tiny" (not captured: smaller than 10×10 px)');
    expect(o.notices).toContain('… 1 frame not captured: not rendered.');
    expect(o.status).toBe('partial');
  });

  it('prints exactly the refs it returns', () => {
    const printed = [...o.body.matchAll(/\[(e\d+)\]/g)].map(m => m[1]);
    expect(printed).toEqual(o.refs);
    expect(o.entries.map(e => e.ref)).toEqual(o.refs);
  });
});

describe('refs in observations', () => {
  it('keeps labels across observations of the same document', () => {
    const registry = new RefRegistry('e');
    const first = observe(load('form'), registry);
    const second = observe(load('form'), registry);
    expect(second.refs).toEqual(first.refs);
    expect(second.body).toBe(first.body);
  });

  it('records the ordinal of same role and name within a frame', () => {
    const registry = new RefRegistry('e');
    const o = observe(load('form'), registry);
    const deletes = o.entries.filter(e => e.name === 'Delete').map(e => registry.get(e.ref)!.print.nth);
    expect(deletes).toEqual([0, 1]);
    expect(registry.get(o.entries.find(e => e.name === 'Apply')!.ref)!.print.nth).toBeNull();
  });

  it('binds each ref to its own frame, session and document', () => {
    const registry = new RefRegistry('e');
    const capture = load('frames-nested');
    const o = observe(capture, registry);
    const button = registry.get(o.entries.find(e => e.name === 'Grandchild button')!.ref)!;
    const frame = capture.frames.find(f => f.depth === 2)!;
    expect([button.frameId, button.sessionId, button.loaderId]).toEqual([
      frame.frameId,
      frame.sessionId,
      frame.loaderId,
    ]);
  });
});

describe('options and omissions (degrade loudly)', () => {
  it('cuts to the budget before recording refs, and says so', () => {
    const o = observe(load('form'), new RefRegistry('e'), { budget: 600 });
    expect(o.body.length).toBeLessThanOrEqual(600);
    expect(o.notices.find(n => n.startsWith('… outline cut'))).toMatch(/^… outline cut at 600 characters/);
    const printed = [...o.body.matchAll(/\[(e\d+)\]/g)].map(m => m[1]);
    expect(printed).toEqual(o.refs);
  });

  it('prints only actionable elements and their containers in interactive mode', () => {
    const o = observe(load('form'), new RefRegistry('e'), { mode: 'interactive' });
    expect(o.body).not.toMatch(/^\s*text /m);
    expect(o.body).toContain('heading "Invoices" (level 2)');
    expect(o.refs.length).toBe(observe(load('form')).refs.length);
  });

  it('limits the outline to a scope', () => {
    const registry = new RefRegistry('e');
    const full = observe(load('form'), registry);
    const iframe = full.entries.find(e => e.name === 'Embedded')!;
    const o = observe(load('form'), registry, {
      scope: { frameId: iframe.frameId, backendNodeId: iframe.backendNodeId },
    });
    expect(o.body.split('\n').map(l => l.trim())).toEqual([
      `[${iframe.ref}] iframe "Embedded"`,
      expect.stringContaining('textbox "Coupon"'),
      expect.stringContaining('button "Apply"'),
    ]);
  });

  it('reports a frame whose capture failed, on its iframe and in the notices', () => {
    const capture = load('frames-nested');
    const child = capture.frames.find(f => f.depth === 1)!;
    Object.assign(child, {
      status: 'failed',
      reason: 'Accessibility.getFullAXTree: no answer within 10000 ms',
      nodes: [],
    });
    const grandchild = capture.frames.find(f => f.depth === 2)!;
    Object.assign(grandchild, { status: 'skipped', reason: 'inside a frame that was not captured', nodes: [] });
    const o = observe(capture);
    expect(o.body).toContain(
      'iframe "Child frame" (site 127.0.0.1:8787) (not captured: Accessibility.getFullAXTree: no answer within 10000 ms)',
    );
    expect(o.notices).toContain(
      '… 1 frame not captured: capture failed (Accessibility.getFullAXTree: no answer within 10000 ms).',
    );
    expect(o.frames).toEqual({ captured: 1, skipped: 1, failed: 1 });
    expect(o.body).not.toContain('Grandchild button');
  });

  it('reports a captured frame whose iframe is not in the outline, and calls the outline partial', () => {
    expect(observe(load('frames-nested')).status).toBe('complete');
    const capture = load('frames-nested');
    const grandchild = capture.frames.find(f => f.depth === 2)!;
    // Chrome leaves the iframe out of the accessibility tree, as it does inside an aria-hidden region.
    const iframe = capture.frames
      .find(f => f.depth === 1)!
      .nodes.find(n => n.backendDOMNodeId === grandchild.ownerBackendNodeId)!;
    Object.assign(iframe, { ignored: true, ignoredReasons: [{ name: 'ariaHiddenSubtree' }] });
    const o = observe(capture);
    expect(o.body).not.toContain('Grandchild button');
    expect(o.unplaced).toEqual([{ frameId: grandchild.parentFrameId, backendNodeId: grandchild.ownerBackendNodeId }]);
    expect(o.notices.filter(n => n.includes('could not be placed'))).toHaveLength(1);
    expect(o.status).toBe('partial');
  });
});

describe('layout tables and separators', () => {
  const lines = observe(load('d-layout-table'))
    .body.split('\n')
    .map(l => l.trim());

  it('prints a table used for layout as its contents', () => {
    expect(lines.some(l => /layoutTable|LayoutTable/.test(l))).toBe(false);
    expect(lines).toEqual([
      '[e1] link "Top"',
      '[e2] link "new"',
      '[e3] link "past"',
      '[e4] link "ask"',
      '[e5] link "login"',
      'text "Stories from today"',
    ]);
  });

  it('drops text that is only separators or punctuation', () => {
    expect(lines.some(l => /^text "[|·\s]*"$/.test(l))).toBe(false);
  });
});

describe('closed shadow roots', () => {
  it('captures controls inside a closed root like any other', () => {
    const o = observe(load('shadow-closed'));
    expect(o.body).toContain('[e1] textbox "Shadow field" = "inside closed root"');
    expect(o.body).toContain('[e2] button "Shadow button"');
  });
});

describe('card number detection', () => {
  it('uses the Luhn check', () => {
    expect(looksLikeCardNumber('4111 1111 1111 1111')).toBe(true);
    expect(looksLikeCardNumber('4111 1111 1111 1112')).toBe(false);
    expect(looksLikeCardNumber('2026-10-04')).toBe(false);
  });
});
