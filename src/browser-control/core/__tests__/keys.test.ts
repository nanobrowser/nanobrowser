import { describe, expect, it } from 'vitest';
import { dispatchedKey, keyMode, releaseActivates, splitChord, typedKey, typedMode } from '../interaction/keys';

const text = { tag: 'input', type: 'text' };
const button = { tag: 'button', type: 'submit' };
const link = { tag: 'a', type: '' };
const checkbox = { tag: 'input', type: 'checkbox' };
const textarea = { tag: 'textarea', type: 'textarea' };
const editable = { tag: 'div', type: '', contentEditable: true };

describe('keys the gate classifies', () => {
  it('splits a chord as the page port presses it', () => {
    expect(splitChord('Control+A')).toEqual({ modifiers: ['Control'], key: 'A' });
    expect(splitChord(' Shift + Enter ')).toEqual({ modifiers: ['Shift'], key: 'Enter' });
    expect(splitChord(' Enter')).toEqual({ modifiers: [], key: 'Enter' });
  });

  it('follows the key Puppeteer dispatches, not the name written', () => {
    for (const k of ['Enter', 'NumpadEnter', '\r', '\n']) expect(dispatchedKey(k)).toBe('Enter');
    for (const k of [' ', 'Space']) expect(dispatchedKey(k)).toBe('Space');
    expect(dispatchedKey('Escape')).toBe('Escape');
  });

  it('knows which key activates when it is released', () => {
    for (const k of [' ', 'Space']) expect(releaseActivates(k)).toBe(true);
    for (const k of ['Enter', 'NumpadEnter', '\n', 'Shift', 'a']) expect(releaseActivates(k)).toBe(false);
  });

  it('classifies a pressed key by the element it goes to', () => {
    expect(keyMode('NumpadEnter', text)).toBe('enter');
    expect(keyMode('Enter', textarea)).toBe('enter');
    expect(keyMode('Enter', { tag: 'select', type: 'select-one' })).toBe('enter');
    // Enter in a checkbox submits its form implicitly; Space toggles it.
    expect(keyMode('Enter', checkbox)).toBe('enter');
    expect(keyMode('Space', checkbox)).toBe('activate');
    expect(keyMode('NumpadEnter', button)).toBe('activate');
    expect(keyMode('Space', link)).toBe('activate');
    expect(keyMode('Space', text)).toBe('none');
    expect(keyMode('Escape', button)).toBe('none');
  });

  it('treats typed newlines and spaces as Enter and Space', () => {
    expect(typedKey('a\nb')).toBe('Enter');
    expect(typedKey('a\r')).toBe('Enter');
    expect(typedKey('hello world')).toBe('Space');
    expect(typedKey('hello')).toBeNull();
    expect(typedMode('4111\n', false, text)).toBe('enter');
    expect(typedMode(' ', false, button)).toBe('activate');
    expect(typedMode('hello world', false, text)).toBe('none');
    expect(typedMode('hello', false, text)).toBe('none');
    expect(typedMode('hello', true, text)).toBe('enter');
  });

  it('lets typed keys edit a textarea or contenteditable, but not submit:true', () => {
    expect(typedMode('line one\nline two', false, textarea)).toBe('none');
    expect(typedMode('a b\n', false, editable)).toBe('none');
    expect(typedMode('done', true, textarea)).toBe('enter');
  });

  it('takes the stronger mode when typed keys and submit differ', () => {
    expect(typedMode(' ', true, checkbox)).toBe('enter');
    expect(typedMode(' ', false, checkbox)).toBe('activate');
  });
});
