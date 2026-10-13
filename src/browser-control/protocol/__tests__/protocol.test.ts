import { describe, expect, it } from 'vitest';
import {
  argsJsonSchema,
  ClickArgsSchema,
  DEFAULT_HINTS,
  DELIVERED_HINTS,
  ERROR_CODES,
  hintFor,
  isReadOnly,
  LayerError,
  listTools,
  TargetSchema,
  TOOL_SPECS,
  toolSpec,
} from '../index';

describe('targets', () => {
  it('accepts each target form', () => {
    expect(TargetSchema.safeParse({ ref: 'e12' }).success).toBe(true);
    expect(TargetSchema.safeParse({ role: 'button', name: 'Delete', nth: 1, within: 'e3' }).success).toBe(true);
    expect(TargetSchema.safeParse({ selector: '#pay' }).success).toBe(true);
    expect(TargetSchema.safeParse({ x: 10, y: 20 }).success).toBe(true);
  });

  it('rejects mixed or empty targets', () => {
    expect(TargetSchema.safeParse({ ref: 'e12', x: 1, y: 2 }).success).toBe(false);
    expect(TargetSchema.safeParse({}).success).toBe(false);
    expect(TargetSchema.safeParse({ ref: '' }).success).toBe(false);
  });

  it('rejects unknown arguments', () => {
    expect(ClickArgsSchema.safeParse({ target: { ref: 'e1' }, force: true }).success).toBe(false);
  });
});

describe('catalogue', () => {
  it('has unique names and a JSON schema for every tool', () => {
    const names = TOOL_SPECS.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const spec of TOOL_SPECS) expect(argsJsonSchema(spec)).toHaveProperty('type', 'object');
  });

  it('lists only available tools, and capability tools only when enabled', () => {
    expect(listTools(new Set()).every(t => t.available && t.capability === 'core')).toBe(true);
    const human = toolSpec('ask_user')!;
    expect(listTools(new Set(['human'])).includes(human)).toBe(human.available);
  });

  it('marks tabs read-only only for list and select', () => {
    const tabs = toolSpec('tabs')!;
    expect(isReadOnly(tabs, { action: 'list' })).toBe(true);
    expect(isReadOnly(tabs, { action: 'open' })).toBe(false);
  });
});

describe('errors', () => {
  it('has a hint for every code', () => {
    for (const code of ERROR_CODES) expect(DEFAULT_HINTS[code]).toBeTruthy();
  });

  it('defaults to not delivered', () => {
    const error = new LayerError('NODE_DETACHED', 'gone');
    expect(error.toProtocol()).toEqual({
      code: 'NODE_DETACHED',
      message: 'gone',
      delivered: false,
      hint: DEFAULT_HINTS.NODE_DETACHED,
    });
  });

  it('never calls a retry safe once input was delivered', () => {
    expect(new LayerError('INTERCEPTED', 'cancelled').hint).toMatch(/retrying is safe/);
    for (const delivered of [true, 'unknown'] as const) {
      const hint = new LayerError('INTERCEPTED', 'part way', { delivered }).hint;
      expect(hint).not.toMatch(/retrying is safe/);
      expect(hint).toMatch(/reached the page/);
    }
    expect(new LayerError('INTERCEPTED', 'part way', { delivered: true, hint: 'given' }).hint).toBe('given');
  });

  it('gives the hint of a code for a delivery, for a wrapper that changes the delivery (fill_form)', () => {
    expect(hintFor('INTERCEPTED', false)).toBe(DEFAULT_HINTS.INTERCEPTED);
    expect(hintFor('INTERCEPTED', true)).toBe(DELIVERED_HINTS.INTERCEPTED);
    expect(hintFor('USER_DECLINED', true)).toBe(DEFAULT_HINTS.USER_DECLINED);
  });
});
