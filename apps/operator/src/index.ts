import { Hono } from 'hono';
import type { Result } from '@open-care/vault-core';

interface Env {
  OPERATOR_TOKEN: string;
  VAULT_API_WRITE: Fetcher;
  VAULT_ANCHOR_CRON: Fetcher;
  TG_BOT: Fetcher;
  SOLANA_CLUSTER: string;
  SITE_URL: string;
}

const app = new Hono<{ Bindings: Env }>();

// Prove Result type import resolves (real impl uses Result for error handling)
const _stubResult = null as Result<unknown, Error> | null;
void _stubResult;

// Auth middleware — vault-operator is the sole holder of OPERATOR_TOKEN.
// All operator-authenticated endpoints flow through this check before
// being forwarded to the appropriate downstream Worker via service binding.
// The downstream Workers are not publicly routable for these routes.
// See docs/specs/01-architecture.md §"Operator Worker trust model".
app.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const provided = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  const expected = c.env.OPERATOR_TOKEN;

  if (!provided || provided !== expected) {
    // TODO (Epic 3): Use constant-time comparison (crypto.subtle.timingSafeEqual).
    return c.json(
      {
        error: { code: 'UNAUTHORIZED', message: 'Invalid operator token.' },
      },
      401,
    );
  }

  await next();
});

// POST /api/disbursements — forward to vault-api-write for disbursement creation.
app.post('/api/disbursements', (c) => {
  return c.env.VAULT_API_WRITE.fetch(c.req.raw);
});

// POST /api/anchor/manual — forward to vault-anchor-cron for manual anchor trigger.
app.post('/api/anchor/manual', (c) => {
  return c.env.VAULT_ANCHOR_CRON.fetch(c.req.raw);
});

// GET /tg/internal/pending-requests — forward to tg-bot for pending request inspection.
app.get('/tg/internal/pending-requests', (c) => {
  return c.env.TG_BOT.fetch(c.req.raw);
});

// POST /tg/internal/send-code — forward to tg-bot for sending verification codes.
app.post('/tg/internal/send-code', (c) => {
  return c.env.TG_BOT.fetch(c.req.raw);
});

// GET /health — liveness check.
app.get('/health', (c) => {
  return c.json({ status: 'ok' }, 200);
});

export default app;
