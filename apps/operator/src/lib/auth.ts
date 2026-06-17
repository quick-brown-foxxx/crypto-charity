import type { Context, Next } from 'hono';
import type { Env } from './env';

/**
 * Constant-time string comparison to prevent timing attacks on token validation.
 * Pads shorter string with null bytes, then XOR-accumulates all character differences.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  const paddedA = a.padEnd(maxLen, '\0');
  const paddedB = b.padEnd(maxLen, '\0');
  let result = 0;
  for (let i = 0; i < maxLen; i++) {
    result |= paddedA.charCodeAt(i) ^ paddedB.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Hono middleware that validates the Authorization Bearer token against
 * c.env.OPERATOR_TOKEN using constant-time comparison.
 *
 * - Missing Authorization header → 401 UNAUTHORIZED
 * - Non-Bearer scheme → 400 BAD_REQUEST
 * - Invalid token → 401 UNAUTHORIZED
 * - Valid token → calls next()
 */
export async function authMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next,
): Promise<Response | void> {
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Missing Authorization header.' } },
      401,
    );
  }

  if (!authHeader.startsWith('Bearer ')) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'Authorization header must use Bearer scheme.' } },
      400,
    );
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix

  if (!constantTimeEqual(token, c.env.OPERATOR_TOKEN)) {
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid operator token.' } },
      401,
    );
  }

  await next();
}
