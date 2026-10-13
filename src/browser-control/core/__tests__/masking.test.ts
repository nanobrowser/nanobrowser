import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RefRegistry } from '../refs';
import type { Capture, FrameCapture } from '../perception/capture';
import type { AXNode } from '../perception/ax';
import { buildFrameTree, renderLines } from '../perception/outline';
import { buildObservation } from '../perception/observe';
import { redactArgs } from '../redact';
import {
  isSensitiveField,
  isSensitiveLabel,
  isSensitiveOption,
  listedOption,
  quotedOption,
} from '../perception/masking';
import { afterInput, basisOf } from '../interaction/gate';
import { requestUrl } from '../interaction/evidence';
import { presentedBoxes } from '../tools/labels';
import { LayerError } from '../../protocol/errors';

const load = (page: string): Capture =>
  JSON.parse(readFileSync(`${__dirname}/payloads/${page}.capture.json`, 'utf8')) as Capture;
const observe = (capture: Capture) => buildObservation(capture, new RefRegistry('e'), { mode: 'all', budget: 30_000 });
const withoutFacts = (capture: Capture): Capture => ({
  ...capture,
  frames: capture.frames.map(f => ({ ...f, fields: {} })),
});

describe('masking when field attributes were not read', () => {
  it('takes the attributes from the layout snapshot: the outline is unchanged', () => {
    const capture = load('form');
    expect(observe(withoutFacts(capture)).body).toBe(observe(capture).body);
    expect(observe(withoutFacts(capture)).notices.join('\n')).not.toMatch(/attributes could not be read/);
  });

  it('masks every field value it knows nothing about, and says so', () => {
    const capture = { ...withoutFacts(load('form')), layout: undefined };
    const o = observe(capture);
    expect(o.body).not.toContain('Ada Lovelace');
    expect(o.body).not.toContain('ada@example.test');
    expect(o.body).toContain('textbox "Full name" (required) = "••••••" (masked)');
    expect(o.notices.join('\n')).toMatch(
      /\d+ field values are masked because the field's attributes could not be read/,
    );
  });
});

describe('code fields by name and label', () => {
  const field = (name: string, label: string) => isSensitiveField({ tag: 'input', type: 'text', name }, label, '1234');

  it('masks verification, authentication and two-factor code fields without autocomplete', () => {
    expect(field('verification_code', 'Code')).toBe(true);
    expect(field('verifyCode', 'Code')).toBe(true);
    expect(field('code', 'Verification code')).toBe(true);
    expect(field('code', 'Enter the verification code we sent')).toBe(true);
    expect(field('auth_code', 'Code')).toBe(true);
    expect(field('code', 'Authentication code')).toBe(true);
    expect(field('code', 'Authenticator code')).toBe(true);
    expect(field('mfa_token', 'Code')).toBe(true);
    expect(field('code', 'MFA code')).toBe(true);
    expect(field('code', 'Two-factor code')).toBe(true);
    expect(field('code', '2FA code')).toBe(true);
    expect(field('code', 'Security code')).toBe(true);
    expect(field('code', 'One-time password')).toBe(true);
    expect(field('code', 'Passcode')).toBe(true);
  });

  it('prints ordinary code fields', () => {
    for (const label of ['Promo code', 'Zip code', 'Postal code', 'Coupon code', 'Discount code', 'Country code']) {
      expect(field(label.toLowerCase().replace(' ', '_'), label)).toBe(false);
    }
  });
});

