const REDACTED = '[REDACTED]';
const SENSITIVE_KEY =
  /password|passwd|passphrase|secret|token|cookie|authorization|credential|api.?key|ssn|social.?security|card.?number|credit.?card|cvv|cvc/i;
const SENSITIVE_FIELD = /password|secret|token|cookie|credential|cc-number|cc-csc|ssn|social.security/i;
const MAX_TEXT_LENGTH = 8_000;
const MAX_TOTAL_TEXT = 40_000;
const MAX_NODES = 2_000;

export type SanitizedValue = string | number | boolean | null | SanitizedValue[] | { [key: string]: SanitizedValue };

export function sanitizeDecisionText(text: string): string {
  return (
    text
      // v0.3 outlines retain labels and refs, but field values belong only to the conversation model.
      .replace(
        /(^[ \t]*(?:\[[^\]\r\n]+\]\s+)?(?:textbox|searchbox|combobox|spinbutton|slider|input|textarea|select)\b[^\r\n]*?)\s+=\s+"(?:\\.|[^"\\\r\n])*"/gim,
        `$1 = "${REDACTED}"`,
      )
      .replace(/(\bvalue\s*=\s*)(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s\]>]+)/gi, `$1"${REDACTED}"`)
      .replace(/https?:\/\/[^\s<>"']+/gi, match => {
        try {
          const url = new URL(match);
          url.search = '';
          url.hash = '';
          url.username = '';
          url.password = '';
          return url.toString();
        } catch {
          return '[URL]';
        }
      })
      .replace(/\bBearer\s+[\w.+/=-]+/gi, `Bearer ${REDACTED}`)
      .replace(/\b(?:sk|ts|jev)[-_][A-Za-z0-9_-]{12,}\b/g, REDACTED)
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
      .replace(/\b(?:set-cookie|cookies?)\s*[:=][^\r\n]*/gi, 'Cookie: ' + REDACTED)
      .replace(
        /((?:password|passwd|passphrase|api[_ -]?key|access[_ -]?token|secret|cookie|authorization)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;<>]+)/gi,
        `$1${REDACTED}`,
      )
      .replace(/\b\d{3}[- ]\d{2}[- ]\d{4}\b/g, REDACTED)
      .replace(/\b(?:\d[ -]?){12,18}\d\b/g, REDACTED)
      // Existing DOM state contains input attributes. Never transmit password values from it.
      .replace(/[^\n]*\btype\s*=\s*["']?password\b[^\n]*/gi, '[password field redacted]')
      .slice(0, MAX_TEXT_LENGTH)
  );
}

/** Bounded recursive privacy filtering. This reduces exposure; it cannot identify every secret in arbitrary text. */
export function sanitizeDecisionInput(input: unknown): SanitizedValue {
  const visited = new WeakSet<object>();
  let remaining = MAX_TOTAL_TEXT;
  let nodes = 0;
  const sanitize = (value: unknown, depth: number): SanitizedValue => {
    nodes += 1;
    if (depth > 8 || remaining <= 0 || nodes > MAX_NODES) return '[TRUNCATED]';
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
      const clean = sanitizeDecisionText(value).slice(0, remaining);
      remaining -= clean.length;
      return clean;
    }
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'object') return null;
    if (visited.has(value)) return '[CIRCULAR]';
    visited.add(value);
    if (Array.isArray(value)) return value.slice(0, 100).map(entry => sanitize(entry, depth + 1));
    const record = value as Record<string, unknown>;
    const sensitiveField = [record.type, record.name, record.autocomplete, record['aria-label']].some(
      item => typeof item === 'string' && SENSITIVE_FIELD.test(item),
    );
    const result: Record<string, SanitizedValue> = {};
    for (const [key, entry] of Object.entries(record).slice(0, 100)) {
      if (key === 'signal' || key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      const cleanKey = sanitizeDecisionText(key).slice(0, 100);
      const cleanEntry = typeof entry === 'string' && /^(url|href|src)$/i.test(key) ? entry.split(/[?#]/, 1)[0] : entry;
      result[cleanKey] =
        SENSITIVE_KEY.test(key) || (sensitiveField && /^(value|text|content)$/i.test(key))
          ? REDACTED
          : sanitize(cleanEntry, depth + 1);
    }
    return result;
  };
  return sanitize(input, 0);
}
