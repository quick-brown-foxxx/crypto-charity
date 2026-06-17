import { Hono } from 'hono';
import { createVaultDb, appendLedgerEvent } from '@open-care/vault-db';
import type { VaultDb, AppendLedgerEventInput } from '@open-care/vault-db';
import { DisbursementPayloadSchema, generateBeneficiaryRef } from '@open-care/vault-core';
import type { DisbursementPayload } from '@open-care/vault-core';

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

// Auth middleware is not needed on this Worker. It is reached only via
// service binding from vault-operator, which already validates OPERATOR_TOKEN.
// See docs/specs/01-architecture.md §"Operator Worker trust model".

function getDb(env: Env): VaultDb {
  return createVaultDb(env.vault_db);
}

// Prove shared package imports resolve (real impl uses these for disbursement creation)
void appendLedgerEvent;
void DisbursementPayloadSchema;
void generateBeneficiaryRef;

// POST /api/disbursements — record a new disbursement.
// Real impl (Epic 3): validates body with DisbursementPayloadSchema,
// persists via appendLedgerEvent, generates public_beneficiary_ref,
// enqueues on-chain transfer for operator approval.
app.post('/api/disbursements', (c) => {
  void getDb(c.env);
  // Prove type imports resolve
  const _stubPayload = null as DisbursementPayload | null;
  const _stubInput = null as AppendLedgerEventInput | null;
  void _stubPayload;
  void _stubInput;
  return c.json(
    {
      sequence_no: 0,
      event_hash: '0'.repeat(64),
      head_hash: '0'.repeat(64),
      public_beneficiary_ref: null,
      next_action: 'awaiting_operator_approval',
    },
    200,
  );
});

// GET /health — liveness check.
app.get('/health', (c) => {
  return c.json({ status: 'ok' }, 200);
});

export default app;