describe('audit redaction', () => {
  it('replaces typed and set values, field values and expected values', () => {
    expect(redactArgs('type', { text: 'hunter2', target: { ref: 'e1' } })).toEqual({
      text: '‹redacted, 7 characters›',
      target: { ref: 'e1' },
    });
    expect(redactArgs('set', { value: '654321', expect: { value: '654321', url: '/done' } })).toEqual({
      value: '‹redacted, 6 characters›',
      expect: { value: '‹redacted, 6 characters›', url: '/done' },
    });
    expect(redactArgs('set', { value: true })).toEqual({ value: true });
    expect(redactArgs('set', { value: ['Paid'] })).toEqual({ value: ['‹redacted, 4 characters›'] });
    expect(
      redactArgs('fill_form', {
        fields: [
          { target: { ref: 'e1' }, value: 'a' },
          { target: { ref: 'e2' }, value: false },
        ],
      }),
    ).toEqual({
      fields: [
        { target: { ref: 'e1' }, value: '‹redacted, 1 character›' },
        { target: { ref: 'e2' }, value: false },
      ],
    });
  });

  it('replaces the answer to a prompt() dialog', () => {
    expect(redactArgs('handle_dialog', { accept: true, promptText: '654321' })).toEqual({
      accept: true,
      promptText: '‹redacted, 6 characters›',
    });
    expect(redactArgs('handle_dialog', { accept: false })).toEqual({ accept: false });
  });

  it('leaves other tools and malformed arguments alone, and never changes the original', () => {
    const args = { text: 'Invoices', target: { ref: 'e1' } };
    expect(redactArgs('wait', args)).toEqual(args);
    expect(redactArgs('type', null)).toBeNull();
    expect(redactArgs('type', 'raw')).toBe('raw');
    const original = { text: 'secret' };
    redactArgs('type', original);
    expect(original.text).toBe('secret');
  });
});

describe('select options in errors and read-backs', () => {
  const visa = { index: 1, value: '4111111111111111', label: 'Saved card' };
  const paid = { index: 2, value: 'paid', label: 'Paid' };

  it('prints label and value for an ordinary option', () => {
    expect(listedOption(paid, false)).toBe('«Paid» («paid»)');
    expect(quotedOption(paid, false, false)).toBe('«Paid»');
    expect(quotedOption(paid, false, true)).toBe('«Paid» («paid»)');
  });

  it('never prints a value of a sensitive select, and tells options apart by position', () => {
    expect(isSensitiveOption(paid, true)).toBe(true);
    expect(listedOption(paid, true)).toBe('«Paid» (option 3, value masked)');
    expect(quotedOption(paid, true, true)).toBe('«Paid» (option 3)');
    expect(quotedOption(paid, true, false)).toBe('«Paid»');
  });

  it('masks a label that is the secret in a sensitive select: a coded value repeated, or no letters', () => {
    const code = { index: 1, value: '482913', label: '482913' };
    const named = { index: 2, value: 'A7K2Q9', label: 'Code A7K2Q9' };
    const card = { index: 3, value: 'tok_1', label: 'Visa ending 1111' };
    for (const text of [listedOption(code, true), quotedOption(code, true, false), quotedOption(named, true, false)]) {
      expect(text).not.toMatch(/482913|A7K2Q9/);
    }
    expect(quotedOption(code, true, false)).toBe('«••••••» (option 2)');
    expect(isSensitiveLabel(code, false)).toBe(false);
    expect(isSensitiveLabel(card, true)).toBe(false);
    expect(isSensitiveLabel({ index: 0, value: '', label: 'Choose' }, true)).toBe(false);
    expect(isSensitiveLabel({ index: 0, value: '03', label: '03' }, true)).toBe(true);
  });

  it('masks a card number wherever it is, as a value or as a label', () => {
    expect(listedOption(visa, false)).toBe('«Saved card» (option 2, value masked)');
    expect(quotedOption(visa, false, true)).toBe('«Saved card» (option 2)');
    const shown = { index: 0, value: 'a', label: '4111 1111 1111 1111' };
    for (const text of [listedOption(shown, false), quotedOption(shown, false, false)]) {
      expect(text).not.toMatch(/4111/);
    }
  });
});

describe('refs a labelled screenshot presents', () => {
  const box = (ref: string, x: number, y: number, width = 40, height = 20) => ({ ref, x, y, width, height });

  it('keeps only boxes that lie wholly inside the image', () => {
    const image = { width: 49, height: 21 };
    const boxes = [
      box('whole', 0, 0, 49.4, 21.5),
      box('left', -80, 0),
      box('below', 0, 40),
      box('cut', 30, 5),
      box('far', 500, 500),
    ];
    expect(presentedBoxes(boxes, image).map(b => b.ref)).toEqual(['whole']);
  });
});

