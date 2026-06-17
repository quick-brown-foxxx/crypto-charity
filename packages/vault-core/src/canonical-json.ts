/**
 * RFC 8785 Canonical JSON (JCS — JSON Canonicalization Scheme).
 *
 * Produces a deterministic, canonical JSON string from any JavaScript value
 * suitable for hashing, signing, or byte-level comparison.
 *
 * Rules applied:
 * - Object keys sorted lexicographically by UTF-16 code unit order
 * - No whitespace outside string literals
 * - Numbers serialized per ECMAScript JSON.stringify format (no leading/trailing zeros)
 * - Minimal string escaping: only ", \, and control characters U+0000–U+001F
 * - Solidus (/) is NOT escaped; Unicode above U+007F is NOT escaped
 * - Closed schema: null values are preserved, not omitted
 *
 * @param obj - Any JSON-serializable value (objects, arrays, primitives, null)
 * @returns A canonical JSON string per RFC 8785
 * @throws {Error} if the value contains NaN, Infinity, undefined, functions,
 *                 symbols, bigints, or other non-JSON types
 */
export function canonicalJson(obj: unknown): string {
  return serialize(obj);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeString(s: string): string {
  s = s.normalize('NFC');
  let result = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    const code = c.charCodeAt(0);
    if (c === '"') {
      result += '\\"';
    } else if (c === '\\') {
      result += '\\\\';
    } else if (code <= 0x1f) {
      result += '\\u' + code.toString(16).padStart(4, '0');
    } else {
      result += c;
    }
  }
  result += '"';
  return result;
}

function serializeObject(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const pairs = entries.map(
    ([k, v]) => escapeString(k) + ':' + serialize(v),
  );
  return '{' + pairs.join(',') + '}';
}

function serialize(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Cannot canonicalize NaN or Infinity');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return escapeString(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(serialize).join(',') + ']';
  }
  if (isRecord(value)) {
    return serializeObject(value);
  }
  throw new Error(`Cannot canonicalize type: ${typeof value}`);
}
