// Redaction of agent-supplied values before they reach audit listeners (the side panel, any log). The audit entry is
// written before the target is resolved, and for rejected calls it never is, so whether a field is a password cannot
// be known there: every value an agent types or sets is replaced, whatever the field. Booleans stay (a checkbox state
// is not a secret); so do targets, keys and expectations other than a value. A prompt() answer is redacted too.

/** What replaces a redacted string: its length only. */
export function redacted(value: string): string {
  return `‹redacted, ${value.length} character${value.length === 1 ? '' : 's'}›`;
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redacted(value);
  if (Array.isArray(value)) return value.map(v => (typeof v === 'string' ? redacted(v) : v));
  return value;
}

function redactExpect(expect: unknown): unknown {
  if (!expect || typeof expect !== 'object' || !('value' in expect)) return expect;
  return { ...expect, value: redactValue((expect as { value: unknown }).value) };
}

/** A copy of a call's arguments with typed and set values replaced; the original is not changed. */
export function redactArgs(tool: string, args: unknown): unknown {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  const out: Record<string, unknown> = { ...(args as Record<string, unknown>) };
  if ('expect' in out) out.expect = redactExpect(out.expect);
  if (tool === 'set' && 'value' in out) out.value = redactValue(out.value);
  if (tool === 'type' && 'text' in out) out.text = redactValue(out.text);
  // The answer to a prompt() can be a one-time code or a password as well.
  if (tool === 'handle_dialog' && 'promptText' in out) out.promptText = redactValue(out.promptText);
  if (tool === 'fill_form' && Array.isArray(out.fields)) {
    out.fields = out.fields.map(f =>
      f && typeof f === 'object' && 'value' in f ? { ...f, value: redactValue((f as { value: unknown }).value) } : f,
    );
  }
  return out;
}

/** Shorter values are not searched for: three digits would match in tab IDs, refs and offsets. */
export const MIN_FILTERED_SECRET = 6;
const MAX_SECRETS = 500;

/** Remembers a masked value of a tab for the result filter; the oldest are dropped past a limit. */
export function rememberSecret(secrets: Set<string>, value: string): void {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length < MIN_FILTERED_SECRET) return;
  secrets.delete(text);
  secrets.add(text);
  while (secrets.size > MAX_SECRETS) secrets.delete(secrets.values().next().value!);
}

/**
 * The result filter: a copy of a result, a prompt or an audit entry in which every known masked value
 * of the tab is replaced by the mask, wherever it is printed. Chrome puts a field's value into accessible names
 * (an element that wraps the field, or points at it with `aria-labelledby`), and names are quoted in receipts, errors
 * and prompts; this is the one place that covers them all. Images are left alone.
 */
export function maskSecrets<T>(value: T, secrets: ReadonlySet<string>, mask: string): T {
  if (!secrets.size) return value;
  // Longest first, so a value that contains another is replaced whole.
  const list = [...secrets].sort((a, b) => b.length - a.length);
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === 'string') {
      if (key === 'base64') return v;
      let out = v;
      for (const secret of list) if (out.includes(secret)) out = out.split(secret).join(mask);
      return out;
    }
    if (Array.isArray(v)) return v.map(item => walk(item));
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      return Object.fromEntries(Object.entries(v).map(([k, item]) => [k, walk(item, k)]));
    }
    return v;
  };
  return walk(value) as T;
}
