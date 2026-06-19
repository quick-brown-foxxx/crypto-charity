import { env } from 'cloudflare:test';
import { createVaultDb, appendLedgerEvent } from '@open-care/vault-db';
import { anchorRuns } from '@open-care/vault-db/schema/vault-db';
import type { VaultDb } from '@open-care/vault-db';
import { resetLedgerEventsForTest } from './reset-ledger-events.js';
import { TEST_TX_SIGNATURE } from './solana-test-values.js';

export { TEST_TX_SIGNATURE } from './solana-test-values.js';
export const TEST_ANCHOR_HEAD_HASH = 'a'.repeat(64);
export const TEST_ALT_ANCHOR_HEAD_HASH = 'b'.repeat(64);
export const DEFAULT_ANCHOR_DATE = '2026-06-14';

type AnchorRunStatus = 'pending' | 'sending' | 'published' | 'failed';
type AnchorRunTriggerSource = 'cron' | 'operator-manual' | 'reconciliation';

export interface SeedAnchorRunOptions {
  anchorDate?: string;
  anchoredHeadSequenceNo?: number;
  anchoredHeadHash?: string;
  status?: AnchorRunStatus;
  triggerSource?: AnchorRunTriggerSource;
  txSignature?: string | null;
  memoText?: string;
  attemptCount?: number;
  lastError?: string | null;
  lockedUntilUtc?: string | null;
  lastAnchorWalletSolLamports?: number | null;
  createdAtUtc?: string;
  updatedAtUtc?: string;
}

export interface SeedStaleLockOptions {
  anchorDate?: string;
  anchoredHead?: { hash: string; seq?: number };
  anchoredHeadSequenceNo?: number;
  anchoredHeadHash?: string;
  memoText?: string;
  attemptCount?: number;
}

export function anchorMemo(headHash: string): string {
  return `ccv-anchor:${headHash}`;
}

function minutesFromNowIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

export function futureIso(minutes = 30): string {
  return minutesFromNowIso(minutes);
}

export function pastIso(minutes = 20): string {
  return minutesFromNowIso(-minutes);
}

export async function seedAnchorRun(
  db: VaultDb,
  options: SeedAnchorRunOptions = {},
): Promise<number> {
  const now = new Date().toISOString();
  const anchoredHeadHash = options.anchoredHeadHash ?? TEST_ANCHOR_HEAD_HASH;
  const insertedRows = await db
    .insert(anchorRuns)
    .values({
      anchor_date: options.anchorDate ?? DEFAULT_ANCHOR_DATE,
      anchored_head_sequence_no: options.anchoredHeadSequenceNo ?? 1,
      anchored_head_hash: anchoredHeadHash,
      status: options.status ?? 'sending',
      trigger_source: options.triggerSource ?? 'cron',
      tx_signature: options.txSignature ?? null,
      anchor_wallet_address: env.ANCHOR_WALLET_ADDRESS,
      memo_text: options.memoText ?? anchorMemo(anchoredHeadHash),
      attempt_count: options.attemptCount ?? 0,
      last_error: options.lastError ?? null,
      locked_until_utc: options.lockedUntilUtc ?? null,
      last_anchor_wallet_sol_lamports: options.lastAnchorWalletSolLamports ?? null,
      created_at_utc: options.createdAtUtc ?? now,
      updated_at_utc: options.updatedAtUtc ?? options.createdAtUtc ?? now,
    })
    .returning({ id: anchorRuns.id });

  const insertedRow = insertedRows[0];
  if (!insertedRow) {
    throw new Error('Expected anchor run row to be inserted');
  }
  return insertedRow.id;
}

/**
 * Clean all rows from anchor_runs and ledger_events tables.
 * Call in beforeEach to avoid test pollution.
 */
export async function cleanTables(): Promise<void> {
  const db = createVaultDb(env.vault_db);
  await db.delete(anchorRuns);
  await resetLedgerEventsForTest(db);
}

