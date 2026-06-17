import { eq } from 'drizzle-orm';
import { anchorRuns } from '@open-care/vault-db/schema/vault-db';
import { appendLedgerEvent } from '@open-care/vault-db';
import type { VaultDb } from '@open-care/vault-db';
import { parseAnchorMemo } from '@open-care/vault-core';
// AnchorPayload and Cluster types are used implicitly through appendLedgerEvent's payload validation
import { getTransaction } from './solana';
import { utcNow } from './lock';
import type { Connection } from '@solana/web3.js';

export async function recoverStaleLock(
  db: VaultDb,
  connection: Connection,
  staleRow: typeof anchorRuns.$inferSelect,
): Promise<void> {
  // If tx_signature exists, try to look it up
  if (staleRow.tx_signature) {
    const txResult = await getTransaction(connection, staleRow.tx_signature);
    if (txResult.ok && txResult.value !== null) {
      // Transaction found and finalized — backfill
      await db
        .update(anchorRuns)
        .set({
          status: 'published',
          tx_signature: staleRow.tx_signature,
          locked_until_utc: null,
          updated_at_utc: utcNow(),
        })
        .where(eq(anchorRuns.id, staleRow.id));

      // Backfill ledger event if not already present
      // We use the blockTime from the transaction if available
      const blockTime = txResult.value.blockTime;
      const publishedAtUtc = blockTime
        ? new Date(blockTime * 1000).toISOString()
        : staleRow.created_at_utc;

      const headHash = parseAnchorMemo(staleRow.memo_text);
      if (headHash) {
        // Try to append — may fail if already exists (unique constraint on event_hash)
        try {
          await appendLedgerEvent(db, {
            event_type: 'anchor_published',
            payload: {
              anchor_date: staleRow.anchor_date,
              anchored_head_sequence_no: staleRow.anchored_head_sequence_no,
              anchored_head_hash: staleRow.anchored_head_hash,
              tx_signature: staleRow.tx_signature,
              anchor_wallet_address: staleRow.anchor_wallet_address,
              memo_text: staleRow.memo_text,
              published_at_utc: publishedAtUtc,
              cluster: 'devnet',
            },
            created_at_utc: publishedAtUtc,
          });
        } catch {
          // Ledger event may already exist — ignore
        }
      }
      return;
    }
  }

  // Transaction not found or no tx_signature — mark as failed
  await db
    .update(anchorRuns)
    .set({
      status: 'failed',
      last_error: 'lock_expired_no_tx_found',
      locked_until_utc: null,
      updated_at_utc: utcNow(),
    })
    .where(eq(anchorRuns.id, staleRow.id));
}
