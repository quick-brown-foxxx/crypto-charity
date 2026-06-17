import { Hono } from 'hono';
import {
  createVaultDb,
  getTotals,
  getDonations,
  getDisbursements,
  getHead,
} from '@open-care/vault-db';
import type {
  VaultDb,
  Totals,
  DonationView,
  DisbursementView,
  PaginatedResult,
} from '@open-care/vault-db';
import type { LedgerEvent } from '@open-care/vault-core';

interface Env {
  vault_db: D1Database;
  SOLANA_CLUSTER: string;
  USDC_MINT: string;
  TREASURY_WALLET_ADDRESS: string;
  VAULT_USDC_ATA: string;
  ANCHOR_WALLET_ADDRESS: string;
  SITE_URL: string;
}

const app = new Hono<{ Bindings: Env }>();

function getDb(env: Env): VaultDb {
  return createVaultDb(env.vault_db);
}

// Prove query helper imports resolve (real impl calls these with a VaultDb instance)
void getTotals;
void getDonations;
void getDisbursements;
void getHead;

// GET /api/health — liveness check with subsystem status.
// Real impl (Epic 3): includes anchor_wallet_low_sol from cached
// anchor_runs.last_anchor_wallet_sol_lamports (written by vault-anchor-cron).
app.get('/api/health', (c) => {
  void getDb(c.env);
  return c.json(
    {
      status: 'ok',
      checks: {
        database: 'ok',
        anchor_wallet_low_sol: false,
      },
    },
    200,
  );
});

// GET /api/totals — aggregate donation and disbursement totals.
// Real impl (Epic 3): sums from vault_db via getTotals().
app.get('/api/totals', (c) => {
  void getDb(c.env);
  const stub: Totals = {
    total_donations_usdc_minor: '0',
    total_disbursements_usdc_minor: '0',
    donation_count: 0,
    disbursement_count: 0,
  };
  return c.json(stub, 200);
});

// GET /api/donations — paginated donation list.
// Real impl (Epic 3): queries via getDonations() with cursor/limit from query params.
app.get('/api/donations', (c) => {
  void getDb(c.env);
  const stub: PaginatedResult<DonationView> = { items: [], nextCursor: null };
  return c.json(stub, 200);
});

// GET /api/disbursements — paginated public disbursement list.
// Real impl (Epic 3): queries via getDisbursements() with cursor/limit.
app.get('/api/disbursements', (c) => {
  void getDb(c.env);
  const stub: PaginatedResult<DisbursementView> = { items: [], nextCursor: null };
  return c.json(stub, 200);
});

// GET /api/ledger-events — paginated raw ledger events.
// Real impl (Epic 3): queries ledger_events with pagination.
app.get('/api/ledger-events', (c) => {
  void getDb(c.env);
  const stub: { items: LedgerEvent[]; next_after_sequence_no: number | null } = {
    items: [],
    next_after_sequence_no: null,
  };
  return c.json(stub, 200);
});

// GET /api/verify — donation verification chain lookup.
// Real impl (Epic 3): looks up donation by signature/id, returns
// verification chain (donation → disbursement → on-chain anchor).
app.get('/api/verify', (c) => {
  void getDb(c.env);
  return c.json(
    {
      head_sequence_no: null,
      head_hash: null,
      chain_valid: null,
    },
    200,
  );
});

export default app;