/**
 * Seed a single donation_confirmed ledger event so the pipeline has a
 * head to anchor.  Returns the event hash and sequence number for
 * assertions.
 */
export async function seedLedgerEvent(db: VaultDb): Promise<{ hash: string; seq: number }> {
  const result = await appendLedgerEvent(db, {
    event_type: 'donation_confirmed',
    payload: {
      cluster: 'devnet',
      usdc_mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      treasury_wallet_address: '8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG',
      vault_usdc_ata: '52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG',
      tx_signature: TEST_TX_SIGNATURE,
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
  await seedAnchorRun(db, {
    anchorDate: DEFAULT_ANCHOR_DATE,
    anchoredHeadSequenceNo: headSeq,
    anchoredHeadHash: headHash,
    status: 'published',
    triggerSource: 'cron',
    txSignature: TEST_TX_SIGNATURE,
    memoText: 'test-memo',
    attemptCount: 1,
    lastAnchorWalletSolLamports: 1_000_000_000,
    createdAtUtc: '2026-06-14T10:23:00Z',
    updatedAtUtc: '2026-06-14T10:23:00Z',
  });
}

/**
 * Insert a sending anchor_runs row with a future locked_until_utc so
 * the pipeline detects a genuine concurrent run (conflict).
 */
export async function seedActiveLock(
  db: VaultDb,
  options: Omit<SeedAnchorRunOptions, 'status' | 'lockedUntilUtc'> = {},
): Promise<number> {
  const now = new Date().toISOString();
  return seedAnchorRun(db, {
    ...options,
    status: 'sending',
    lockedUntilUtc: futureIso(),
    createdAtUtc: options.createdAtUtc ?? now,
    updatedAtUtc: options.updatedAtUtc ?? now,
  });
}

/**
 * Insert a stale sending row with no tx_signature and an expired
 * locked_until_utc.  The recovery path should mark it as failed.
 */
export async function seedStaleLockNoTx(
  db: VaultDb,
  options: SeedStaleLockOptions = {},
): Promise<number> {
  const anchoredHeadHash =
    options.anchoredHeadHash ?? options.anchoredHead?.hash ?? TEST_ANCHOR_HEAD_HASH;
  const pastDate = pastIso();
  return seedAnchorRun(db, {
    anchorDate: options.anchorDate ?? DEFAULT_ANCHOR_DATE,
    anchoredHeadSequenceNo: options.anchoredHeadSequenceNo ?? options.anchoredHead?.seq ?? 1,
    anchoredHeadHash,
    status: 'sending',
    triggerSource: 'cron',
    txSignature: null,
    memoText: options.memoText ?? anchorMemo(anchoredHeadHash),
    attemptCount: options.attemptCount ?? 0,
    lockedUntilUtc: pastDate,
    createdAtUtc: pastDate,
    updatedAtUtc: pastDate,
  });
}

/**
 * Insert a stale sending row WITH a tx_signature and an expired
 * locked_until_utc.  The recovery path should look up the tx on-chain
 * (mocked) and backfill to published.
 */
export async function seedStaleLockWithTx(
  db: VaultDb,
  options: SeedStaleLockOptions = {},
): Promise<number> {
  const anchoredHeadHash =
    options.anchoredHeadHash ?? options.anchoredHead?.hash ?? TEST_ANCHOR_HEAD_HASH;
  const pastDate = pastIso();
  return seedAnchorRun(db, {
    anchorDate: options.anchorDate ?? DEFAULT_ANCHOR_DATE,
    anchoredHeadSequenceNo: options.anchoredHeadSequenceNo ?? options.anchoredHead?.seq ?? 1,
    anchoredHeadHash,
    status: 'sending',
    triggerSource: 'cron',
    txSignature: TEST_TX_SIGNATURE,
    memoText: options.memoText ?? anchorMemo(anchoredHeadHash),
    attemptCount: options.attemptCount ?? 0,
    lockedUntilUtc: pastDate,
    createdAtUtc: pastDate,
    updatedAtUtc: pastDate,
  });
}
