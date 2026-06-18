import { createMiddleware } from 'hono/factory';
import type { Env } from './env.js';
import { unauthorizedResponse } from './errors.js';
import { constantTimeEqual, generateRequestId } from '@open-care/vault-core';

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
  const requestId = generateRequestId();
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    return unauthorizedResponse('Missing Authorization header', requestId);
  }

  if (!authHeader.startsWith('Bearer ')) {
    return unauthorizedResponse('Authorization header must use Bearer scheme', requestId);
  }

  const token = authHeader.slice(7); // remove "Bearer " prefix

  if (!constantTimeEqual(token, c.env.HELIUS_WEBHOOK_AUTH_HEADER)) {
    return unauthorizedResponse('Invalid authorization token', requestId);
  }

  await next();
});
