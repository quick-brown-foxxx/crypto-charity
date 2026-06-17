import { createMiddleware } from 'hono/factory';
import type { Env } from './env.js';

/**
 * Constant-time string comparison.
 *
 * Uses `crypto.subtle.timingSafeEqual` when available (Cloudflare Workers
 * runtime provides it). Falls back to a manual byte-by-byte comparison that
 * does NOT early-exit — it iterates all bytes, XORs each pair, and ORs into
 * an accumulator, returning `accumulator === 0`.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  // crypto.subtle.timingSafeEqual is available in Workers runtime
  if (typeof crypto !== 'undefined' && crypto.subtle && 'timingSafeEqual' in crypto.subtle) {
    // timingSafeEqual requires equal-length buffers; if lengths differ,
    // the strings are definitely not equal.
    if (aBytes.byteLength !== bBytes.byteLength) return false;
    return (crypto.subtle as unknown as { timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean })
      .timingSafeEqual(aBytes, bBytes);
  }

  // Fallback: constant-time manual comparison (no early exit)
  const len = Math.max(aBytes.length, bBytes.length);
  let accumulator = 0;
  for (let i = 0; i < len; i++) {
    accumulator |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return accumulator === 0;
}

/**
 * Hono middleware that validates the Helius webhook Authorization header.
 *
 * - Extracts `Authorization` header
 * - Returns 401 if missing
 * - Strips "Bearer " prefix (case-sensitive, exact match)
 * - Compares remaining token against `c.env.HELIUS_WEBHOOK_AUTH_HEADER`
 *   using constant-time comparison
 * - Returns 401 on mismatch, calls `next()` on match
 */
export const authMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    return c.json({ error: 'missing_authorization_header' }, 401);
  }

  if (!authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const token = authHeader.slice(7); // remove "Bearer " prefix

  if (!constantTimeEqual(token, c.env.HELIUS_WEBHOOK_AUTH_HEADER)) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  await next();
});
