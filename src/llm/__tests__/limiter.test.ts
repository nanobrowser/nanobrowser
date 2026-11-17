import { describe, expect, it } from 'vitest';
import { withSlot } from '../limiter';

describe('withSlot', () => {
  it('reserves a released slot for the queued request before a new request arrives', async () => {
    const firstRelease = Promise.withResolvers<void>();
    const queuedRelease = Promise.withResolvers<void>();
    const newcomerRelease = Promise.withResolvers<void>();
    const started: string[] = [];
    const first = withSlot('handoff', 1, async () => {
      started.push('first');
      await firstRelease.promise;
    });
    const queued = withSlot('handoff', 1, async () => {
      started.push('queued');
      await queuedRelease.promise;
    });
    firstRelease.resolve();
    const newcomer = Promise.resolve()
      .then(() => undefined)
      .then(() =>
        withSlot('handoff', 1, async () => {
          started.push('newcomer');
          await newcomerRelease.promise;
        }),
      );
    await first;
    const beforeQueuedRelease = [...started];
    queuedRelease.resolve();
    await queued;
    newcomerRelease.resolve();
    await newcomer;
    expect(beforeQueuedRelease).toEqual(['first', 'queued']);
    expect(started).toEqual(['first', 'queued', 'newcomer']);
  });

  it('passes the slot to the next waiter when a queued request is aborted', async () => {
    const release = Promise.withResolvers<void>();
    const first = withSlot('aborted-waiter', 1, () => release.promise);
    const controller = new AbortController();
    let abortedStarted = false;
    const aborted = withSlot(
      'aborted-waiter',
      1,
      async () => {
        abortedStarted = true;
      },
      controller.signal,
    );
    const next = withSlot('aborted-waiter', 1, async () => 'next');
    const rejected = expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    release.resolve();
    await first;
    expect(await next).toBe('next');
    expect(abortedStarted).toBe(false);
  });

  it('releases the slot when the running request fails', async () => {
    const release = Promise.withResolvers<void>();
    const failure = new Error('failed');
    const first = withSlot('failed-request', 1, async () => {
      await release.promise;
      throw failure;
    });
    const next = withSlot('failed-request', 1, async () => 'next');
    const rejected = expect(first).rejects.toBe(failure);
    release.resolve();
    await rejected;
    expect(await next).toBe('next');
  });
});
