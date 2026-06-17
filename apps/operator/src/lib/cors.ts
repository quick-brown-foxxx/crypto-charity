import type { Context, Next } from 'hono';
import type { Env } from './env';

/**
 * CORS middleware for the frontend origin.
 * - Handles OPTIONS preflight → 204 with CORS headers
 * - Adds CORS headers to all other responses after next()
 */
export async function corsMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next,
): Promise<Response | void> {
  // Preflight
  if (c.req.method === 'OPTIONS') {
    c.header('Access-Control-Allow-Origin', c.env.SITE_URL);
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Max-Age', '86400');
    return c.body(null, 204);
  }

  await next();

  // Add CORS headers to the response
  c.header('Access-Control-Allow-Origin', c.env.SITE_URL);
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}
