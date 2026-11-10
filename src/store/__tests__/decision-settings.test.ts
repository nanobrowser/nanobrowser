import { describe, expect, it } from 'vitest';
import { mergeSettings } from '../settings';

describe('decision provider settings', () => {
  it('leaves decision APIs disabled for new and older settings', () => {
    expect(mergeSettings(undefined)).toMatchObject({ decisionProvider: null });
    expect(mergeSettings({ turnCap: 7 })).toMatchObject({ decisionProvider: null, turnCap: 7 });
  });
});
