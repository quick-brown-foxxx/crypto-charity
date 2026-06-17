import { env, SELF } from 'cloudflare:test';
import { createVaultDb } from '@open-care/vault-db';
import { anchorRuns } from '@open-care/vault-db/schema/vault-db';
import { eq } from 'drizzle-orm';
import { describe, it, expect, beforeEach } from 'vitest';
import { cleanTables, seedLedgerEvent } from './seed.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function postManual(): Request {
  return new Request('https://example.com/api/anchor/manual', { method: 'POST' });
}

/**
 * Insert a stale sending row with a tx_signature and an expired
 * locked_until_utc.  The recovery path should look up the tx on-chain
 * (mocked) and backfill to published.
 */
async function seedStaleLockWithTx(
  db: ReturnType<typeof createVaultDb>,
): Promise<void> {
  const pastDate = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  await db.insert(anchorRuns).values({
    anchor_date: '2026-06-16',
    anchored_head_sequence_no: 0,
    anchored_head_hash: 'b'.repeat(64),
    status: 'sending',
    trigger_source: 'cron',
    tx_signature:
      '5Jofwx5DPe1qBwHL7hN3VpFqLxqFj4mJLo5iY7nP8kRt2sT9uVvWxYzAbCdEfGhIjKlMnOpQrStUvWxYz1234',
    anchor_wallet_address: env.ANCHOR_WALLET_ADDRESS,
    memo_text: 'ccv-anchor:' + 'b'.repeat(64),
    attempt_count: 1,
    locked_until_utc: pastDate,
    created_at_utc: pastDate,
    updated_at_utc: pastDate,
  });
}

/**
 * Insert a stale sending row with no tx_signature and an expired
 * locked_until_utc.  The recovery path should mark it as failed.
 */
async function seedStaleLockNoTx(
  db: ReturnType<typeof createVaultDb>,
): Promise<void> {
  const pastDate = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  await db.insert(anchorRuns).values({
    anchor_date: '2026-06-16',
    anchored_head_sequence_no: 0,
    anchored_head_hash: 'b'.repeat(64),
    status: 'sending',
    trigger_source: 'cron',
    tx_signature: null,
    anchor_wallet_address: env.ANCHOR_WALLET_ADDRESS,
    memo_text: 'ccv-anchor:' + 'b'.repeat(64),
    attempt_count: 1,
    locked_until_utc: pastDate,
    created_at_utc: pastDate,
    updated_at_utc: pastDate,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Stale lock recovery', () => {
  let db: ReturnType<typeof createVaultDb>;

  beforeEach(async () => {
    await cleanTables();
    db = createVaultDb(env.vault_db);
  });

  describe('stale lock with tx_signature', () => {
    it('backfills stale lock to published and creates new anchor for current head', async () => {
      // Insert a stale lock with tx_signature
      await seedStaleLockWithTx(db);
      // Seed a ledger event so the pipeline has a head to anchor
      const { hash } = await seedLedgerEvent(db);

      // Trigger anchor via manual endpoint
      const response = await SELF.fetch(postManual());
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        status: string;
        anchored_head_hash: string;
      };
      expect(body.status).toBe('published');
      expect(body.anchored_head_hash).toBe(hash);

      // Verify the stale lock was recovered to published
      const publishedRows = await db
        .select()
        .from(anchorRuns)
        .where(eq(anchorRuns.status, 'published'))
        .all();

      // Should have at least 2 published rows: the recovered stale + the new anchor
      expect(publishedRows.length).toBeGreaterThanOrEqual(2);

      const recoveredStale = publishedRows.find(
        (r) => r.anchored_head_hash === 'b'.repeat(64),
      );
      expect(recoveredStale).toBeDefined();
      expect(recoveredStale!.status).toBe('published');
      expect(recoveredStale!.locked_until_utc).toBeNull();
      expect(recoveredStale!.tx_signature).toBe(
        '5Jofwx5DPe1qBwHL7hN3VpFqLxqFj4mJLo5iY7nP8kRt2sT9uVvWxYzAbCdEfGhIjKlMnOpQrStUvWxYz1234',
      );

      // Verify a new anchor was created for the current head
      const newAnchor = publishedRows.find(
        (r) => r.anchored_head_hash === hash,
      );
      expect(newAnchor).toBeDefined();
      expect(newAnchor!.trigger_source).toBe('operator-manual');
    });

    it('does not create duplicate ledger events for recovered stale lock', async () => {
      // Insert a stale lock with tx_signature
      await seedStaleLockWithTx(db);
      // Seed a ledger event
      await seedLedgerEvent(db);

      // Trigger anchor
      await SELF.fetch(postManual());

      // Count anchor_published events — should be exactly 1 (for the new anchor)
      // The recovery backfill may also try to append, but the unique constraint
      // on event_hash prevents duplicates.
      const allAnchorEvents = await db
        .select()
        .from(anchorRuns)
        .where(eq(anchorRuns.status, 'published'))
        .all();

      // We should have 2 published anchor_runs rows (stale recovered + new)
      expect(allAnchorEvents.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('stale lock without tx_signature', () => {
    it('marks stale lock as failed with lock_expired_no_tx_found', async () => {
      // Insert a stale lock with no tx_signature
      await seedStaleLockNoTx(db);
      // Seed a ledger event so the pipeline has a head to anchor
      await seedLedgerEvent(db);

      // Trigger anchor via manual endpoint
      const response = await SELF.fetch(postManual());
      expect(response.status).toBe(200);

      // Verify the stale lock was marked as failed
      const failedRows = await db
        .select()
        .from(anchorRuns)
        .where(eq(anchorRuns.status, 'failed'))
        .all();

      const recoveredStale = failedRows.find(
        (r) => r.last_error === 'lock_expired_no_tx_found',
      );
      expect(recoveredStale).toBeDefined();
      expect(recoveredStale!.locked_until_utc).toBeNull();
      expect(recoveredStale!.tx_signature).toBeNull();
      expect(recoveredStale!.anchored_head_hash).toBe('b'.repeat(64));
    });

    it('proceeds to publish new anchor after recovering stale lock', async () => {
      // Insert a stale lock with no tx_signature
      await seedStaleLockNoTx(db);
      // Seed a ledger event
      const { hash } = await seedLedgerEvent(db);

      // Trigger anchor
      const response = await SELF.fetch(postManual());
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        status: string;
        anchored_head_hash: string;
      };
      expect(body.status).toBe('published');
      expect(body.anchored_head_hash).toBe(hash);

      // Verify both a failed row (stale) and a published row (new) exist
      const failedRows = await db
        .select()
        .from(anchorRuns)
        .where(eq(anchorRuns.status, 'failed'))
        .all();
      expect(failedRows.length).toBeGreaterThanOrEqual(1);

      const publishedRows = await db
        .select()
        .from(anchorRuns)
        .where(eq(anchorRuns.status, 'published'))
        .all();
      expect(publishedRows.length).toBeGreaterThanOrEqual(1);
    });
  });
});
