import { Hono } from 'hono';
import { createVaultDb, getHead } from '@open-care/vault-db';
import type { VaultDb } from '@open-care/vault-db';
import { buildAnchorMemo, computeEventHash } from '@open-care/vault-core';
import type { LedgerEvent } from '@open-care/vault-core';

interface Env {
  vault_db: D1Database;
  ANCHOR_WALLET_SECRET: string;
  HELIUS_RPC_URL: string;
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

// Prove shared package imports resolve (real impl uses these for anchor pipeline)
void buildAnchorMemo;
void computeEventHash;
void getHead;

// GET /health — liveness check.
app.get('/health', (c) => {
  return c.json({ status: 'ok' }, 200);
});

// POST /api/anchor/manual — reached via service binding from vault-operator.
// Real impl (Epic 4): computes merkle root of unanchored ledger events,
// persists anchor_runs row, submits on-chain anchor transaction,
// updates last_anchor_wallet_sol_lamports.
app.post('/api/anchor/manual', (c) => {
  void getDb(c.env);
  // Prove type import resolves
  const _stubEvent = null as LedgerEvent | null;
  void _stubEvent;
  return c.json(
    {
      status: 'published',
      head_sequence_no: 0,
      head_hash: '0'.repeat(64),
      tx_signature: null,
      published_at_utc: new Date().toISOString(),
    },
    200,
  );
});

// Scheduled handler — triggered by cron `0 1 * * *` defined in wrangler.jsonc.
// Real impl (Epic 4): runs the same anchor pipeline as /api/anchor/manual.
function scheduled(
  _event: ScheduledEvent,
  env: Env,
  _ctx: ExecutionContext,
): void {
  void _event;
  void _ctx;
  void getDb(env);
  console.log('anchor cron triggered');
}

export default { fetch: app.fetch, scheduled };
