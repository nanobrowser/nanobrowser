import { describe, expect, it } from 'vitest';
import { LayerError } from '../../protocol/errors';
import type { EpochStore } from '../ports';
import { epochLabel, KnownSet, lookupRef, randomEpochLabel, RefRegistry, reserveEpoch } from '../refs';
import type { NodeKey, RefPrint, RefRecord, Shown } from '../refs';

const print = (name = 'OK'): RefPrint => ({ role: 'button', name, tag: '', text: '', nth: null, context: null });
/** What an observation shows for records: their source and print as of now. */
const shownOf = (...records: RefRecord[]): Array<[string, Shown]> =>
  records.map(r => [r.ref, { source: r.source, print: r.print }]);
const key = (tabId: number, backendNodeId: number, frameId = 'F', loaderId = 'L1'): NodeKey => ({
  tabId,
  sessionId: undefined,
  frameId,
  loaderId,
  backendNodeId,
});

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof LayerError) return e.code;
    throw e;
  }
  return 'none';
}

class MemoryStore implements EpochStore {
  value: number | null = null;
  failRead = false;
  failWrite = false;
  async read() {
    if (this.failRead) throw new Error('read failed');
    return this.value;
  }
  async write(epoch: number) {
    if (this.failWrite) throw new Error('write failed');
    this.value = epoch;
  }
}

describe('epoch labels', () => {
  it('writes persisted epochs in lowercase base 26', () => {
    expect([0, 4, 25, 26, 27, 51, 52, 675, 676].map(epochLabel)).toEqual([
      'a',
      'e',
      'z',
      'ba',
      'bb',
      'bz',
      'ca',
      'zz',
      'baa',
    ]);
  });

  it('reserves the next epoch and persists it before use', async () => {
    const store = new MemoryStore();
    expect(await reserveEpoch(store)).toEqual({ prefix: 'a', persisted: true });
    expect(store.value).toBe(0);
    expect(await reserveEpoch(store)).toEqual({ prefix: 'b', persisted: true });
    expect(store.value).toBe(1);
  });

  it('falls back to twelve uppercase letters when storage fails, twice in a row', async () => {
    const store = new MemoryStore();
    store.failWrite = true;
    const first = await reserveEpoch(store);
    store.failWrite = false;
    store.failRead = true;
    const second = await reserveEpoch(store);
    for (const epoch of [first, second]) {
      expect(epoch.persisted).toBe(false);
      expect(epoch.prefix).toMatch(/^[A-Z]{12}$/);
    }
    expect(first.prefix).not.toBe(second.prefix);
    // No label from either lifetime matches the other.
    const a = new RefRegistry(first);
    const b = new RefRegistry(second);
    const labelsA = new Set([1, 2, 3].map(n => a.assign(key(1, n), 'ax', print()).ref));
    expect([1, 2, 3].some(n => labelsA.has(b.assign(key(1, n), 'ax', print()).ref))).toBe(false);
  });

  it('keeps the random namespace apart from persisted epochs', () => {
    const fixed = (n: number) => new Uint8Array(n).fill(0);
    expect(randomEpochLabel(fixed)).toBe('AAAAAAAAAAAA');
    expect(randomEpochLabel(fixed)).not.toEqual(randomEpochLabel(fixed).toLowerCase());
  });
});

