import { sql } from 'drizzle-orm';
import { vaultSchema } from '@open-care/vault-db';
import type { VaultDb } from '@open-care/vault-db';
import { ok, err, logInfo, logError, utcNow } from '@open-care/vault-core';
import type { Result } from '@open-care/vault-core';
import type { Env } from './env.js';
import { fetchSignaturesForAddress } from './solana-rpc.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan the vault USDC ATA transaction history for signatures that are missing
 * from the system and insert them into `helius_inbox` with
 * `source='reconciliation'`.
 *
 * Reconciliation is the backfill path: if Helius webhooks miss a transaction
 * (downtime, rate limiting, etc.), this function fetches recent successful
 * signatures from the vault ATA and inserts any missing ones into the inbox.
 * The same async processor (`processInbox`) handles both `webhook` and
 * `reconciliation` source rows.
 *
 * @param db      - Drizzle D1 instance for the vault database
 * @param env     - Ingest environment bindings (RPC URL, vault ATA address)
 * @param fetchFn - Optional fetch implementation (defaults to `globalThis.fetch`)
 * @returns       - `{ inserted, skipped }` counts on success, or an Error
 */
export async function reconcileMissedSignatures(
  db: VaultDb,
  env: Env,
  fetchFn?: typeof fetch,
): Promise<Result<{ inserted: number; skipped: number }, Error>> {
  try {
    // 1. Fetch recent successful transaction signatures for the vault ATA
    const sigsResult = await fetchSignaturesForAddress(
      env.HELIUS_RPC_URL,
      env.VAULT_USDC_ATA,
      fetchFn,
    );

    if (!sigsResult.ok) {
      logError('Reconciliation RPC fetch failed', {
        error: sigsResult.error.message,
      });
      return err(new Error(`Reconciliation RPC error: ${sigsResult.error.message}`));
    }

    const signatures = sigsResult.value;
    let inserted = 0;
    let skipped = 0;

    // 2. For each signature, check if it already exists in the system
    for (const signature of signatures) {
      // Check helius_inbox — any row with this signature (any source)
      const inboxRows = await db.all(
        sql`SELECT 1 FROM helius_inbox WHERE signature = ${signature} LIMIT 1`,
      );

      if (inboxRows.length > 0) {
        skipped++;
        continue;
      }

      // Check ledger_events — donation_confirmed with matching tx_signature
      const ledgerRows = await db.all(
        sql`SELECT 1 FROM ledger_events WHERE event_type = 'donation_confirmed' AND json_extract(payload_json, '$.tx_signature') = ${signature} LIMIT 1`,
      );

      if (ledgerRows.length > 0) {
        skipped++;
        continue;
      }

      // 3. Signature is not in either table — insert into helius_inbox
      const now = utcNow();
      await db.insert(vaultSchema.heliusInbox).values({
        signature,
        source: 'reconciliation',
        raw_payload_json: JSON.stringify({
          signature,
          source: 'reconciliation',
          reconciled_at_utc: now,
        }),
        status: 'received',
        attempt_count: 0,
        received_at_utc: now,
        updated_at_utc: now,
      });

      inserted++;
    }

    logInfo('Reconciliation scan completed', {
      signatures_fetched: signatures.length,
      inserted,
      skipped,
    });

    return ok({ inserted, skipped });
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
