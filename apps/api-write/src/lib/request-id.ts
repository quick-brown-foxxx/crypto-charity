/**
 * Short request ID generator.
 *
 * Produces identifiers like `"req_a3f8c2b1"` — the `req_` prefix
 * followed by 8 random lowercase hex characters extracted from a UUID.
 */

export function generateRequestId(): string {
  const uuid = crypto.randomUUID().replace(/-/g, "");
  return "req_" + uuid.slice(0, 8);
}
