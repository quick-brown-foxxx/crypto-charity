import type { Context, Next } from 'hono';
import type { Env } from './env';
import { logInfo, logWarn, constantTimeEqual, generateRequestId } from '@open-care/vault-core';
import { unauthorizedResponse, badRequestResponse } from './errors.js';

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
    logWarn('Operator auth failed: missing Authorization header');
    const requestId = generateRequestId();
    return unauthorizedResponse('Missing Authorization header.', requestId);
  }

  if (!authHeader.startsWith('Bearer ')) {
    logWarn('Operator auth failed: non-Bearer scheme');
    const requestId = generateRequestId();
    return badRequestResponse('Authorization header must use Bearer scheme.', requestId);
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix

  if (!constantTimeEqual(token, c.env.OPERATOR_TOKEN)) {
    logWarn('Operator auth failed: invalid token');
    const requestId = generateRequestId();
    return unauthorizedResponse('Invalid operator token.', requestId);
  }

  logInfo('Operator auth succeeded');

  await next();
}
