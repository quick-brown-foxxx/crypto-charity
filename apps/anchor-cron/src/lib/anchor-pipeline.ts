import { getHead, appendLedgerEvent } from '@open-care/vault-db';
import type { VaultDb } from '@open-care/vault-db';
import { buildAnchorMemo } from '@open-care/vault-core';
import type { Cluster } from '@open-care/vault-core';
import { createConnection, createKeypair, sendMemoTransaction, getBalance } from './solana';
import {
  findActiveLock,
  createLockRow,
  clearLockOnSuccess,
  clearLockOnFailure,
  findPublishedAnchorForHash,
  findStaleLocks,
  utcNow,
} from './lock';
import { recoverStaleLock } from './recovery';
import type { Env } from './env';

export interface AnchorRunSuccess {
  status: 'published';
  anchored_head_hash: string;
  anchored_head_sequence_no: number;
  memo_text: string;
  tx_signature: string;
  duration_ms: number;
  anchor_runs_id: number;
}

export interface AnchorRunSkipped {
  status: 'already_published' | 'empty_ledger';
  anchored_head_hash?: string;
  anchored_head_sequence_no?: number;
  duration_ms: number;
}

export interface AnchorRunConflict {
  status: 'conflict';
  error: { code: 'ANCHOR_RUN_IN_PROGRESS'; message: string };
}

export interface AnchorRunFailed {
  status: 'failed';
  error: { code: 'ANCHOR_FAILED'; message: string };
}

export type AnchorRunResult = AnchorRunSuccess | AnchorRunSkipped | AnchorRunConflict | AnchorRunFailed;

export async function runAnchor(
  db: VaultDb,
  env: Env,
  triggerSource: 'cron' | 'operator-manual',
): Promise<AnchorRunResult> {
  const startTime = Date.now();

  // Step 0: Recover any stale locks first
  const staleLocks = await findStaleLocks(db);
  for (const stale of staleLocks) {
    const connection = createConnection(env.HELIUS_RPC_URL);
    await recoverStaleLock(db, connection, stale);
  }

  // Step 1: Check for active lock (genuine concurrent run)
  const activeLock = await findActiveLock(db);
  if (activeLock) {
    return {
      status: 'conflict',
      error: {
        code: 'ANCHOR_RUN_IN_PROGRESS',
        message: 'Another anchor run is in progress',
      },
    };
  }

  // Step 2: Get current ledger head
  const head = await getHead(db);
  if (!head) {
    return { status: 'empty_ledger', duration_ms: Date.now() - startTime };
  }

  // Step 3: Check if this head is already anchored
  const existingAnchor = await findPublishedAnchorForHash(db, head.event_hash);
  if (existingAnchor) {
    return {
      status: 'already_published',
      anchored_head_hash: head.event_hash,
      anchored_head_sequence_no: head.sequence_no,
      duration_ms: Date.now() - startTime,
    };
  }

  // Step 4: Build memo
  const memoText = buildAnchorMemo(head.event_hash);
  const anchorDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Step 5: Create anchor_runs row with lock
  let anchorRunId: number;
  try {
    anchorRunId = await createLockRow(db, {
      anchor_date: anchorDate,
      anchored_head_sequence_no: head.sequence_no,
      anchored_head_hash: head.event_hash,
      trigger_source: triggerSource,
      anchor_wallet_address: env.ANCHOR_WALLET_ADDRESS,
      memo_text: memoText,
    });
  } catch (e) {
    return {
      status: 'failed',
      error: {
        code: 'ANCHOR_FAILED',
        message: `Failed to create anchor run: ${e instanceof Error ? e.message : String(e)}`,
      },
    };
  }

  // Step 6: Sign and send Solana transaction
  const keypairResult = createKeypair(env.ANCHOR_WALLET_SECRET);
  if (!keypairResult.ok) {
    await clearLockOnFailure(db, anchorRunId, keypairResult.error.message);
    return {
      status: 'failed',
      error: { code: 'ANCHOR_FAILED', message: keypairResult.error.message },
    };
  }

  const connection = createConnection(env.HELIUS_RPC_URL);
  const sendResult = await sendMemoTransaction(connection, keypairResult.value, memoText);
  if (!sendResult.ok) {
    await clearLockOnFailure(db, anchorRunId, sendResult.error.message);
    return {
      status: 'failed',
      error: { code: 'ANCHOR_FAILED', message: sendResult.error.message },
    };
  }

  const txSignature = sendResult.value;

  // Step 7: Get wallet balance
  const balanceResult = await getBalance(connection, keypairResult.value.publicKey);
  const solBalance = balanceResult.ok ? balanceResult.value : 0;

  // Step 8: Update anchor_runs to published
  await clearLockOnSuccess(db, anchorRunId, txSignature, solBalance);

  // Step 9: Append anchor_published ledger event
  const cluster = env.SOLANA_CLUSTER as Cluster;
  const publishedAtUtc = utcNow();
  const appendResult = await appendLedgerEvent(db, {
    event_type: 'anchor_published',
    payload: {
      anchor_date: anchorDate,
      anchored_head_sequence_no: head.sequence_no,
      anchored_head_hash: head.event_hash,
      tx_signature: txSignature,
      anchor_wallet_address: env.ANCHOR_WALLET_ADDRESS,
      memo_text: memoText,
      published_at_utc: publishedAtUtc,
      cluster,
    },
    created_at_utc: publishedAtUtc,
  });

  if (!appendResult.ok) {
    // Ledger append failed but transaction succeeded — log but don't fail the anchor
    console.error(`Anchor tx ${txSignature} succeeded but ledger append failed: ${appendResult.error.message}`);
  }

  return {
    status: 'published',
    anchored_head_hash: head.event_hash,
    anchored_head_sequence_no: head.sequence_no,
    memo_text: memoText,
    tx_signature: txSignature,
    duration_ms: Date.now() - startTime,
    anchor_runs_id: anchorRunId,
  };
}
