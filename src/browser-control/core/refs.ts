// Refs: a durable label bound to (session, frame, document, backend node).
// Labels are an epoch prefix plus a counter shared by every tab; a label is never handed out twice.
import { LayerError } from '../protocol/errors';
import type { EpochStore, SessionId } from './ports';

export interface RefPrint {
  /** Chrome's accessibility role and name, for refs from the accessibility tree. */
  role: string;
  name: string;
  /**
   * The name as it was printed, when a masked value was replaced in it. `name` is then Chrome's name, with
   * the value: it is what revalidation compares and what the gate classifies, and it is never printed. Every message
   * uses `shownName`.
   */
  shown?: string;
  /** Tag and text digest, for refs found only by layout signals. */
  tag: string;
  text: string;
  /** For layout refs: the attributes and labels the name can come from (`nameSources`), for revalidation. */
  names?: string;
  /** Ordinal among nodes of the same role and name in the frame, when there is more than one. */
  nth: number | null;
  /** Enclosing row or list item and a digest of its content. */
  context: { backendNodeId: number; digest: string } | null;
}

/** A ref's name for messages, receipts and prompts: never the name that holds a masked value. */
export function shownName(print: Pick<RefPrint, 'name' | 'shown'>): string {
  return print.shown ?? print.name;
}

export type StaleReason = 'document' | 'frame-detached' | 'debugger-detached';

export interface RefRecord {
  ref: string;
  tabId: number;
  sessionId: SessionId;
  frameId: string;
  loaderId: string;
  backendNodeId: number;
  source: 'ax' | 'layout';
  print: RefPrint;
  /** Set once the ref can no longer be used; the record is kept so the error can say why. */
  stale: StaleReason | null;
}

export interface NodeKey {
  tabId: number;
  sessionId: SessionId;
  frameId: string;
  loaderId: string;
  backendNodeId: number;
}

