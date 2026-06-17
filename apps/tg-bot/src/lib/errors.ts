import type { Context } from 'hono';

/**
 * Return a JSON error response with a consistent shape.
 *
 * @param c - Hono request context
 * @param status - HTTP status code (e.g. 400, 404, 409)
 * @param errorCode - Machine-readable error code (e.g. "BAD_REQUEST")
 * @param message - Human-readable error description
 */
export function errorResponse(
  c: Context,
  status: number,
  errorCode: string,
  message: string,
): Response {
  return c.json(
    { error: { code: errorCode, message } },
    // Hono's c.json accepts any number for status; the cast satisfies
    // the type checker for the specific codes we use.
    status as 200 | 400 | 403 | 404 | 409 | 500 | 503,
  );
}
