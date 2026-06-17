import { Hono } from 'hono';

type Bindings = {
  vault_db: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

// Public read API — no auth required.

// The real implementation will include `anchor_wallet_low_sol` in the
// health response, read from the cached
// `anchor_runs.last_anchor_wallet_sol_lamports` value written by
// vault-anchor-cron. The read Worker has no RPC binding.
app.get('/api/health', (c) => {
  return c.json({ status: 'ok' }, 200);
});

// The real handler must sum `donations.usdc_amount_minor` and
// `disbursements.usdc_amount_minor` from vault_db. The mock returns
// zeroes.
app.get('/api/totals', (c) => {
  return c.json(
    {
      total_donations_usdc_minor: '0',
      total_disbursements_usdc_minor: '0',
    },
    200,
  );
});

// The real handler must query the donations table with pagination
// (cursor, limit). The mock returns an empty list.
app.get('/api/donations', (c) => {
  return c.json({ donations: [] }, 200);
});

// The real handler must query the disbursements table with pagination.
// This is the public list endpoint — the write endpoint lives on
// vault-api-write. The mock returns an empty list.
app.get('/api/disbursements', (c) => {
  return c.json({ disbursements: [] }, 200);
});

// The real handler must query the ledger_events table with pagination.
// The mock returns an empty list.
app.get('/api/ledger-events', (c) => {
  return c.json({ events: [] }, 200);
});

// The real handler must look up a donation by signature or id and
// return the verification chain (donation → disbursement → on-chain
// anchor). The mock returns an empty chain.
app.get('/api/verify', (c) => {
  return c.json({ chain: [] }, 200);
});

app.all('*', (c) => {
  return c.notFound();
});

export default app;
