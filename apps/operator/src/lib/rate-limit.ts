import type { Context, Next } from 'hono';
import { errorResponse } from './errors.js';
import { generateRequestId } from '@open-care/vault-core';

/**
 * In-memory rate limiter for the operator Worker.
 *
 * Tracks request counts per client IP within a sliding window.
 * Since Cloudflare Workers are stateless (fresh V8 isolate per request),
 * this is per-isolate, not global. It provides basic protection against
 * rapid-fire abuse from a single IP within one isolate's lifetime.
 *
 * Default: 10 requests per 60 seconds per IP.
 */

interface RateLimitEntry {
  count: number;
  windowStart: number; // epoch milliseconds
}

const store = new Map<string, RateLimitEntry>();

/** Clean up expired entries periodically to prevent memory leaks. */
function purgeExpired(now: number, windowMs: number): void {
  for (const [key, entry] of store) {
    if (now - entry.windowStart >= windowMs) {
      store.delete(key);
    }
  }
}

/**
 * Extract the client IP from request headers.
 * Prefers CF-Connecting-IP (set by Cloudflare), falls back to X-Forwarded-For.
 */
function clientIp(c: Context): string {
  const cfIp = c.req.header('CF-Connecting-IP');
  if (cfIp) return cfIp;
  const xff = c.req.header('X-Forwarded-For');
  if (xff) return xff.split(',')[0]!.trim();
  return 'unknown';
}

/**
 * Hono middleware that rate-limits requests per client IP.
 *
 * @param maxRequests - Maximum requests allowed within the window (default 10)
 * @param windowSeconds - Sliding window duration in seconds (default 60)
 */
export function rateLimitMiddleware(
  maxRequests = 10,
  windowSeconds = 60,
): (c: Context, next: Next) => Promise<Response | void> {
  const windowMs = windowSeconds * 1000;

  return async (c: Context, next: Next): Promise<Response | void> => {
    const now = Date.now();
    const ip = clientIp(c);
    const key = `rate:${ip}`;

    // Periodic cleanup (every ~100 requests across all IPs)
    if (store.size > 100) {
      purgeExpired(now, windowMs);
    }

    let entry = store.get(key);

    if (!entry || now - entry.windowStart >= windowMs) {
      // New window
      entry = { count: 1, windowStart: now };
      store.set(key, entry);
      await next();
      return;
    }

    entry.count += 1;

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.windowStart + windowMs - now) / 1000);
      const requestId = generateRequestId();
      const resp = errorResponse(
        'RATE_LIMITED',
        `Too many requests. Try again in ${retryAfter} seconds.`,
        429,
        requestId,
      );
      resp.headers.set('Retry-After', String(retryAfter));
      return resp;
    }

    await next();
  };
}
