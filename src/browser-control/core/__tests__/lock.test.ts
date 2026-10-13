import { describe, expect, it } from 'vitest';
import { TabLocks } from '../lock';

const tick = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('TabLocks (no overlapping dispatch on a tab)', () => {
  it('runs operations on one tab one at a time, in order', async () => {
    const locks = new TabLocks();
    const events: string[] = [];
    const op = (name: string, ms: number) =>
      locks.run(1, async () => {
        events.push(`start ${name}`);
        await tick(ms);
        events.push(`end ${name}`);
        return name;
      });
    const results = await Promise.all([op('a', 20), op('b', 5), op('c', 1)]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(events).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('does not make different tabs wait for each other', async () => {
    const locks = new TabLocks();
    const events: string[] = [];
    await Promise.all([
      locks.run(1, async () => {
        events.push('start 1');
        await tick(20);
        events.push('end 1');
      }),
      locks.run(2, async () => {
        events.push('start 2');
        events.push('end 2');
      }),
    ]);
    expect(events.indexOf('end 2')).toBeLessThan(events.indexOf('end 1'));
  });

  it('releases the lock when an operation throws', async () => {
    const locks = new TabLocks();
    await expect(locks.run(1, async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(locks.isBusy(1)).toBe(false);
    await expect(locks.run(1, async () => 'next')).resolves.toBe('next');
  });
});
