import { describe, expect, it } from 'vitest';
import { PROBE_SOURCE } from '../index';

describe('probe string', () => {
  it('is self-contained: it runs with nothing from the module in scope', () => {
    const scope = {} as Record<string, unknown>;
    // Evaluate with a fresh global object, as the isolated world would; no DOM APIs are needed to install.
    new Function('globalThis', PROBE_SOURCE)(scope);
    const probe = scope.__nbProbe as { version: number; mutations(): number };
    expect(probe.version).toBe(1);
    expect(probe.mutations()).toBe(0);
  });

  it('installs once and cannot be replaced by later scripts in the same world', () => {
    const scope = {} as Record<string, unknown>;
    new Function('globalThis', PROBE_SOURCE)(scope);
    const first = scope.__nbProbe;
    new Function('globalThis', PROBE_SOURCE)(scope);
    expect(scope.__nbProbe).toBe(first);
    expect(() => {
      'use strict';
      (scope as { __nbProbe: unknown }).__nbProbe = 1;
    }).toThrow();
  });
});

describe('approximateName, the classifier’s fallback name', () => {
  const scope = {} as Record<string, unknown>;
  new Function('globalThis', PROBE_SOURCE)(scope);
  const probe = scope.__nbProbe as { approximateName(el: unknown): string };
  /** An element as approximateName reads it: tag, type, value, rendered text and attributes; no labels. */
  const element = (tagName: string, props: Record<string, unknown>, attrs: Record<string, string> = {}) => ({
    tagName,
    innerText: '',
    labels: [],
    getAttribute: (name: string) => attrs[name] ?? null,
    ...props,
  });

  it('never names a control that holds a value by what it holds', () => {
    expect(probe.approximateName(element('INPUT', { type: 'password', value: 'hunter2' }))).toBe('');
    expect(probe.approximateName(element('INPUT', { type: 'text', value: '4111111111111111' }))).toBe('');
    expect(probe.approximateName(element('SELECT', { innerText: '4111 1111 1111 1111', value: 'c1' }))).toBe('');
    expect(probe.approximateName(element('TEXTAREA', { innerText: '654321', value: '654321' }))).toBe('');
    expect(
      probe.approximateName(element('INPUT', { type: 'password', value: 'hunter2' }, { 'aria-label': 'Password' })),
    ).toBe('Password');
  });

  it('still names buttons by their text or caption', () => {
    expect(probe.approximateName(element('INPUT', { type: 'submit', value: 'Pay now' }))).toBe('Pay now');
    expect(probe.approximateName(element('BUTTON', { innerText: 'Delete', value: '' }))).toBe('Delete');
  });
});
