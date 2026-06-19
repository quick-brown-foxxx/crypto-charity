import { env, SELF } from 'cloudflare:test';
import { createVaultDb, getEventsPaginated, getHead } from '@open-care/vault-db';
import { anchorRuns } from '@open-care/vault-db/schema/vault-db';
import { computeEventHash, isAnchorPayload } from '@open-care/vault-core';
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
import { resetLedgerEventsForTest } from './reset-ledger-events.js';
import { runAnchor } from '../src/lib/anchor-pipeline.js';
import { configureSolanaMock, resetSolanaMockConfig } from './__mocks__/lib/solana.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function postManual(): Request {
  return new Request('https://example.com/api/anchor/manual', { method: 'POST' });
}

async function expectOnlySeedLedgerEvent(
  db: ReturnType<typeof createVaultDb>,
  seedHash: string,
): Promise<void> {
  const allEvents = await getEventsPaginated(db, { limit: 10 });
  expect(allEvents.items).toHaveLength(1);
  expect(allEvents.items[0]?.event_hash).toBe(seedHash);

  const anchorEvents = await getEventsPaginated(db, {
    eventType: 'anchor_published',
    limit: 10,
  });
  expect(anchorEvents.items).toHaveLength(0);

  const head = await getHead(db);
  expect(head?.event_hash).toBe(seedHash);
}

