import { and, eq, lt, inArray, sql } from 'drizzle-orm';
import { vaultSchema, appendLedgerEvent } from '@open-care/vault-db';
import type { VaultDb } from '@open-care/vault-db';
import type { DonationPayload, Cluster } from '@open-care/vault-core';
import type { Env } from './env.js';
import { fetchTransaction, parseSplTransfer } from './solana-rpc.js';

const { heliusInbox } = vaultSchema;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns current UTC time as ISO-8601 second-precision with Z suffix. */
export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InboxEntry {
  signature: string;
  source: 'webhook' | 'reconciliation';
  rawPayloadJson: string;
  receivedAtUtc: string;
}

export interface InboxStatusUpdate {
  status:
    | 'received'
    | 'processing'
    | 'processed'
    | 'ignored'
    | 'failed'
    | 'duplicate';
  reason?: string;
  attemptCount?: number;
  lastError?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Insert webhook/reconciliation events into the durable inbox.
 *
 * Uses a two-step approach: first query existing rows to detect duplicates,
 * then insert all with ON CONFLICT DO NOTHING (targeting the composite
 * primary key `(signature, source)` automatically).
 *
 * @returns Counts of accepted (newly inserted) and duplicate (already present)
 *          entries.
 */
export async function insertIntoInbox(
  db: VaultDb,
  entries: InboxEntry[],
): Promise<{ accepted: number; duplicates: number }> {
  if (entries.length === 0) return { accepted: 0, duplicates: 0 };

  // Step 1: Query existing rows to find which entries are already present.
  const uniqueSignatures = [...new Set(entries.map((e) => e.signature))];
  const existingRows = await db
    .select({
      signature: heliusInbox.signature,
      source: heliusInbox.source,
    })
    .from(heliusInbox)
    .where(inArray(heliusInbox.signature, uniqueSignatures));

  const existingSet = new Set(
    existingRows.map((r) => `${r.signature}|${r.source}`),
  );

  // Step 2: Insert all entries with ON CONFLICT DO NOTHING.
  for (const entry of entries) {
    await db
      .insert(heliusInbox)
      .values({
        signature: entry.signature,
        source: entry.source,
        raw_payload_json: entry.rawPayloadJson,
        status: 'received',
        attempt_count: 0,
        received_at_utc: entry.receivedAtUtc,
        updated_at_utc: entry.receivedAtUtc,
      })
      .onConflictDoNothing();
  }

  // Step 3: Count accepted vs duplicates based on the pre-query.
  let accepted = 0;
  let duplicates = 0;
  for (const entry of entries) {
    if (existingSet.has(`${entry.signature}|${entry.source}`)) {
      duplicates++;
    } else {
      accepted++;
    }
  }

  return { accepted, duplicates };
}

/**
 * Process pending inbox rows asynchronously.
 *
 * For each row with `status = 'received'` and `attempt_count < 10`:
 * 1. Mark as `processing`
 * 2. Fetch the transaction from Solana RPC
 * 3. Parse for a matching USDC transfer to the vault ATA
 * 4. Check for duplicate donations already in the ledger
 * 5. Append a `donation_confirmed` event to the hash-chained ledger
 * 6. Update the inbox status to `processed`, `ignored`, `failed`, or
 *    `duplicate` accordingly
 *
 * Designed to be called via `ctx.waitUntil()` so the webhook response can
 * return immediately while processing happens in the background.
 *
 * @param db      - Drizzle instance backed by the vault D1 database
 * @param env     - Environment bindings (RPC URL, addresses, cluster)
 * @param fetchFn - Optional fetch implementation (defaults to `globalThis.fetch`)
 * @returns Counts of processed, ignored, and failed rows.
 */
export async function processInbox(
  db: VaultDb,
  env: Env,
  fetchFn?: typeof fetch,
): Promise<{ processed: number; ignored: number; failed: number }> {
  // Query rows ready for processing
  const rows = await db
    .select()
    .from(heliusInbox)
    .where(
      and(
        eq(heliusInbox.status, 'received'),
        lt(heliusInbox.attempt_count, 10),
      ),
    )
    .orderBy(heliusInbox.received_at_utc)
    .limit(10);

  let processed = 0;
  let ignored = 0;
  let failed = 0;

  for (const row of rows) {
    // Step 1: Mark as processing
    await updateInboxStatus(db, row.signature, row.source, {
      status: 'processing',
    });

    // Step 2: Fetch transaction from RPC
    const txResult = await fetchTransaction(
      env.HELIUS_RPC_URL,
      row.signature,
      fetchFn,
    );

    if (!txResult.ok) {
      const rpcError = txResult.error;
      const newAttemptCount = row.attempt_count + 1;

      if (rpcError.retryable && newAttemptCount < 10) {
        // Retryable — keep in received state for next poll
        await updateInboxStatus(db, row.signature, row.source, {
          status: 'received',
          attemptCount: newAttemptCount,
          lastError: rpcError.message,
        });
      } else {
        // Non-retryable or exhausted attempts
        await updateInboxStatus(db, row.signature, row.source, {
          status: 'failed',
          reason: rpcError.message,
          attemptCount: newAttemptCount,
          lastError: rpcError.message,
        });
        failed++;
      }
      continue;
    }

    const tx = txResult.value;

    // Step 3: Parse SPL transfer
    const parseResult = parseSplTransfer(
      tx,
      env.USDC_MINT,
      env.VAULT_USDC_ATA,
    );

    if (!parseResult.ok) {
      await updateInboxStatus(db, row.signature, row.source, {
        status: 'ignored',
        reason: 'no_matching_transfer',
      });
      ignored++;
      continue;
    }

    const match = parseResult.value;

    // Step 4: Check for duplicate donation already in the ledger
    const isDuplicate = await checkDuplicateDonation(db, row.signature);
    if (isDuplicate) {
      await updateInboxStatus(db, row.signature, row.source, {
        status: 'duplicate',
        reason: 'donation_already_recorded',
      });
      // Duplicates are tracked in the DB but not counted in the return
      continue;
    }

    // Step 5: Build DonationPayload and append to the hash-chained ledger
    const payload: DonationPayload = {
      cluster: env.SOLANA_CLUSTER as Cluster,
      usdc_mint: env.USDC_MINT,
      treasury_wallet_address: env.TREASURY_WALLET_ADDRESS,
      vault_usdc_ata: env.VAULT_USDC_ATA,
      tx_signature: row.signature,
      transaction_version: 0,
      instruction_index: match.instructionIndex,
      inner_index: match.innerIndex,
      slot: tx.slot,
      block_time_utc: tx.blockTime
        ? new Date(tx.blockTime * 1000)
            .toISOString()
            .replace(/\.\d{3}Z$/, 'Z')
        : nowIso(),
      amount_usdc_minor: match.amount,
    };

    const appendResult = await appendLedgerEvent(db, {
      event_type: 'donation_confirmed',
      payload,
      created_at_utc: nowIso(),
    });

    if (!appendResult.ok) {
      await updateInboxStatus(db, row.signature, row.source, {
        status: 'failed',
        reason: appendResult.error.message,
      });
      failed++;
      continue;
    }

    // Step 6: Mark as processed
    await updateInboxStatus(db, row.signature, row.source, {
      status: 'processed',
    });
    processed++;
  }

  return { processed, ignored, failed };
}

/**
 * Update the status (and optional metadata) of an inbox row.
 *
 * Always sets `updated_at_utc` to the current ISO-8601 timestamp.
 * The row is identified by its composite primary key `(signature, source)`.
 */
export async function updateInboxStatus(
  db: VaultDb,
  signature: string,
  source: string,
  update: InboxStatusUpdate,
): Promise<void> {
  await db
    .update(heliusInbox)
    .set({
      status: update.status,
      updated_at_utc: nowIso(),
      ...(update.reason !== undefined ? { reason: update.reason } : {}),
      ...(update.attemptCount !== undefined
        ? { attempt_count: update.attemptCount }
        : {}),
      ...(update.lastError !== undefined
        ? { last_error: update.lastError }
        : {}),
    })
    .where(
      and(
        eq(heliusInbox.signature, signature),
        eq(heliusInbox.source, source),
      ),
    );
}

/**
 * Check whether a donation with the given transaction signature has already
 * been recorded in the ledger.
 *
 * Uses `json_extract` on the `payload_json` column to search for a matching
 * `tx_signature` within `donation_confirmed` events.
 *
 * @returns `true` if a matching ledger event exists, `false` otherwise.
 */
export async function checkDuplicateDonation(
  db: VaultDb,
  txSignature: string,
): Promise<boolean> {
  const rows = await db.all(
    sql`SELECT 1 FROM ledger_events
        WHERE event_type = 'donation_confirmed'
          AND json_extract(payload_json, '$.tx_signature') = ${txSignature}
        LIMIT 1`,
  );
  return rows.length > 0;
}
