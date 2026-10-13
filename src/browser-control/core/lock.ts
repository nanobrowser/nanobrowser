// The per-tab lock: one action or capture at a time per tab. Overlapping operations on one tab
// are the mechanism behind the old layer's double click.

export class TabLocks {
  #tails = new Map<number, Promise<void>>();

  /** Runs fn when every earlier operation on the tab has finished. Operations on different tabs do not wait. */
  async run<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(tabId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => (release = resolve));
    const tail = previous.then(() => current);
    this.#tails.set(tabId, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.#tails.get(tabId) === tail) this.#tails.delete(tabId);
    }
  }

  isBusy(tabId: number): boolean {
    return this.#tails.has(tabId);
  }
}