describe('an error of a check made after input reached the page', () => {
  it('keeps the code, says what was sent in place of "Nothing was dispatched", and reports the delivery', () => {
    const early = new LayerError(
      'TARGET_CHANGED',
      'e1 was button "Preview" and is now button "Pay now". Nothing was dispatched.',
    );
    const late = afterInput(early, true, 'The pointer was moved over it; no press was sent.') as LayerError;
    expect(late.code).toBe('TARGET_CHANGED');
    expect(late.delivered).toBe(true);
    expect(late.message).toBe(
      'e1 was button "Preview" and is now button "Pay now". The pointer was moved over it; no press was sent.',
    );
    const other = new Error('boom');
    expect(afterInput(other, true, 'x')).toBe(other);
  });
});

describe('an approval bound to what was judged', () => {
  const facts = (name: string) => ({
    tag: 'input',
    type: 'text',
    classes: '',
    money: '',
    submitter: false,
    form: {
      method: 'post',
      action: 'https://shop.test/pay',
      search: false,
      hasSubmitButton: true,
      blockingFields: 1,
      defaultButton: { name, disabled: false },
    },
  });
  it('tells two payments of the same category apart by the default button and the destination', () => {
    const judge = (name: string) =>
      basisOf({ category: 'pay', reason: `Enter submits the form through "${name}"` }, 'enter', facts(name) as never);
    expect(judge('Pay $5')).not.toBe(judge('Pay $500'));
    expect(judge('Pay $5')).toBe(judge('Pay $5'));
    expect(judge('Pay $5')).toMatch(/→ POST https:\/\/shop\.test\/pay$/);
  });
});

describe('request URLs in evidence', () => {
  const page = 'https://shop.test/checkout';
  it('prints the path, never the query, the fragment or user information', () => {
    expect(requestUrl('https://shop.test/verify?otp=246810', page)).toBe('/verify?…');
    expect(requestUrl('https://shop.test/api/items', page)).toBe('/api/items');
    expect(requestUrl('https://user:secret@pay.test:8443/charge?card=4111111111111111#x', page)).toBe(
      'https://pay.test:8443/charge?…',
    );
  });
  it('prints only the scheme of other URLs', () => {
    expect(requestUrl('data:text/plain,246810', page)).toBe('data:…');
    expect(requestUrl('not a url', page)).toBe('(unreadable URL)');
  });
});

describe('options of a select in the outline', () => {
  // A listbox (a select with size) holding the given option labels, with the given attributes.
  const frameWith = (labels: string[], autocomplete?: string): FrameCapture => {
    const ax = (id: string, role: string, name: string, extra: Partial<AXNode> = {}): AXNode => ({
      nodeId: id,
      ignored: false,
      role: { type: 'role', value: role },
      name: { type: 'computedString', value: name },
      ...extra,
    });
    const options = labels.map((label, i) =>
      ax(`o${i}`, 'option', label, { parentId: 'l', backendDOMNodeId: 10 + i, childIds: [`t${i}`] }),
    );
    const texts = labels.map((label, i) => ax(`t${i}`, 'StaticText', label, { parentId: `o${i}` }));
    return {
      frameId: 'F',
      sessionId: undefined,
      loaderId: 'L',
      url: 'https://shop.test/',
      ownerBackendNodeId: null,
      status: 'captured',
      nodes: [
        ax('r', 'RootWebArea', '', { childIds: ['l'], backendDOMNodeId: 1 }),
        ax('l', 'listbox', 'Saved cards', { parentId: 'r', backendDOMNodeId: 2, childIds: options.map(o => o.nodeId) }),
        ...options,
        ...texts,
      ],
      fields: autocomplete ? { '2': { tag: 'select', autocomplete } } : {},
    } as FrameCapture;
  };
  const printed = (frame: FrameCapture) => renderLines(buildFrameTree(frame)).map(l => l.text.trim());

  it('masks card numbers in any select, and labels without letters in a sensitive one', () => {
    const labels = ['4111 1111 1111 1111', '482913', 'Visa ending 1111'];
    expect(printed(frameWith(labels))).toEqual([
      'listbox "Saved cards"',
      'option "••••••" (masked)',
      'option "482913"',
      'option "Visa ending 1111"',
    ]);
    const sensitive = printed(frameWith(labels, 'cc-number'));
    expect(sensitive.filter(l => l === 'option "••••••" (masked)')).toHaveLength(2);
    expect(sensitive).toContain('option "Visa ending 1111"');
    expect(sensitive.join('\n')).not.toMatch(/4111 1111|482913/);
  });
});
