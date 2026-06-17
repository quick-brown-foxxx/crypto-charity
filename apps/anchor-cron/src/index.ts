import { Hono } from 'hono';

type Bindings = {
  vault_db: D1Database;
  HELIUS_RPC_URL: string;
  ANCHOR_WALLET_SECRET: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/api/health', (c) => {
  return c.json({ status: 'ok' }, 200);
});

// The real handler must compute the merkle root of unanchored ledger
// events, persist an anchor_runs row, submit the on-chain anchor
// transaction, and update `last_anchor_wallet_sol_lamports`. The mock
// returns `{ ok: true, message: "..." }`. This endpoint is reached via
// service binding from vault-operator for manual triggers.
app.post('/api/anchor/manual', (c) => {
  return c.json({ ok: true, message: 'anchor job triggered (mock)' }, 200);
});

app.all('*', (c) => {
  return c.notFound();
});

// Scheduled handler — triggered by the cron trigger `0 1 * * *`
// defined in wrangler.jsonc. The real handler runs the same anchor
// pipeline as /api/anchor/manual. The mock logs and returns.
export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledEvent, _env: Bindings, _ctx: ExecutionContext) => {
    // Real implementation: run anchor pipeline.
    console.log('anchor cron triggered (mock)');
  },
};
