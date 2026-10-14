import { afterEach, describe, expect, it, vi } from 'vitest';
import { Journal } from '../journal';
import type { PanelEvent } from '@src/ui/protocol';

afterEach(() => vi.useRealTimers());

describe('Journal', () => {
  it('numbers events per conversation and sends them to subscribers', () => {
    const journal = new Journal();
    const seen: PanelEvent[] = [];
    journal.subscribe('c1', e => seen.push(e));
    journal.emit('c1', { type: 'run_status', status: 'running' });
    journal.emit('c2', { type: 'run_status', status: 'running' });
    journal.emit('c1', { type: 'run_status', status: 'done' });
    expect(seen.map(e => [e.seq, e.conversationId])).toEqual([
      [1, 'c1'],
      [2, 'c1'],
    ]);
  });

  it('coalesces text updates to about 50 ms and keeps the streaming text apart', () => {
    vi.useFakeTimers();
    const journal = new Journal();
    const seen: PanelEvent[] = [];
    journal.subscribe('c', e => seen.push(e));
    journal.emit('c', { type: 'message_start', id: 'm' });
    for (const text of ['H', 'He', 'Hel', 'Hell', 'Hello'])
      journal.emit('c', { type: 'message_update', id: 'm', text });
    expect(seen.filter(e => e.type === 'message_update')).toHaveLength(0);
    vi.advanceTimersByTime(60);
    const updates = seen.filter(e => e.type === 'message_update');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ text: 'Hello' });
    expect(journal.streaming('c')).toEqual({ id: 'm', text: 'Hello' });
    // Updates are not kept for replay; the streaming text is sent whole instead.
    expect(journal.since('c', 0)!.map(e => e.type)).toEqual(['message_start']);
  });

  it('replays what a reconnecting panel missed, or asks for a snapshot when the window is gone', () => {
    const journal = new Journal();
    for (let i = 0; i < 305; i++) journal.emit('c', { type: 'turn_start', turn: i });
    expect(journal.since('c', 300)!.map(e => e.seq)).toEqual([301, 302, 303, 304, 305]);
    expect(journal.since('c', 305)).toEqual([]);
    expect(journal.since('c', 1)).toBeNull();
  });
});
