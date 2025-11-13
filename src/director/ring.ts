export class Ring<T> {
  private buf: T[];
  private idx = 0;
  private filled = 0;

  constructor(private readonly cap: number) {
    if (cap <= 0 || !Number.isFinite(cap)) {
      throw new Error('Ring capacity must be a positive finite number.');
    }
    this.buf = new Array<T>(cap);
  }

  push(value: T): void {
    this.buf[this.idx] = value;
    this.idx = (this.idx + 1) % this.cap;
    this.filled = Math.min(this.cap, this.filled + 1);
  }

  toArray(): T[] {
    if (this.filled < this.cap) {
      return this.buf.slice(0, this.filled);
    }
    const head = this.buf.slice(this.idx);
    const tail = this.buf.slice(0, this.idx);
    return head.concat(tail);
  }

  last(): T | undefined {
    if (this.filled === 0) {
      return undefined;
    }
    const i = (this.idx - 1 + this.cap) % this.cap;
    return this.buf[i];
  }

  size(): number {
    return this.filled;
  }

  capacity(): number {
    return this.cap;
  }
}