function keyOf(k: NodeKey): string {
  return `${k.tabId}|${k.sessionId ?? ''}|${k.frameId}|${k.loaderId}|${k.backendNodeId}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Epochs

/** Persisted epochs in lowercase base 26: 0 → a, 25 → z, 26 → ba. */
export function epochLabel(epoch: number): string {
  if (!Number.isInteger(epoch) || epoch < 0) throw new Error(`Invalid epoch ${epoch}`);
  let n = epoch;
  let out = '';
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  } while (n > 0);
  return out;
}

/** Twelve uppercase letters, about 56 bits; a namespace persisted epochs can never reach. */
export function randomEpochLabel(random: (n: number) => Uint8Array = defaultRandom): string {
  const bytes = random(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += String.fromCharCode(65 + (bytes[i] % 26));
  return out;
}

function defaultRandom(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export interface Epoch {
  prefix: string;
  /** False when storage failed and the random uppercase prefix is in use. */
  persisted: boolean;
}

/**
 * Reserves the epoch for this registry lifetime before any ref is issued: read the counter, write the next value,
 * use it only once the write is confirmed. If either step fails, use a random uppercase prefix.
 */
export async function reserveEpoch(store: EpochStore, random?: (n: number) => Uint8Array): Promise<Epoch> {
  try {
    const last = await store.read();
    const next = last === null ? 0 : last + 1;
    await store.write(next);
    return { prefix: epochLabel(next), persisted: true };
  } catch {
    return { prefix: randomEpochLabel(random), persisted: false };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Registry

/** How many stale records are kept for diagnostics before the oldest are forgotten (then REF_UNKNOWN). */
const MAX_STALE = 20_000;

export class RefRegistry {
  readonly prefix: string;
  #counter = 0;
  #byKey = new Map<string, RefRecord>();
  #byRef = new Map<string, RefRecord>();
  #stale: string[] = [];
  #mainLoader = new Map<number, { frameId: string; loaderId: string }>();

  constructor(epoch: Epoch | string) {
    this.prefix = typeof epoch === 'string' ? epoch : epoch.prefix;
  }

  /** The ref for a node: the existing one if this node in this document already has one, else a new label. */
  assign(key: NodeKey, source: RefRecord['source'], print: RefPrint): RefRecord {
    const k = keyOf(key);
    const existing = this.#byKey.get(k);
    if (existing && !existing.stale) {
      existing.print = print;
      existing.source = source;
      return existing;
    }
    const record: RefRecord = { ref: `${this.prefix}${++this.#counter}`, ...key, source, print, stale: null };
    this.#byKey.set(k, record);
    this.#byRef.set(record.ref, record);
    return record;
  }

  get(ref: string): RefRecord | undefined {
    return this.#byRef.get(ref);
  }

  /** The live ref of a node in a document, if it has one. */
  findLive(tabId: number, frameId: string, loaderId: string, backendNodeId: number): RefRecord | undefined {
    for (const record of this.#byKey.values()) {
      if (
        record.tabId === tabId &&
        record.frameId === frameId &&
        record.loaderId === loaderId &&
        record.backendNodeId === backendNodeId &&
        !record.stale
      ) {
        return record;
      }
    }
    return undefined;
  }

  /** The next label number; exposed for tests of the never-reset rule. */
  get counter(): number {
    return this.#counter;
  }

  live(tabId: number): RefRecord[] {
    return [...this.#byRef.values()].filter(r => r.tabId === tabId && !r.stale);
  }

  #markStale(predicate: (r: RefRecord) => boolean, reason: StaleReason): number {
    let n = 0;
    for (const record of this.#byRef.values()) {
      if (record.stale || !predicate(record)) continue;
      record.stale = reason;
      this.#byKey.delete(keyOf(record));
      this.#stale.push(record.ref);
      n++;
    }
    while (this.#stale.length > MAX_STALE) this.#byRef.delete(this.#stale.shift()!);
    return n;
  }

  /**
   * Brings the tab's refs in line with its current frames: a frame that is gone drops its refs as detached; a frame
   * with a new loaderId drops its refs as a new document. A frame's descendants are covered too, since they are
   * either gone or carry new loader IDs themselves.
   */
  reconcile(tabId: number, frames: ReadonlyArray<{ frameId: string; loaderId: string; parentFrameId?: string }>): void {
    // A new document in the main frame drops every ref of the tab as a document change, even though
    // its child frames come back with new frame IDs.
    const main = frames.find(f => !f.parentFrameId);
    if (main) {
      const previous = this.#mainLoader.get(tabId);
      if (previous && previous.frameId === main.frameId && previous.loaderId !== main.loaderId) {
        this.#markStale(r => r.tabId === tabId, 'document');
      }
      this.#mainLoader.set(tabId, { frameId: main.frameId, loaderId: main.loaderId });
    }
    const current = new Map(frames.map(f => [f.frameId, f.loaderId]));
    this.#markStale(r => r.tabId === tabId && !current.has(r.frameId), 'frame-detached');
    this.#markStale(r => r.tabId === tabId && current.get(r.frameId) !== r.loaderId, 'document');
  }

  /** A frame committed a new document. */
  documentChanged(tabId: number, frameIds: ReadonlyArray<string>): void {
    const ids = new Set(frameIds);
    this.#markStale(r => r.tabId === tabId && ids.has(r.frameId), 'document');
  }

  /** Frames or their sessions went away. */
  framesDetached(tabId: number, frameIds: ReadonlyArray<string>): void {
    const ids = new Set(frameIds);
    this.#markStale(r => r.tabId === tabId && ids.has(r.frameId), 'frame-detached');
  }

  /** Debugger detach, or the tab closed. The counter continues, so no label is handed out twice. */
  tabDetached(tabId: number): void {
    this.#mainLoader.delete(tabId);
    this.#markStale(r => r.tabId === tabId, 'debugger-detached');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Known sets

/** What a session was shown for a ref: the baseline its actions are revalidated against. */
export interface Shown {
  source: RefRecord['source'];
  print: RefPrint;
}

/**
 * The refs an agent session has been shown, per tab: the last full observation plus later additions, each
 * with the print the session received. Every capture updates the shared record's print, including captures by other
 * sessions and nodes left out of the output, so revalidation compares with this copy, not with the record.
 * The copy comes from the observation that was returned (`Observation.shown`), a reused one included.
 */
export class KnownSet {
  #byTab = new Map<number, Map<string, Shown>>();

  /** A full observation of the tab replaces what was known for it. */
  replace(tabId: number, shown: Iterable<[string, Shown]>): void {
    this.#byTab.set(tabId, new Map(shown));
  }

  /** Refs shown by a diff, a find or a scoped snapshot are added, with what they showed. */
  add(tabId: number, shown: Iterable<[string, Shown]>): void {
    let map = this.#byTab.get(tabId);
    if (!map) this.#byTab.set(tabId, (map = new Map()));
    for (const [ref, what] of shown) map.set(ref, what);
  }

  /** What the session was last shown for a ref. */
  shown(tabId: number, ref: string): Shown | undefined {
    return this.#byTab.get(tabId)?.get(ref);
  }

  remove(tabId: number, refs: Iterable<string>): void {
    const set = this.#byTab.get(tabId);
    if (set) for (const ref of refs) set.delete(ref);
  }

  forget(tabId: number): void {
    this.#byTab.delete(tabId);
  }

  has(tabId: number, ref: string): boolean {
    return this.#byTab.get(tabId)?.has(ref) ?? false;
  }

  size(tabId: number): number {
    return this.#byTab.get(tabId)?.size ?? 0;
  }
}

const STALE_ERRORS: Record<StaleReason, 'STALE_DOCUMENT' | 'FRAME_DETACHED' | 'DEBUGGER_DETACHED'> = {
  document: 'STALE_DOCUMENT',
  'frame-detached': 'FRAME_DETACHED',
  'debugger-detached': 'DEBUGGER_DETACHED',
};

/**
 * Looks a ref up for an action (the checks that need no CDP call).
 * A stale ref reports why it is stale even when it has left the known set, because that says more.
 * Returns the record as this session was shown it: its source and print are the session's baseline.
 */
export function lookupRef(registry: RefRegistry, known: KnownSet, ref: string, tabId?: number): RefRecord {
  const record = registry.get(ref);
  if (!record) throw new LayerError('REF_UNKNOWN', `Ref ${ref} is not known`);
  if (tabId !== undefined && tabId !== record.tabId) {
    throw new LayerError('REF_TAB_MISMATCH', `Ref ${ref} belongs to tab ${record.tabId}, not tab ${tabId}`);
  }
  if (record.stale) {
    const code = STALE_ERRORS[record.stale];
    const what =
      record.stale === 'document'
        ? 'its frame has loaded a new document'
        : record.stale === 'frame-detached'
          ? 'its frame is gone'
          : 'the debugger detached from its tab';
    throw new LayerError(code, `Ref ${ref} is no longer valid: ${what}`);
  }
  if (!known.has(record.tabId, ref)) {
    throw new LayerError('REF_NOT_PRESENTED', `Ref ${ref} was not in the latest observation of tab ${record.tabId}`);
  }
  const shown = known.shown(record.tabId, ref);
  return shown ? { ...record, ...shown } : record;
}