describe('ref registry (refs fail closed)', () => {
  it('keeps the same label for the same node in the same document', () => {
    const registry = new RefRegistry('e');
    const first = registry.assign(key(1, 10), 'ax', print());
    const again = registry.assign(key(1, 10), 'ax', print('renamed'));
    expect(again.ref).toBe(first.ref);
    expect(again.print.name).toBe('renamed');
  });

  it('shares one counter across tabs, so two tabs never hold the same label', () => {
    const registry = new RefRegistry('e');
    const refs = [registry.assign(key(1, 10), 'ax', print()), registry.assign(key(2, 10), 'ax', print())];
    expect(refs.map(r => r.ref)).toEqual(['e1', 'e2']);
  });

  it('keys by session as well, because backend IDs from different processes can collide', () => {
    const registry = new RefRegistry('e');
    const a = registry.assign({ ...key(1, 10), sessionId: 'S1' }, 'ax', print());
    const b = registry.assign({ ...key(1, 10), sessionId: 'S2' }, 'ax', print());
    expect(a.ref).not.toBe(b.ref);
  });

  it('drops a frame’s refs when its document changes, and gives the node a new label in the new document', () => {
    const registry = new RefRegistry('e');
    const known = new KnownSet();
    const old = registry.assign(key(1, 10, 'F', 'L1'), 'ax', print());
    const other = registry.assign(key(1, 20, 'G', 'L9'), 'ax', print());
    known.replace(1, shownOf(old, other));
    registry.reconcile(1, [
      { frameId: 'F', loaderId: 'L2' },
      { frameId: 'G', loaderId: 'L9' },
    ]);
    expect(errorCode(() => lookupRef(registry, known, old.ref))).toBe('STALE_DOCUMENT');
    expect(lookupRef(registry, known, other.ref).ref).toBe(other.ref);
    const fresh = registry.assign(key(1, 10, 'F', 'L2'), 'ax', print());
    expect(fresh.ref).not.toBe(old.ref);
  });

  it('drops every ref of the tab as a document change when the main frame loads a new document', () => {
    const registry = new RefRegistry('e');
    const known = new KnownSet();
    registry.reconcile(1, [
      { frameId: 'main', loaderId: 'M1' },
      { frameId: 'child', loaderId: 'C1', parentFrameId: 'main' },
    ]);
    const inChild = registry.assign(key(1, 10, 'child', 'C1'), 'ax', print());
    known.replace(1, shownOf(inChild));
    // After a reload the child frame comes back with a new frame ID.
    registry.reconcile(1, [
      { frameId: 'main', loaderId: 'M2' },
      { frameId: 'child2', loaderId: 'C2', parentFrameId: 'main' },
    ]);
    expect(errorCode(() => lookupRef(registry, known, inChild.ref))).toBe('STALE_DOCUMENT');
  });

  it('keeps refs across a same-document navigation (the loaderId does not change)', () => {
    const registry = new RefRegistry('e');
    const known = new KnownSet();
    const r = registry.assign(key(1, 10), 'ax', print());
    known.replace(1, shownOf(r));
    registry.reconcile(1, [{ frameId: 'F', loaderId: 'L1' }]);
    expect(lookupRef(registry, known, r.ref).stale).toBeNull();
  });

  it('drops refs of a detached frame as FRAME_DETACHED', () => {
    const registry = new RefRegistry('e');
    const known = new KnownSet();
    const r = registry.assign(key(1, 10, 'child'), 'ax', print());
    known.replace(1, shownOf(r));
    registry.reconcile(1, [{ frameId: 'main', loaderId: 'M' }]);
    expect(errorCode(() => lookupRef(registry, known, r.ref))).toBe('FRAME_DETACHED');
  });

  it('drops a tab’s refs on debugger detach and continues the counter after reattach', () => {
    const registry = new RefRegistry('e');
    const known = new KnownSet();
    const before = registry.assign(key(1, 10), 'ax', print());
    known.replace(1, shownOf(before));
    registry.tabDetached(1);
    expect(errorCode(() => lookupRef(registry, known, before.ref))).toBe('DEBUGGER_DETACHED');
    const after = registry.assign(key(1, 10), 'ax', print());
    expect(after.ref).toBe('e2');
  });

  it('rejects labels it never issued, including labels of an earlier epoch', () => {
    const earlier = new RefRegistry('d');
    const label = earlier.assign(key(1, 10), 'ax', print()).ref;
    const registry = new RefRegistry('e');
    registry.assign(key(1, 10), 'ax', print());
    expect(errorCode(() => lookupRef(registry, new KnownSet(), label))).toBe('REF_UNKNOWN');
  });

  it('rejects a live ref the agent was not shown (REF_NOT_PRESENTED)', () => {
    const registry = new RefRegistry('e');
    const known = new KnownSet();
    const shown = registry.assign(key(1, 10), 'ax', print());
    const cut = registry.assign(key(1, 11), 'ax', print());
    known.replace(1, shownOf(shown));
    expect(errorCode(() => lookupRef(registry, known, cut.ref))).toBe('REF_NOT_PRESENTED');
    known.add(1, shownOf(cut));
    expect(lookupRef(registry, known, cut.ref).ref).toBe(cut.ref);
  });

  it('rejects a ref used with a different tabId (REF_TAB_MISMATCH)', () => {
    const registry = new RefRegistry('e');
    const known = new KnownSet();
    const r = registry.assign(key(1, 10), 'ax', print());
    known.replace(1, shownOf(r));
    expect(errorCode(() => lookupRef(registry, known, r.ref, 2))).toBe('REF_TAB_MISMATCH');
    expect(lookupRef(registry, known, r.ref, 1).tabId).toBe(1);
  });

  it('replaces the known set of a tab on a full observation', () => {
    const known = new KnownSet();
    const fake = (...refs: string[]) => refs.map(ref => [ref, { source: 'ax', print: print() }] as [string, Shown]);
    known.replace(1, fake('e1', 'e2'));
    known.add(2, fake('e3'));
    known.replace(1, fake('e4'));
    expect([known.has(1, 'e1'), known.has(1, 'e4'), known.has(2, 'e3')]).toEqual([false, true, true]);
  });

  it('revalidates against what this session was shown, not the latest capture', () => {
    const registry = new RefRegistry('e');
    const mine = new KnownSet();
    const theirs = new KnownSet();
    const record = registry.assign(key(1, 10), 'ax', print('Preview'));
    // What an observation showed is copied when it is shown, so a later capture cannot change it.
    const shownThen = shownOf(record);
    mine.replace(1, shownThen);
    // Another session's capture, or a capture of mine that did not print the ref, sees the node renamed.
    registry.assign(key(1, 10), 'ax', print('Delete account'));
    theirs.replace(1, shownOf(record));
    expect(lookupRef(registry, mine, record.ref).print.name).toBe('Preview');
    expect(lookupRef(registry, theirs, record.ref).print.name).toBe('Delete account');
    // A reused observation shows its own print again: the baseline stays "Preview".
    mine.add(1, shownThen);
    expect(lookupRef(registry, mine, record.ref).print.name).toBe('Preview');
  });
});
