import { Hono } from 'hono';
import { createVaultDb } from '@open-care/vault-db';
import type { VaultDb } from '@open-care/vault-db';
import type { DonationPayload } from '@open-care/vault-core';

interface Env {
  vault_db: D1Database;
  HELIUS_WEBHOOK_AUTH_HEADER: string;
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

// POST /webhook/helius — receives Helius transaction webhooks.
// Real impl (Epic 1): validates Authorization header with constant-time comparison,
// parses webhook entries, deduplicates by tx_signature, inserts into helius_inbox.
app.post('/webhook/helius', (c) => {
  void getDb(c.env);
  // Prove DonationPayload import resolves (real impl uses this type for parsed entries)
  const _stubPayload = null as DonationPayload | null;
  void _stubPayload;
  return c.json({ accepted: 0, duplicates: 0 }, 200);
});

// GET /health — liveness check.
app.get('/health', (c) => {
  return c.json({ status: 'ok' }, 200);
});

export default app;
