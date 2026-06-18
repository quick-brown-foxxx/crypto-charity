import { Hono } from 'hono';
import type { Env } from './lib/env';
import { authMiddleware } from './lib/auth';
import { corsMiddleware } from './lib/cors';
import { forwardToService } from './lib/forward';
import { rateLimitMiddleware } from './lib/rate-limit';
import { healthRoute } from './routes/health';
import { errorResponse, unavailableResponse } from './lib/errors.js';
import { generateRequestId } from '@open-care/vault-core';

const app = new Hono<{ Bindings: Env }>();

// CORS for all routes (must be first so error responses also get CORS headers)
app.use('*', corsMiddleware);

// Auth for tg/internal routes (all methods)
app.use('/tg/*', authMiddleware);

// Health (no auth)
app.route('/health', healthRoute);

// Shared rate limiter instance for auth-protected write routes.
// 10 requests per 60 seconds per IP.
const writeRateLimit = rateLimitMiddleware(10, 60);

// POST /api/disbursements → vault-api-write (rate-limited + auth required)
app.post('/api/disbursements', writeRateLimit, authMiddleware, async (c) => {
  return forwardToService(c.env.VAULT_API_WRITE, c.req.raw);
});

// POST /api/corrections → vault-api-write (rate-limited + auth required)
app.post('/api/corrections', writeRateLimit, authMiddleware, async (c) => {
  return forwardToService(c.env.VAULT_API_WRITE, c.req.raw);
});

// GET /api/disbursements → vault-api-read (no auth — public read)
app.get('/api/disbursements', async (c) => {
  return forwardToService(c.env.VAULT_API_READ, c.req.raw);
});

// POST /api/anchor/manual → vault-anchor-cron (rate-limited + auth required)
app.post('/api/anchor/manual', writeRateLimit, authMiddleware, async (c) => {
  return forwardToService(c.env.VAULT_ANCHOR_CRON, c.req.raw);
});

// GET /tg/internal/pending-requests → tg-bot
app.get('/tg/internal/pending-requests', async (c) => {
  return forwardToService(c.env.TG_BOT, c.req.raw);
});

// POST /tg/internal/send-code → tg-bot
app.post('/tg/internal/send-code', async (c) => {
  return forwardToService(c.env.TG_BOT, c.req.raw);
});

// Test-only routes for error-code coverage verification.
// These exist so integration tests can verify the 403 and 503
// response shapes without mocking service bindings.

// GET /api/forbidden — always returns 403 FORBIDDEN
app.get('/api/forbidden', () => {
  const requestId = generateRequestId();
  return errorResponse('FORBIDDEN', 'Access denied.', 403, requestId);
});

// GET /api/unavailable — always returns 503 UNAVAILABLE
app.get('/api/unavailable', () => {
  const requestId = generateRequestId();
  return unavailableResponse('Service temporarily unavailable.', requestId);
});

export default app;
