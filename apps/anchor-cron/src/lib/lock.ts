import { eq, and, gt, lt } from 'drizzle-orm';
import { anchorRuns } from '@open-care/vault-db/schema/vault-db';
import type { VaultDb } from '@open-care/vault-db';

const LOCK_DURATION_MINUTES = 10;

export function lockExpiresAt(): string {
  return new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000).toISOString();
}

export function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export async function findActiveLock(db: VaultDb): Promise<typeof anchorRuns.$inferSelect | null> {
  const now = utcNow();
  const rows = await db
    .select()
    .from(anchorRuns)
    .where(and(eq(anchorRuns.status, 'sending'), gt(anchorRuns.locked_until_utc, now)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findStaleLocks(db: VaultDb): Promise<(typeof anchorRuns.$inferSelect)[]> {
  const now = utcNow();
  const staleThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  return db
    .select()
    .from(anchorRuns)
    .where(
      and(
        eq(anchorRuns.status, 'sending'),
        lt(anchorRuns.locked_until_utc, now),
        lt(anchorRuns.updated_at_utc, staleThreshold),
      ),
    )
    .all();
}

export interface CreateLockParams {
  anchor_date: string;
  anchored_head_sequence_no: number;
  anchored_head_hash: string;
  trigger_source: 'cron' | 'operator-manual';
  anchor_wallet_address: string;
  memo_text: string;
}

export async function createLockRow(db: VaultDb, params: CreateLockParams): Promise<number> {
  const now = utcNow();
  const result = await db
    .insert(anchorRuns)
    .values({
      anchor_date: params.anchor_date,
      anchored_head_sequence_no: params.anchored_head_sequence_no,
      anchored_head_hash: params.anchored_head_hash,
      status: 'sending',
      trigger_source: params.trigger_source,
      anchor_wallet_address: params.anchor_wallet_address,
      memo_text: params.memo_text,
      attempt_count: 0,
      locked_until_utc: lockExpiresAt(),
      created_at_utc: now,
      updated_at_utc: now,
    })
    .returning({ id: anchorRuns.id });
  const row = result[0];
  if (!row) throw new Error('Failed to create anchor run row');
  return row.id;
}

export async function clearLockOnSuccess(
  db: VaultDb,
  id: number,
  txSignature: string,
  solBalance: number,
): Promise<void> {
  await db
    .update(anchorRuns)
    .set({
      status: 'published',
      tx_signature: txSignature,
      locked_until_utc: null,
      last_anchor_wallet_sol_lamports: solBalance,
      updated_at_utc: utcNow(),
    })
    .where(eq(anchorRuns.id, id));
}

export async function clearLockOnFailure(
  db: VaultDb,
  id: number,
  errorMessage: string,
): Promise<void> {
  await db
    .update(anchorRuns)
    .set({
      status: 'failed',
      last_error: errorMessage,
      locked_until_utc: null,
      updated_at_utc: utcNow(),
    })
    .where(eq(anchorRuns.id, id));
}

export async function findPublishedAnchorForHash(
  db: VaultDb,
  anchoredHeadHash: string,
): Promise<typeof anchorRuns.$inferSelect | null> {
  const rows = await db
    .select()
    .from(anchorRuns)
    .where(and(eq(anchorRuns.status, 'published'), eq(anchorRuns.anchored_head_hash, anchoredHeadHash)))
    .limit(1);
  return rows[0] ?? null;
}
