import { Hono } from 'hono';
import type { Env } from './lib/env';
import { authMiddleware } from './lib/auth';
import { corsMiddleware } from './lib/cors';
import { forwardToService } from './lib/forward';
import { healthRoute } from './routes/health';

const app = new Hono<{ Bindings: Env }>();

// CORS for all routes (must be first so error responses also get CORS headers)
app.use('*', corsMiddleware);

// Auth for tg/internal routes (all methods)
app.use('/tg/*', authMiddleware);

// Health (no auth)
app.route('/health', healthRoute);

// POST /api/disbursements → vault-api-write (auth required)
app.post('/api/disbursements', authMiddleware, async (c) => {
  return forwardToService(c.env.VAULT_API_WRITE, c.req.raw);
});

// GET /api/disbursements → vault-api-read (no auth — public read)
app.get('/api/disbursements', async (c) => {
  return forwardToService(c.env.VAULT_API_READ, c.req.raw);
});

// POST /api/anchor/manual → vault-anchor-cron (auth required)
app.post('/api/anchor/manual', authMiddleware, async (c) => {
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

export default app;
