import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RefRegistry } from '../refs';
import type { Capture } from '../perception/capture';
import { buildObservation } from '../perception/observe';
import { decodeLayout } from '../perception/outline';
import { digestText } from '../perception/layout';
import { changedSources } from '../interaction/resolve';

const load = (page: string): Capture =>
  JSON.parse(readFileSync(`${__dirname}/payloads/${page}.capture.json`, 'utf8')) as Capture;
const observe = (capture: Capture, registry = new RefRegistry('e')) =>
  buildObservation(capture, registry, { mode: 'all', budget: 30_000 });

describe('tier 2: layout snapshot', () => {
  it('decodes documents with tags, bounds, styles and the click-listener flag', () => {
    const docs = decodeLayout(load('d-clickables'));
    const doc = [...docs.values()][0];
    const card = [...doc.byIndex].find(n => n?.attrs.id === 'open-settings')!;
    expect(card.tag).toBe('div');
    expect(card.clickable).toBe(true);
    expect(card.styles.cursor).toBe('pointer');
    expect(card.bounds![2]).toBeGreaterThan(0);
    expect(doc.digest(card.index)).toBe('Open settings ›');
    const scroller = [...doc.byIndex].find(n => n?.attrs.id === 'scroller')!;
    expect(scroller.scrollable).toBe(true);
    // The digest concatenates text nodes as they are; the display text joins them with spaces.
    expect(doc.digest(scroller.index)).toBe('Line 1Line 2Line 3Line 4Line 5Line 6');
    expect(doc.text(scroller.index)).toBe('Line 1 Line 2 Line 3 Line 4 Line 5 Line 6');
  });

  it('gives refs to clickables the accessibility tree misses, and drops their pointer-styled children', () => {
    const lines = observe(load('d-clickables'))
      .body.split('\n')
      .map(l => l.trim());
    expect(lines).toContain('[e1] clickable "Open settings ›"');
    expect(lines).toContain('[e2] clickable (div#icon-only.icon)');
    expect(lines).toContain('[e3] clickable "Filter: open"');
    expect(lines).toContain('[e7] scrollable "Line 1 Line 2 Line 3 Line 4 Line 5 Line 6"');
    // The "›" span inside the card is pointer-styled but inside an actionable ancestor: no ref of its own.
    expect(lines.filter(l => l.includes('›'))).toHaveLength(1);
  });

  it('promotes a checkbox hidden with display: none onto its label, and keeps a visually hidden one', () => {
    const lines = observe(load('d-clickables'))
      .body.split('\n')
      .map(l => l.trim());
    expect(lines).toContain('[e6] checkbox "Newsletter" (unchecked) (hidden input, acted on through its label)');
    expect(lines).toContain('[e4] checkbox "I accept the terms" (unchecked)');
    expect(lines).toContain('[e5] link "terms"');
  });

  it('records layout refs with their tag and text digest, for revalidation', () => {
    const registry = new RefRegistry('e');
    observe(load('d-clickables'), registry);
    const card = registry.get('e1')!;
    expect(card.source).toBe('layout');
    expect([card.print.tag, card.print.text]).toEqual(['div', 'Open settings ›']);
    expect(registry.get('e4')!.source).toBe('ax');
  });

  it('records the other sources of a layout ref’s name: attributes and a field’s labels', () => {
    const registry = new RefRegistry('e');
    observe(load('d-clickables'), registry);
    // aria-label, aria-labelledby, title, then the labels' text digests.
    expect(registry.get('e1')!.print.names).toBe('\u001f\u001f');
    expect(registry.get('e6')!.print.names).toBe('\u001f\u001f\u001fNewsletter');
    expect(changedSources('\u001f\u001f', 'Pay now\u001f\u001f')).toBe('aria-label «Pay now»');
    expect(changedSources('\u001f\u001f\u001fNewsletter', '\u001f\u001f\u001fDelete account')).toBe(
      'label «Delete account»',
    );
  });

  it('falls back to the accessibility tree alone when the layout snapshot is missing, and says so', () => {
    const capture = { ...load('d-clickables'), layout: undefined, layoutError: 'the layout snapshot failed' };
    const o = observe(capture);
    expect(o.body).not.toMatch(/\] clickable /);
    expect(o.notices.join(' ')).toContain('Layout was not captured (the layout snapshot failed)');
  });

  it('defines the text digest once: whitespace collapsed, first 80 characters', () => {
    expect(digestText('  a \n\t b  ')).toBe('a b');
    expect(digestText('x'.repeat(100))).toHaveLength(80);
  });

  it('leaves pages without non-semantic controls as tier 1 printed them', () => {
    const lines = observe(load('form'))
      .body.split('\n')
      .map(l => l.trim());
    expect(lines).toContain('[e3] textbox "Full name" (required) = "Ada Lovelace"');
    expect(lines.some(l => /clickable "Shipping details/.test(l))).toBe(false);
  });
});
