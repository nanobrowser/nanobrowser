import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@src/browser-control';
import { HIDE_WAIT_MS, PageBorder } from '../border';
import type { BorderState } from '../border';
import { screenshotTab } from '../agent-session';

/** Two conversations: a with tabs 1 and 2, b with tab 3. */
function setup(options: { enabled?: boolean; hide?: () => Promise<void> } = {}) {
  const sent: Array<[number, BorderState, string?]> = [];
  const owner: Record<number, string> = { 1: 'a', 2: 'a', 3: 'b' };
  let enabled = options.enabled ?? true;
  const border = new PageBorder({
    conversationOf: async tabId => owner[tabId] ?? null,
    tabsOf: async c =>
      Object.keys(owner)
        .map(Number)
        .filter(t => owner[t] === c),
    scopedTabs: async () => Object.keys(owner).map(Number),
    enabled: async () => enabled,
    inject: async (tabId, state, documentId) => {
      sent.push(documentId ? [tabId, state, documentId] : [tabId, state]);
      if (state === 'hidden' && options.hide) await options.hide();
    },
  });
  return { border, sent, owner, setEnabled: (on: boolean) => (enabled = on) };
}

afterEach(() => vi.useRealTimers());

describe('PageBorder', () => {
  it('draws the border on every tab of a working run, and removes it when the run stops working', async () => {
    const { border, sent } = setup();
    await border.status('a', 'running');
    expect(sent).toEqual([
      [1, 'on'],
      [2, 'on'],
    ]);
    sent.length = 0;
    await border.status('a', 'awaiting_user');
    expect(sent).toEqual([
      [1, 'off'],
      [2, 'off'],
    ]);
  });

  it('draws nothing while the setting is off, and follows the setting when it changes', async () => {
    const { border, sent, setEnabled } = setup({ enabled: false });
    await border.status('a', 'running');
    expect(sent.every(([, s]) => s === 'off')).toBe(true);
    sent.length = 0;
    setEnabled(true);
    await border.settingChanged();
    expect(sent).toEqual([
      [1, 'on'],
      [2, 'on'],
      [3, 'off'],
    ]);
  });

  it('a tab that joins a working run gets the border; a tab that leaves loses it', async () => {
    const { border, sent, owner } = setup();
    await border.status('a', 'running');
    sent.length = 0;
    owner[4] = 'a';
    await border.tabsChanged([4], [2]);
    expect(sent).toEqual([
      [4, 'on'],
      [2, 'off'],
    ]);
  });

  it('a new document of a working tab gets the border; other tabs are left alone', async () => {
    const { border, sent } = setup();
    await border.status('a', 'running');
    sent.length = 0;
    await border.committed(1, 'doc-1');
    await border.committed(3, 'doc-3');
    expect(sent).toEqual([[1, 'on', 'doc-1']]);
  });

  it('turns every scoped tab off at worker start', async () => {
    const { border, sent } = setup();
    await border.start();
    expect(sent).toEqual([
      [1, 'off'],
      [2, 'off'],
      [3, 'off'],
    ]);
  });

  it('fades the border out for a screenshot and brings it back after', async () => {
    const { border, sent } = setup();
    await border.status('a', 'running');
    sent.length = 0;
    const order: string[] = [];
    const result = await border.around(1, async () => {
      order.push(`capture after ${sent.map(([t, s]) => `${t}:${s}`).join(',')}`);
      return 'image';
    });
    // Showing it again is not waited for.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(result).toBe('image');
    expect(order).toEqual(['capture after 1:hidden']);
    expect(sent).toEqual([
      [1, 'hidden'],
      [1, 'on'],
    ]);
  });

  it('a screenshot of a tab with no border is captured at once', async () => {
    const { border, sent } = setup();
    expect(await border.around(1, async () => 'image')).toBe('image');
    expect(sent).toEqual([]);
  });

  it('captures anyway when the border does not hide in time', async () => {
    vi.useFakeTimers();
    const { border } = setup({ hide: () => new Promise(() => undefined) });
    await border.status('a', 'running');
    let captured = false;
    const done = border.around(1, async () => (captured = true));
    await vi.advanceTimersByTimeAsync(HIDE_WAIT_MS - 10);
    expect(captured).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    await done;
    expect(captured).toBe(true);
  });

  it('screenshots of one tab that overlap share one fade', async () => {
    let fade!: () => void;
    const { border, sent } = setup({ hide: () => new Promise<void>(resolve => (fade = resolve)) });
    await border.status('a', 'running');
    sent.length = 0;
    const captured: string[] = [];
    const first = border.around(1, async () => captured.push('first'));
    const second = border.around(1, async () => captured.push('second'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(sent).toEqual([[1, 'hidden']]);
    expect(captured).toEqual([]);
    fade();
    await Promise.all([first, second]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(captured).toEqual(['first', 'second']);
    expect(sent).toEqual([
      [1, 'hidden'],
      [1, 'on'],
    ]);
  });

  it('a document that commits during a screenshot gets the border hidden', async () => {
    const { border, sent } = setup();
    await border.status('a', 'running');
    sent.length = 0;
    await border.around(1, async () => {
      await border.committed(1, 'doc-2');
    });
    expect(sent.slice(0, 2)).toEqual([
      [1, 'hidden'],
      [1, 'hidden', 'doc-2'],
    ]);
  });
});

describe('screenshotTab', () => {
  const session = (refs: Record<string, number>, active: number | null) =>
    ({
      activeTabId: active,
      controller: { registry: { get: (ref: string) => (ref in refs ? { tabId: refs[ref] } : undefined) } },
    }) as unknown as Session;

  it('is the ref’s tab first, then tabId, then the active tab', () => {
    expect(screenshotTab(session({ e5: 7 }, 1), { ref: 'e5', tabId: 9 })).toBe(7);
    expect(screenshotTab(session({}, 1), { tabId: 9 })).toBe(9);
    expect(screenshotTab(session({}, 1), {})).toBe(1);
  });

  it('is null for a ref the session does not know', () => {
    expect(screenshotTab(session({}, 1), { ref: 'e9' })).toBe(null);
  });
});
