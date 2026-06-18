import { env, SELF } from 'cloudflare:test';
import { createVaultDb, getEventsPaginated, getHead } from '@open-care/vault-db';
import { anchorRuns, ledgerEvents } from '@open-care/vault-db/schema/vault-db';
import { eq } from 'drizzle-orm';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  cleanTables,
  seedLedgerEvent,
  seedPublishedAnchor,
  seedActiveLock,
  seedStaleLockNoTx,
  seedStaleLockWithTx,
} from './seed.js';
import { runAnchor } from '../src/lib/anchor-pipeline.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function postManual(): Request {
  return new Request('https://example.com/api/anchor/manual', { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Anchor Cron Worker', () => {
  let db: ReturnType<typeof createVaultDb>;

  beforeEach(async () => {
    await cleanTables();
    db = createVaultDb(env.vault_db);
  });

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------

  describe('GET /health', () => {
    it('returns 200 with status ok', async () => {
      const response = await SELF.fetch('https://example.com/health');
      expect(response.status).toBe(200);
      const body = (await response.json()) as { status: string };
      expect(body.status).toBe('ok');
    });
  });

  // ---------------------------------------------------------------------------
  // Manual trigger — empty ledger
  // ---------------------------------------------------------------------------

  describe('POST /api/anchor/manual — empty ledger', () => {
    it('returns empty_ledger when no events exist', async () => {
      const response = await SELF.fetch(postManual());
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        status: string;
        duration_ms: number;
      };
      expect(body.status).toBe('empty_ledger');
      expect(body.duration_ms).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Manual trigger — already published
  // ---------------------------------------------------------------------------

  describe('POST /api/anchor/manual — already published', () => {
    it('returns already_published when head is already anchored', async () => {
      const { hash, seq } = await seedLedgerEvent(db);
      await seedPublishedAnchor(db, hash, seq);

      const response = await SELF.fetch(postManual());
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        status: string;
        anchored_head_hash: string;
        anchored_head_sequence_no: number;
        duration_ms: number;
      };
      expect(body.status).toBe('already_published');
      expect(body.anchored_head_hash).toBe(hash);
      expect(body.anchored_head_sequence_no).toBe(seq);
      expect(body.duration_ms).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Manual trigger — lock conflict
  // ---------------------------------------------------------------------------

  describe('POST /api/anchor/manual — lock conflict', () => {
    it('returns 409 when another run is in progress', async () => {
      await seedActiveLock(db);

      const response = await SELF.fetch(postManual());
      expect(response.status).toBe(409);
      const body = (await response.json()) as {
        error: { code: string; message: string; request_id?: string };
      };
      expect(body.error.code).toBe('ANCHOR_RUN_IN_PROGRESS');
      expect(body.error.message).toBe('Another anchor run is in progress');
      expect(body.error.request_id).toBeDefined();
      expect(typeof body.error.request_id).toBe('string');
    });
  });

  // ---------------------------------------------------------------------------
  // Stale lock recovery
  // ---------------------------------------------------------------------------

  describe('stale lock recovery — no tx_signature', () => {
    it('marks stale lock as failed, then proceeds to publish', async () => {
      await seedStaleLockNoTx(db);
      const { hash } = await seedLedgerEvent(db);

      const response = await SELF.fetch(postManual());

      // The stale lock should be recovered (marked as failed)
      const failedRows = await db
        .select()
        .from(anchorRuns)
        .where(eq(anchorRuns.status, 'failed'))
        .all();
      const recoveredStale = failedRows.find((r) => r.last_error === 'lock_expired_no_tx_found');
      expect(recoveredStale).toBeDefined();
      expect(recoveredStale!.locked_until_utc).toBeNull();

      // The pipeline should then proceed and publish (mocked Solana)
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        status: string;
        anchored_head_hash: string;
        tx_signature: string;
        anchor_runs_id: number;
      };
      expect(body.status).toBe('published');
      expect(body.anchored_head_hash).toBe(hash);
      expect(body.tx_signature).toBeDefined();
      expect(body.anchor_runs_id).toBeGreaterThan(0);
    });
  });

  describe('stale lock recovery — with tx_signature', () => {
    it('backfills stale lock to published, then proceeds to publish', async () => {
      await seedStaleLockWithTx(db);
      const { hash } = await seedLedgerEvent(db);

      const response = await SELF.fetch(postManual());

      // The stale lock should be recovered (backfilled to published)
      const publishedRows = await db
        .select()
        .from(anchorRuns)
        .where(eq(anchorRuns.status, 'published'))
        .all();
      // Should have at least 2 published rows: the recovered stale + the new anchor
      expect(publishedRows.length).toBeGreaterThanOrEqual(2);

      const recoveredStale = publishedRows.find(
        (r) =>
          r.anchored_head_hash ===
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      );
      expect(recoveredStale).toBeDefined();
      expect(recoveredStale!.locked_until_utc).toBeNull();

      // The pipeline should then proceed and publish the new head
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        status: string;
        anchored_head_hash: string;
      };
      expect(body.status).toBe('published');
      expect(body.anchored_head_hash).toBe(hash);
    });
  });

  // ---------------------------------------------------------------------------
  // Full success path (mocked Solana)
  // ---------------------------------------------------------------------------

  describe('POST /api/anchor/manual — full success path', () => {
    it('publishes an anchor when ledger has unanchored events', async () => {
      const { hash } = await seedLedgerEvent(db);

      // Read the actual sequence_no from the DB (AUTOINCREMENT may differ
      // from the value returned by appendLedgerEvent after DELETE+reinsert).
      const head = await getHead(db);
      const actualSeq = head!.sequence_no;

      const response = await SELF.fetch(postManual());

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        status: string;
        anchored_head_hash: string;
        anchored_head_sequence_no?: number;
        memo_text: string;
        tx_signature: string;
        duration_ms: number;
        anchor_runs_id: number;
      };
      expect(body.status).toBe('published');
      expect(body.anchored_head_hash).toBe(hash);
      expect(body.memo_text).toContain('ccv-anchor:');
      expect(body.memo_text).toContain(hash);
      expect(body.tx_signature).toBeDefined();
      expect(body.tx_signature.length).toBeGreaterThan(0);
      expect(body.duration_ms).toBeGreaterThan(0);
      expect(body.anchor_runs_id).toBeGreaterThan(0);

      // Verify the anchor_runs row was created with published status
      const runRows = await db
        .select()
        .from(anchorRuns)
        .where(eq(anchorRuns.id, body.anchor_runs_id))
        .all();
      expect(runRows.length).toBe(1);
      expect(runRows[0].status).toBe('published');
      expect(runRows[0].anchored_head_hash).toBe(hash);
      expect(runRows[0].anchored_head_sequence_no).toBe(actualSeq);
      expect(runRows[0].tx_signature).toBe(body.tx_signature);
      expect(runRows[0].last_anchor_wallet_sol_lamports).toBe(1_000_000_000);
      expect(runRows[0].locked_until_utc).toBeNull();
      expect(runRows[0].trigger_source).toBe('operator-manual');
    });

    it('appends an anchor_published ledger event', async () => {
      const { hash } = await seedLedgerEvent(db);

      const response = await SELF.fetch(postManual());
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        status: string;
        tx_signature: string;
      };
      expect(body.status).toBe('published');

      // Query ledger_events for the anchor_published event
      const result = await getEventsPaginated(db, {
        eventType: 'anchor_published',
        limit: 1,
      });
      expect(result.items.length).toBe(1);
      const anchorEvent = result.items[0];
      expect(anchorEvent.event_type).toBe('anchor_published');
      const payload = anchorEvent.payload as Record<string, unknown>;
      expect(payload.anchored_head_hash).toBe(hash);
      expect(payload.tx_signature).toBe(body.tx_signature);
      expect(payload.cluster).toBe('devnet');
      expect(payload.anchor_wallet_address).toBeDefined();
      expect(payload.published_at_utc).toBeDefined();
    });

    it('creates a valid memo with ccv-anchor prefix', async () => {
      const { hash } = await seedLedgerEvent(db);

      const response = await SELF.fetch(postManual());
      expect(response.status).toBe(200);
      const body = (await response.json()) as { memo_text: string };
      // Memo format: ccv-anchor:<64-lowercase-hex-chars>
      expect(body.memo_text).toMatch(/^ccv-anchor:[0-9a-f]{64}$/);
      expect(body.memo_text).toBe(`ccv-anchor:${hash}`);
    });
  });

  // ---------------------------------------------------------------------------
  // Scheduled handler (cron trigger)
  // ---------------------------------------------------------------------------

  describe('scheduled handler', () => {
    it('runs the anchor pipeline on cron trigger', async () => {
      const { hash } = await seedLedgerEvent(db);

      // Call runAnchor directly with cron trigger source
      const result = await runAnchor(db, env, 'cron');

      expect(result.status).toBe('published');
      if (result.status === 'published') {
        expect(result.anchored_head_hash).toBe(hash);
        expect(result.tx_signature).toBeDefined();

        // Verify the anchor_runs row has trigger_source = 'cron'
        const runRows = await db
          .select()
          .from(anchorRuns)
          .where(eq(anchorRuns.id, result.anchor_runs_id))
          .all();
        expect(runRows.length).toBe(1);
        expect(runRows[0].trigger_source).toBe('cron');
      }
    });

    it('handles empty ledger gracefully from cron', async () => {
      // No ledger events seeded — should not throw
      const result = await runAnchor(db, env, 'cron');

      expect(result.status).toBe('empty_ledger');

      // No anchor_runs rows should have been created
      const allRows = await db.select().from(anchorRuns).all();
      expect(allRows.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // appendLedgerEvent failure recovery
  //
  // The anchor pipeline sends the Solana tx first, then appends the ledger
  // event.  If the ledger append fails after a successful on-chain tx, the
  // pipeline still returns 'published' (the on-chain record is the source of
  // truth).  On the next run, the stale lock recovery path detects the
  // orphaned tx and recovers the anchor_runs row to 'published'.
  //
  // This test simulates the failure by deleting the ledger event after a
  // successful run, then re-running the pipeline to verify the anchor_runs
  // row is recovered.  The ledger event backfill is verified separately
  // because the mock's blockTime produces millisecond-precision timestamps
  // that fail isValidTimestamp validation in appendLedgerEvent.
  //
  // Note: createKeypair and sendMemoTransaction failure tests cannot be
  // implemented with the current test infrastructure because
  // @cloudflare/vitest-pool-workers runs worker code in a separate workerd
  // isolate where vi.mock and resolve.alias for file paths do not apply.
  // The @solana/web3.js stub and outboundService mock always return success.
  // Testing those failure paths would require modifying the outboundService
  // mock in vitest.config.ts to support configurable error responses.
  // ---------------------------------------------------------------------------

  describe('appendLedgerEvent fails after successful on-chain tx', () => {
    it('anchor_runs row is recovered to published on next run', async () => {
      const { hash } = await seedLedgerEvent(db);

      // First run: everything succeeds, ledger event is appended
      const result1 = await runAnchor(db, env, 'operator-manual');
      expect(result1.status).toBe('published');
      if (result1.status === 'published') {
        expect(result1.anchored_head_hash).toBe(hash);
      }

      // Verify anchor_runs row is published
      const runRows1 = await db.select().from(anchorRuns).all();
      expect(runRows1.length).toBe(1);
      expect(runRows1[0].status).toBe('published');
      const anchorRunId = runRows1[0].id;
      const txSignature = runRows1[0].tx_signature!;
      expect(txSignature).toBeDefined();

      // Verify ledger event was appended
      const events1 = await getEventsPaginated(db, {
        eventType: 'anchor_published',
        limit: 1,
      });
      expect(events1.items.length).toBe(1);

      // Simulate appendLedgerEvent failure: delete the ledger event
      await db.delete(ledgerEvents);

      // Verify no anchor_published events remain
      const eventsAfterDelete = await getEventsPaginated(db, {
        eventType: 'anchor_published',
        limit: 1,
      });
      expect(eventsAfterDelete.items.length).toBe(0);

      // Re-seed the donation event (it was deleted too)
      await seedLedgerEvent(db);

      // Change the anchor_runs row to simulate a stale lock (tx succeeded
      // but ledger append "failed", leaving the row in sending state with
      // an expired lock)
      const pastDate = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      await db
        .update(anchorRuns)
        .set({
          status: 'sending',
          locked_until_utc: pastDate,
          updated_at_utc: pastDate,
        })
        .where(eq(anchorRuns.id, anchorRunId));

      // Second run: recovery should detect the stale lock, find the tx
      // on-chain (mocked via outboundService), and recover the row
      const result2 = await runAnchor(db, env, 'operator-manual');

      // The stale lock should be recovered to published
      const recoveredRow = await db
        .select()
        .from(anchorRuns)
        .where(eq(anchorRuns.id, anchorRunId))
        .all();
      expect(recoveredRow.length).toBe(1);
      expect(recoveredRow[0].status).toBe('published');
      expect(recoveredRow[0].locked_until_utc).toBeNull();

      // The pipeline should then return already_published
      // (the head is now anchored by the recovered row)
      expect(result2.status).toBe('already_published');
    });
  });
});
