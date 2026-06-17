import { Hono } from 'hono';

type Bindings = {
  OPERATOR_TOKEN: string;
  VAULT_API_WRITE: Fetcher;
  VAULT_ANCHOR_CRON: Fetcher;
  TG_BOT: Fetcher;
};

const app = new Hono<{ Bindings: Bindings }>();

// Auth middleware — vault-operator is the sole holder of OPERATOR_TOKEN.
// All operator-authenticated endpoints flow through this check before
// being forwarded to the appropriate downstream Worker via service
// binding. The downstream Workers are not publicly routable for these
// routes.
app.use('*', async (c, next) => {
  const provided = c.req.header('Authorization')?.replace(/^Bearer /, '');
  const expected = c.env.OPERATOR_TOKEN;

  if (!provided || provided !== expected) {
    // Real implementation MUST use a constant-time comparison here
    // (e.g., crypto.subtle.timingSafeEqual over the byte arrays).
    // The MVP mock uses `!==` for brevity; documented in
    // docs/specs/04-api.md §"Operator auth". The mock returns the
    // standard error envelope from §"Standard error response".
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid operator token.',
        },
      },
      401,
    );
  }

  await next();
});

// Forward to vault-api-write for disbursement creation.
app.post('/api/disbursements', (c) => {
  return c.env.VAULT_API_WRITE.fetch(c.req.raw);
});

// Forward to vault-anchor-cron for manual anchor trigger.
app.post('/api/anchor/manual', (c) => {
  return c.env.VAULT_ANCHOR_CRON.fetch(c.req.raw);
});

// Forward to tg-bot for pending request inspection.
app.get('/tg/internal/pending-requests', (c) => {
  return c.env.TG_BOT.fetch(c.req.raw);
});

// Forward to tg-bot for sending verification codes.
app.post('/tg/internal/send-code', (c) => {
  return c.env.TG_BOT.fetch(c.req.raw);
});

app.all('*', (c) => {
  return c.notFound();
});

export default app;
