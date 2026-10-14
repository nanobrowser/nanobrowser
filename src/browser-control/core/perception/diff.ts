// Snapshot diffs: because refs are durable, the page state after an action can be the changes since the outline the
// session last saw. The diff is exact: the previous outline with it applied is the fresh outline.

export interface DiffOp {
  op: 'keep' | 'add' | 'remove';
  line: string;
}

const MAX_LINES = 4_000;

/** A line-level edit script by longest common subsequence. */
export function diffLines(prev: string[], next: string[]): DiffOp[] | null {
  if (prev.length > MAX_LINES || next.length > MAX_LINES) return null;
  // Trim the common head and tail first; most diffs are small changes in a long outline.
  let head = 0;
  while (head < prev.length && head < next.length && prev[head] === next[head]) head++;
  let tail = 0;
  while (
    tail < prev.length - head &&
    tail < next.length - head &&
    prev[prev.length - 1 - tail] === next[next.length - 1 - tail]
  )
    tail++;
  const a = prev.slice(head, prev.length - tail);
  const b = next.slice(head, next.length - tail);
  const n = a.length;
  const m = b.length;
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const ops: DiffOp[] = prev.slice(0, head).map(line => ({ op: 'keep' as const, line }));
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ op: 'keep', line: a[i++] });
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) ops.push({ op: 'remove', line: a[i++] });
    else ops.push({ op: 'add', line: b[j++] });
  }
  while (i < n) ops.push({ op: 'remove', line: a[i++] });
  while (j < m) ops.push({ op: 'add', line: b[j++] });
  for (const line of prev.slice(prev.length - tail)) ops.push({ op: 'keep', line });
  return ops;
}

/** The edit script without the kept lines' text: runs of kept lines become counts. */
export type CompactOp = number | { add: string } | { remove: string };

export function compactOps(ops: DiffOp[]): CompactOp[] {
  const out: CompactOp[] = [];
  for (const { op, line } of ops) {
    if (op === 'keep') {
      if (typeof out[out.length - 1] === 'number') (out[out.length - 1] as number)++;
      else out.push(1);
    } else out.push(op === 'add' ? { add: line } : { remove: line });
  }
  return out;
}

function expand(prev: string[], ops: Array<DiffOp | CompactOp>): DiffOp[] {
  const out: DiffOp[] = [];
  let i = 0;
  for (const o of ops) {
    if (typeof o === 'number') {
      for (let k = 0; k < o; k++) out.push({ op: 'keep', line: prev[i++] });
    } else if ('op' in o) {
      out.push(o);
      if (o.op !== 'add') i++;
    } else if ('add' in o) out.push({ op: 'add', line: o.add });
    else {
      out.push({ op: 'remove', line: o.remove });
      i++;
    }
  }
  return out;
}

/** Applies an edit script (full or compact) to the previous lines; the result is the next outline. */
export function applyDiff(prev: string[], script: Array<DiffOp | CompactOp>): string[] {
  const ops = expand(prev, script);
  const out: string[] = [];
  let i = 0;
  for (const { op, line } of ops) {
    if (op === 'add') {
      out.push(line);
      continue;
    }
    if (prev[i] !== line) throw new Error(`Diff does not apply at line ${i}: expected ${JSON.stringify(line)}`);
    if (op === 'keep') out.push(line);
    i++;
  }
  if (i !== prev.length) throw new Error('Diff does not consume the previous outline');
  return out;
}

const refOf = (line: string) => /^\s*\[(\w+)\]/.exec(line)?.[1];

/**
 * Renders the changes for a model: `+` added, `-` removed, and `~` for a ref whose line changed (a state or value),
 * shown with what it was. Indentation is kept, so added structure reads as in the outline.
 */
export function renderDiff(
  ops: DiffOp[],
  sinceRev: number,
): { text: string; added: string[]; removed: string[]; changed: number } {
  const removedByRef = new Map<string, string>();
  const addedRefs = new Set<string>();
  for (const { op, line } of ops) {
    const ref = refOf(line);
    if (!ref) continue;
    if (op === 'remove') removedByRef.set(ref, line);
    if (op === 'add') addedRefs.add(ref);
  }
  const lines: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  let changed = 0;
  for (const { op, line } of ops) {
    const ref = refOf(line);
    if (op === 'keep') continue;
    if (op === 'remove') {
      if (ref && addedRefs.has(ref)) continue; // shown as ~ with the new line
      lines.push(`- ${line}`);
      if (ref) removed.push(ref);
      continue;
    }
    const old = ref ? removedByRef.get(ref) : undefined;
    if (old !== undefined) {
      changed++;
      lines.push(`~ ${line}   (was: ${old.trim()})`);
    } else {
      lines.push(`+ ${line}`);
      if (ref) added.push(ref);
    }
  }
  return {
    text: lines.length ? [`changes since rev ${sinceRev}`, ...lines].join('\n') : `no changes since rev ${sinceRev}`,
    added,
    removed,
    changed,
  };
}
