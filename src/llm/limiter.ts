// Concurrent calls per local server: many local servers handle one request at a time, so the gateway queues requests
// to the same server rather than sending them together and timing out.
const slots = new Map<string, { active: number; queue: Array<() => void> }>();

/** Runs `fn` when one of `max` slots for `key` is free. */
export async function withSlot<T>(key: string, max: number, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let slot = slots.get(key);
  if (!slot) slots.set(key, (slot = { active: 0, queue: [] }));
  const s = slot;
  if (s.active >= max) {
    await new Promise<void>((resolve, reject) => {
      const go = () => resolve();
      s.queue.push(go);
      signal?.addEventListener('abort', () => {
        const i = s.queue.indexOf(go);
        if (i >= 0) s.queue.splice(i, 1);
        reject(Object.assign(new Error('aborted while waiting for the server'), { name: 'AbortError' }));
      });
    });
  }
  s.active++;
  try {
    return await fn();
  } finally {
    s.active--;
    s.queue.shift()?.();
  }
}