async function waitForSendingAnchorRun(db: ReturnType<typeof createVaultDb>): Promise<void> {
  const deadline = Date.now() + 1_000;

  while (Date.now() < deadline) {
    const rows = await db.select().from(anchorRuns).where(eq(anchorRuns.status, 'sending')).all();
    if (rows.length > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error('Timed out waiting for sending anchor run');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Anchor Cron Worker', () => {
  let db: ReturnType<typeof createVaultDb>;

  beforeEach(async () => {
    resetSolanaMockConfig();
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
  // Solana failure paths
  // ---------------------------------------------------------------------------

  describe('Solana failure paths', () => {
    it('marks the run failed and appends no ledger event when createKeypair throws', async () => {
      /*
      Scenario: Invalid anchor wallet secret prevents signing
        Given the ledger has an unanchored event
        And keypair creation throws before any Solana transaction is sent
        When the anchor pipeline runs
        Then the anchor run is marked failed
        And the donor ledger still contains only the original event
      */
      configureSolanaMock({
        createKeypair: {
          kind: 'throw',
          message: 'invalid secret',
        },
      });
      const { hash } = await seedLedgerEvent(db);

      const result = await runAnchor(db, env, 'operator-manual');

      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.error.message).toContain('invalid secret');
      }

      const runRows = await db.select().from(anchorRuns).all();
      expect(runRows).toHaveLength(1);
      expect(runRows[0]?.status).toBe('failed');
      expect(runRows[0]?.last_error).toContain('invalid secret');
      expect(runRows[0]?.locked_until_utc).toBeNull();
      expect(runRows[0]?.tx_signature).toBeNull();

      await expectOnlySeedLedgerEvent(db, hash);
    });

    it('marks the run failed and appends no ledger event when sendMemoTransaction fails', async () => {
      /*
      Scenario: Solana RPC rejects the memo transaction
        Given the ledger has an unanchored event
        And memo transaction submission returns an RPC error
        When the anchor pipeline runs
        Then the anchor run is marked failed with the RPC error
        And no anchor_published ledger event is appended
      */
      configureSolanaMock({
        sendMemoTransaction: { kind: 'failure', message: 'RPC error: blockhash not found' },
      });
      const { hash } = await seedLedgerEvent(db);

      const result = await runAnchor(db, env, 'operator-manual');

      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.error.message).toContain('RPC error: blockhash not found');
      }

      const runRows = await db.select().from(anchorRuns).all();
      expect(runRows).toHaveLength(1);
      expect(runRows[0]?.status).toBe('failed');
      expect(runRows[0]?.last_error).toContain('RPC error: blockhash not found');
      expect(runRows[0]?.locked_until_utc).toBeNull();
      expect(runRows[0]?.tx_signature).toBeNull();

      await expectOnlySeedLedgerEvent(db, hash);
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
      const head = await getHead(db);
      const actualSeq = head!.sequence_no;

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
      expect(body.anchored_head_sequence_no).toBe(actualSeq);
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
      const staleHeadHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      await seedStaleLockWithTx(db);
      await db
        .update(anchorRuns)
        .set({ memo_text: `ccv-anchor:${staleHeadHash}` })
        .where(eq(anchorRuns.anchored_head_hash, staleHeadHash));
      await seedLedgerEvent(db);

      const response = await SELF.fetch(postManual());

      // The stale lock should be recovered (backfilled to published)
      const publishedRows = await db
        .select()
        .from(anchorRuns)
        .where(eq(anchorRuns.status, 'published'))
        .all();
      // Should have at least 2 published rows: the recovered stale + the new anchor
      expect(publishedRows.length).toBeGreaterThanOrEqual(2);

      const recoveredStale = publishedRows.find((r) => r.anchored_head_hash === staleHeadHash);
      expect(recoveredStale).toBeDefined();
      expect(recoveredStale!.locked_until_utc).toBeNull();

      const recoveredAnchorEvents = await getEventsPaginated(db, {
        eventType: 'anchor_published',
        limit: 10,
      });
      const recoveredAnchorEvent = recoveredAnchorEvents.items.find(
        (event) =>
          isAnchorPayload(event.payload) && event.payload.anchored_head_hash === staleHeadHash,
      );
      expect(recoveredAnchorEvent).toBeDefined();
      if (!recoveredAnchorEvent) {
        throw new Error('Expected recovered anchor_published event');
      }

      // The pipeline should then proceed and publish the new head
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        status: string;
        anchored_head_hash: string;
      };
      expect(body.status).toBe('published');
      expect(body.anchored_head_hash).toBe(recoveredAnchorEvent.event_hash);
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

    it('appends an anchor_published ledger event for the pre-anchor head', async () => {
      /*
      Scenario: Anchor memo commits to the ledger head before the anchor event exists
        Given the ledger already has multiple events and its head hash is H1
        When the anchor pipeline publishes an anchor
        Then the persisted memo text contains H1
        And the new ledger head H2 is the persisted anchor_published event hash
        And H2 differs from H1 so the anchor event is not covered by its own memo
      */
      const firstSeededEvent = await seedLedgerEvent(db);
      const secondSeededEvent = await seedLedgerEvent(db);
      const preAnchorHead = await getHead(db);
      expect(preAnchorHead).not.toBeNull();
      expect(preAnchorHead!.event_hash).toBe(secondSeededEvent.hash);
      expect(preAnchorHead!.event_hash).not.toBe(firstSeededEvent.hash);

      const response = await SELF.fetch(postManual());
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        status: string;
        anchored_head_hash: string;
        memo_text: string;
        tx_signature: string;
        anchor_runs_id: number;
      };
      expect(body.status).toBe('published');
      expect(body.anchored_head_hash).toBe(preAnchorHead!.event_hash);
      expect(body.memo_text).toBe(`ccv-anchor:${preAnchorHead!.event_hash}`);

      const result = await getEventsPaginated(db, {
        eventType: 'anchor_published',
        limit: 1,
      });
      expect(result.items.length).toBe(1);
      const anchorEvent = result.items[0];
      if (!anchorEvent) {
        throw new Error('Expected anchor_published event');
      }
      expect(anchorEvent.event_type).toBe('anchor_published');
      expect(anchorEvent.prev_hash).toBe(preAnchorHead!.event_hash);
      expect(anchorEvent.event_hash).not.toBe(preAnchorHead!.event_hash);
      expect(anchorEvent.event_hash).toBe(await computeEventHash(anchorEvent));

      expect(isAnchorPayload(anchorEvent.payload)).toBe(true);
      if (!isAnchorPayload(anchorEvent.payload)) {
        throw new Error('Expected anchor_published payload');
      }
      expect(anchorEvent.payload.anchored_head_hash).toBe(preAnchorHead!.event_hash);
      expect(anchorEvent.payload.memo_text).toBe(`ccv-anchor:${preAnchorHead!.event_hash}`);
      expect(anchorEvent.payload.memo_text).not.toContain(anchorEvent.event_hash);
      expect(anchorEvent.payload.tx_signature).toBe(body.tx_signature);
      expect(anchorEvent.payload.cluster).toBe('devnet');
      expect(anchorEvent.payload.anchor_wallet_address).toBeDefined();
      expect(anchorEvent.payload.published_at_utc).toBeDefined();

      const runRows = await db
        .select()
        .from(anchorRuns)
        .where(eq(anchorRuns.id, body.anchor_runs_id))
        .all();
      expect(runRows).toHaveLength(1);
      expect(runRows[0]?.status).toBe('published');
      expect(runRows[0]?.anchored_head_hash).toBe(preAnchorHead!.event_hash);
      expect(runRows[0]?.anchored_head_sequence_no).toBe(preAnchorHead!.sequence_no);
      expect(runRows[0]?.memo_text).toBe(`ccv-anchor:${preAnchorHead!.event_hash}`);

      const postAnchorHead = await getHead(db);
      expect(postAnchorHead).not.toBeNull();
      expect(postAnchorHead!.event_hash).toBe(anchorEvent.event_hash);
      expect(postAnchorHead!.event_hash).not.toBe(preAnchorHead!.event_hash);
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

    it('allows only one winner when cron and manual trigger run concurrently', async () => {
      /*
      Scenario: Cron and operator manual trigger race for the same ledger head
        Given the ledger has an unanchored event
        And the cron run has created the DB lock but not finished sending
        When cron and manual trigger are awaited together
        Then cron publishes the anchor
        And the manual trigger receives a 409 conflict
      */
      const { hash } = await seedLedgerEvent(db);
      configureSolanaMock({ sendMemoTransaction: { kind: 'success', delay_ms: 100 } });

      const cronPromise = runAnchor(db, env, 'cron');
      await waitForSendingAnchorRun(db);
      const manualPromise = SELF.fetch(postManual());

      const [cronResult, manualResponse] = await Promise.all([cronPromise, manualPromise]);

      expect(cronResult.status).toBe('published');
      if (cronResult.status === 'published') {
        expect(cronResult.anchored_head_hash).toBe(hash);
      }
      expect(manualResponse.status).toBe(409);
      const manualBody = (await manualResponse.json()) as {
        error: { code: string; message: string };
      };
      expect(manualBody.error.code).toBe('ANCHOR_RUN_IN_PROGRESS');

      const runRows = await db.select().from(anchorRuns).all();
      expect(runRows).toHaveLength(1);
      expect(runRows[0]?.status).toBe('published');
      expect(runRows[0]?.trigger_source).toBe('cron');

      const anchorEvents = await getEventsPaginated(db, {
        eventType: 'anchor_published',
        limit: 10,
      });
      expect(anchorEvents.items).toHaveLength(1);
      const anchorEvent = anchorEvents.items[0];
      expect(anchorEvent?.prev_hash).toBe(hash);
      expect(anchorEvent?.event_hash).toMatch(/^[0-9a-f]{64}$/);
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
  // row and ledger event are recovered.
  //
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

      // Simulate appendLedgerEvent failure: delete the ledger event through
      // the test-only reset helper, which temporarily bypasses append-only
      // triggers and then reinstalls them.
      await resetLedgerEventsForTest(db);

      // Verify no anchor_published events remain
      const eventsAfterDelete = await getEventsPaginated(db, {
        eventType: 'anchor_published',
        limit: 1,
      });
      expect(eventsAfterDelete.items.length).toBe(0);

      // Re-seed the donation event (it was deleted too)
      const recoveredDonation = await seedLedgerEvent(db);

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
      await runAnchor(db, env, 'operator-manual');

      // The stale lock should be recovered to published
      const recoveredRow = await db
        .select()
        .from(anchorRuns)
        .where(eq(anchorRuns.id, anchorRunId))
        .all();
      expect(recoveredRow.length).toBe(1);
      expect(recoveredRow[0].status).toBe('published');
      expect(recoveredRow[0].locked_until_utc).toBeNull();

      // The recovery backfill should append an anchor_published ledger event
      // at the on-chain block time, linked after the re-seeded donation event.
      const recoveredEvents = await getEventsPaginated(db, { limit: 10 });
      const recoveredDonationEvent = recoveredEvents.items.find(
        (event) => event.event_hash === recoveredDonation.hash,
      );
      if (!recoveredDonationEvent) {
        throw new Error('Expected recovered donation event');
      }

      expect(recoveredDonationEvent.event_type).toBe('donation_confirmed');
      expect(recoveredDonationEvent.event_hash).toBe(recoveredDonation.hash);

      const expectedBlockTimeUtc = '2024-04-05T19:34:38Z';
      const backfilledAnchorEvent = recoveredEvents.items.find(
        (event) =>
          event.event_type === 'anchor_published' &&
          isAnchorPayload(event.payload) &&
          event.payload.anchored_head_hash === recoveredDonation.hash &&
          event.created_at_utc === expectedBlockTimeUtc,
      );
      expect(backfilledAnchorEvent).toBeDefined();
      if (!backfilledAnchorEvent) {
        throw new Error('Expected recovered anchor_published event');
      }

      expect(backfilledAnchorEvent.sequence_no).toBe(recoveredDonationEvent.sequence_no + 1);
      expect(backfilledAnchorEvent.prev_hash).toBe(recoveredDonationEvent.event_hash);
      expect(backfilledAnchorEvent.created_at_utc).toBe(expectedBlockTimeUtc);
      expect(backfilledAnchorEvent.event_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(backfilledAnchorEvent.event_hash).toBe(await computeEventHash(backfilledAnchorEvent));
      expect(isAnchorPayload(backfilledAnchorEvent.payload)).toBe(true);
      if (!isAnchorPayload(backfilledAnchorEvent.payload)) {
        throw new Error('Expected backfilled anchor payload');
      }
      expect(backfilledAnchorEvent.payload.anchored_head_hash).toBe(recoveredDonation.hash);
      expect(backfilledAnchorEvent.payload.published_at_utc).toBe(expectedBlockTimeUtc);
    });
  });
});
