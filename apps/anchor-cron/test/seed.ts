import { env } from 'cloudflare:test';
import { createVaultDb, appendLedgerEvent } from '@open-care/vault-db';
import { anchorRuns, ledgerEvents } from '@open-care/vault-db/schema/vault-db';
import type { VaultDb } from '@open-care/vault-db';

/**
 * Clean all rows from anchor_runs and ledger_events tables.
 * Call in beforeEach to avoid test pollution.
 */
export async function cleanTables(): Promise<void> {
  const db = createVaultDb(env.vault_db);
  await db.delete(anchorRuns);
  await db.delete(ledgerEvents);
}

/**
 * Seed a single donation_confirmed ledger event so the pipeline has a
 * head to anchor.  Returns the event hash and sequence number for
 * assertions.
 */
export async function seedLedgerEvent(
  db: VaultDb,
): Promise<{ hash: string; seq: number }> {
  const result = await appendLedgerEvent(db, {
    event_type: 'donation_confirmed',
    payload: {
      cluster: 'devnet',
      usdc_mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      treasury_wallet_address: '8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG',
      vault_usdc_ata: '52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG',
      tx_signature:
        '5Jofwx5DPe1qBwHL7hN3VpFqLxqFj4mJLo5iY7nP8kRt2sT9uVvWxYzAbCdEfGhIjKlMnOpQrStUvWxYz1234',
      transaction_version: 0,
      instruction_index: 0,
      inner_index: null,
      slot: 123456789,
      block_time_utc: '2026-06-14T10:23:00Z',
      amount_usdc_minor: '100000000',
    },
    created_at_utc: '2026-06-14T10:23:01Z',
  });
  if (!result.ok) {
    throw new Error(`Failed to seed ledger event: ${result.error.message}`);
  }
  return { hash: result.value.event_hash, seq: result.value.sequence_no };
}

/**
 * Insert a published anchor_runs row for a given head hash so the
 * pipeline detects "already_published".
 */
export async function seedPublishedAnchor(
  db: VaultDb,
  headHash: string,
  headSeq: number,
): Promise<void> {
  await db.insert(anchorRuns).values({
    anchor_date: '2026-06-14',
    anchored_head_sequence_no: headSeq,
    anchored_head_hash: headHash,
    status: 'published',
    trigger_source: 'cron',
    tx_signature:
      '5Jofwx5DPe1qBwHL7hN3VpFqLxqFj4mJLo5iY7nP8kRt2sT9uVvWxYzAbCdEfGhIjKlMnOpQrStUvWxYz1234',
    anchor_wallet_address: env.ANCHOR_WALLET_ADDRESS,
    memo_text: 'test-memo',
    attempt_count: 1,
    locked_until_utc: null,
    last_anchor_wallet_sol_lamports: 1_000_000_000,
    created_at_utc: '2026-06-14T10:23:00Z',
    updated_at_utc: '2026-06-14T10:23:00Z',
  });
}

/**
 * Insert a sending anchor_runs row with a future locked_until_utc so
 * the pipeline detects a genuine concurrent run (conflict).
 */
export async function seedActiveLock(db: VaultDb): Promise<void> {
  const now = new Date();
  const futureDate = new Date(now.getTime() + 30 * 60 * 1000).toISOString(); // 30 min ahead
  await db.insert(anchorRuns).values({
    anchor_date: '2026-06-14',
    anchored_head_sequence_no: 1,
    anchored_head_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    status: 'sending',
    trigger_source: 'cron',
    anchor_wallet_address: env.ANCHOR_WALLET_ADDRESS,
    memo_text: 'test-memo',
    attempt_count: 0,
    locked_until_utc: futureDate,
    created_at_utc: now.toISOString(),
    updated_at_utc: now.toISOString(),
  });
}

/**
 * Insert a stale sending row with no tx_signature and an expired
 * locked_until_utc.  The recovery path should mark it as failed.
 */
export async function seedStaleLockNoTx(db: VaultDb): Promise<void> {
  const pastDate = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 min ago
  await db.insert(anchorRuns).values({
    anchor_date: '2026-06-14',
    anchored_head_sequence_no: 1,
    anchored_head_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    status: 'sending',
    trigger_source: 'cron',
    tx_signature: null,
    anchor_wallet_address: env.ANCHOR_WALLET_ADDRESS,
    memo_text: 'test-memo',
    attempt_count: 0,
    locked_until_utc: pastDate,
    created_at_utc: pastDate,
    updated_at_utc: pastDate,
  });
}

/**
 * Insert a stale sending row WITH a tx_signature and an expired
 * locked_until_utc.  The recovery path should look up the tx on-chain
 * (mocked) and backfill to published.
 */
export async function seedStaleLockWithTx(db: VaultDb): Promise<void> {
  const pastDate = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  await db.insert(anchorRuns).values({
    anchor_date: '2026-06-14',
    anchored_head_sequence_no: 1,
    anchored_head_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    status: 'sending',
    trigger_source: 'cron',
    tx_signature:
      '5Jofwx5DPe1qBwHL7hN3VpFqLxqFj4mJLo5iY7nP8kRt2sT9uVvWxYzAbCdEfGhIjKlMnOpQrStUvWxYz1234',
    anchor_wallet_address: env.ANCHOR_WALLET_ADDRESS,
    memo_text: 'test-memo',
    attempt_count: 0,
    locked_until_utc: pastDate,
    created_at_utc: pastDate,
    updated_at_utc: pastDate,
  });
}
