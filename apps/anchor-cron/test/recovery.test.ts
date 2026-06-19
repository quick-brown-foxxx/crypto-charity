import { env, SELF } from 'cloudflare:test';
import { appendLedgerEvent, createVaultDb, getEventsPaginated } from '@open-care/vault-db';
import { anchorRuns } from '@open-care/vault-db/schema/vault-db';
import { isAnchorPayload, ok, type Cluster } from '@open-care/vault-core';
import { eq } from 'drizzle-orm';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { postManualAnchor } from './helpers.js';
import {
  anchorMemo,
  cleanTables,
  seedLedgerEvent,
  seedStaleLockNoTx,
  seedStaleLockWithTx,
  TEST_ALT_ANCHOR_HEAD_HASH,
  TEST_TX_SIGNATURE,
} from './seed.js';
import { recoverStaleLock } from '../src/lib/recovery.js';
import * as solana from '../src/lib/solana.js';
import { configureSolanaMock, resetSolanaMockConfig } from './__mocks__/lib/solana.js';

async function getAnchorRunById(
  db: ReturnType<typeof createVaultDb>,
  id: number,
): Promise<typeof anchorRuns.$inferSelect> {
  const rows = await db.select().from(anchorRuns).where(eq(anchorRuns.id, id)).all();
  const row = rows[0];
  if (!row) {
    throw new Error(`Expected anchor run row ${id}`);
  }
  return row;
}

function seedRecoveryStaleLockWithTx(
  db: ReturnType<typeof createVaultDb>,
  anchoredHead: { hash: string; seq?: number },
  memoText = anchorMemo(anchoredHead.hash),
): Promise<number> {
  return seedStaleLockWithTx(db, {
    anchorDate: '2026-06-16',
    anchoredHead,
    memoText,
    attemptCount: 1,
  });
}

function seedRecoveryStaleLockNoTx(db: ReturnType<typeof createVaultDb>): Promise<number> {
  return seedStaleLockNoTx(db, {
    anchorDate: '2026-06-16',
    anchoredHeadHash: TEST_ALT_ANCHOR_HEAD_HASH,
    anchoredHeadSequenceNo: 0,
    attemptCount: 1,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Stale lock recovery', () => {
  let db: ReturnType<typeof createVaultDb>;

  beforeEach(async () => {
    resetSolanaMockConfig();
    await cleanTables();
    db = createVaultDb(env.vault_db);
  });

  afterEach(() => {
    resetSolanaMockConfig();
    vi.restoreAllMocks();
  });

  describe('stale lock with tx_signature', () => {
    it('backfills stale lock to published and creates new anchor for current head', async () => {
      // Seed a ledger event so the pipeline has a head to anchor
      const originalHead = await seedLedgerEvent(db);
      // Insert a stale lock with tx_signature for that real ledger head.
      await seedRecoveryStaleLockWithTx(db, originalHead);

      // Trigger anchor via manual endpoint
      const response = await SELF.fetch(postManualAnchor());
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        status: string;
        anchored_head_hash: string;
      };
      expect(body.status).toBe('published');

      const ledgerEvents = await getEventsPaginated(db, { limit: 10 });
      const backfilledAnchorEvent = ledgerEvents.items.find(
        (event) =>
          event.event_type === 'anchor_published' &&
          isAnchorPayload(event.payload) &&
          event.payload.anchored_head_hash === originalHead.hash,
      );
      expect(backfilledAnchorEvent).toBeDefined();
      if (!backfilledAnchorEvent) {
        throw new Error('Expected backfilled anchor_published event');
      }
      expect(backfilledAnchorEvent.sequence_no).toBe(originalHead.seq + 1);
      expect(backfilledAnchorEvent.created_at_utc).toBe('2024-04-05T19:34:38Z');

      // The recovery backfill becomes the ledger head before this run publishes
      // the new anchor, so the manual response should refer to that head.
      expect(body.anchored_head_hash).toBe(backfilledAnchorEvent.event_hash);

      // Verify the stale lock was recovered to published
      const publishedRows = await db
        .select()
        .from(anchorRuns)
        .where(eq(anchorRuns.status, 'published'))
        .all();

      // Should have 2 published rows: the recovered stale + the new anchor.
      expect(publishedRows).toHaveLength(2);

      const recoveredStale = publishedRows.find((r) => r.anchored_head_hash === originalHead.hash);
      expect(recoveredStale).toBeDefined();
      expect(recoveredStale!.status).toBe('published');
      expect(recoveredStale!.anchored_head_sequence_no).toBe(originalHead.seq);
      expect(recoveredStale!.locked_until_utc).toBeNull();
      expect(recoveredStale!.tx_signature).toBe(TEST_TX_SIGNATURE);

      // Verify a new anchor was created for the current head after recovery.
      const newAnchor = publishedRows.find(
        (r) => r.anchored_head_hash === backfilledAnchorEvent.event_hash,
      );
      expect(newAnchor).toBeDefined();
      expect(newAnchor!.trigger_source).toBe('operator-manual');
      expect(newAnchor!.anchored_head_sequence_no).toBe(backfilledAnchorEvent.sequence_no);
    });

    it('does not create duplicate ledger events for recovered stale lock', async () => {
      // Seed a ledger event
      const originalHead = await seedLedgerEvent(db);
      // Insert a stale lock with tx_signature for that real ledger head.
      await seedRecoveryStaleLockWithTx(db, originalHead);

      // Trigger anchor
      const response = await SELF.fetch(postManualAnchor());
      expect(response.status).toBe(200);

      const publishedAnchorEvents = await getEventsPaginated(db, {
        eventType: 'anchor_published',
        limit: 10,
      });
      const recoveredAnchorEvents = publishedAnchorEvents.items.filter(
        (event) =>
          isAnchorPayload(event.payload) && event.payload.anchored_head_hash === originalHead.hash,
      );
      expect(recoveredAnchorEvents).toHaveLength(1);

      const allPublishedRuns = await db
        .select()
        .from(anchorRuns)
        .where(eq(anchorRuns.status, 'published'))
        .all();

      // We should have 2 published anchor_runs rows (stale recovered + new).
      expect(allPublishedRuns).toHaveLength(2);
    });

    it('publishes stale row without appending when matching anchor ledger event already exists', async () => {
      // Scenario: a previous recovery appended anchor_published, then crashed
      // before updating anchor_runs from sending to published. Retrying recovery
      // must reuse the ledger event instead of appending a duplicate.
      const originalHead = await seedLedgerEvent(db);
      const staleRowId = await seedRecoveryStaleLockWithTx(db, originalHead);
      const staleRow = await getAnchorRunById(db, staleRowId);
      const txSignature = staleRow.tx_signature;
      if (!txSignature) {
        throw new Error('Expected stale row to have a tx signature');
      }

      const publishedAtUtc = '2024-04-05T19:34:38Z';
      const existingAnchorEvent = await appendLedgerEvent(db, {
        event_type: 'anchor_published',
        payload: {
          anchor_date: staleRow.anchor_date,
          anchored_head_sequence_no: staleRow.anchored_head_sequence_no,
          anchored_head_hash: staleRow.anchored_head_hash,
          tx_signature: txSignature,
          anchor_wallet_address: staleRow.anchor_wallet_address,
          memo_text: staleRow.memo_text,
          published_at_utc: publishedAtUtc,
          cluster: env.SOLANA_CLUSTER as Cluster,
        },
        created_at_utc: publishedAtUtc,
      });
      if (!existingAnchorEvent.ok) {
        throw new Error(`Expected pre-created anchor event: ${existingAnchorEvent.error.message}`);
      }

      await recoverStaleLock(
        db,
        solana.createConnection(env.HELIUS_RPC_URL),
        staleRow,
        env.SOLANA_CLUSTER as Cluster,
      );

      const staleRowAfterRecovery = await getAnchorRunById(db, staleRowId);
      expect(staleRowAfterRecovery.status).toBe('published');
      expect(staleRowAfterRecovery.locked_until_utc).toBeNull();
      expect(staleRowAfterRecovery.tx_signature).toBe(txSignature);

      const publishedAnchorEvents = await getEventsPaginated(db, {
        eventType: 'anchor_published',
        limit: 10,
      });
      const matchingAnchorEvents = publishedAnchorEvents.items.filter(
        (event) =>
          isAnchorPayload(event.payload) &&
          event.payload.tx_signature === txSignature &&
          event.payload.anchored_head_hash === originalHead.hash,
      );
      expect(matchingAnchorEvents).toHaveLength(1);
      expect(matchingAnchorEvents[0]?.event_hash).toBe(existingAnchorEvent.value.event_hash);
    });

    it('marks stale lock failed when signature status and finalized transaction are both missing', async () => {
      /*
      Scenario: Stale lock has a tx signature but Solana cannot find the tx
        Given a stale sending anchor run has an expired lock and tx_signature
        And Solana signature status lookup returns null
        And Solana finalized getTransaction returns null
        When stale lock recovery runs
        Then the stale run is marked failed with lock_expired_no_tx_found
        And no anchor_published event is appended
      */
      const originalHead = await seedLedgerEvent(db);
      const staleRowId = await seedRecoveryStaleLockWithTx(db, originalHead);
      const staleRow = await getAnchorRunById(db, staleRowId);
      configureSolanaMock({
        getSignatureStatus: { kind: 'null' },
        getTransaction: { kind: 'null' },
      });

      await recoverStaleLock(
        db,
        solana.createConnection(env.HELIUS_RPC_URL),
        staleRow,
        env.SOLANA_CLUSTER as Cluster,
      );

      const staleRowAfterRecovery = await getAnchorRunById(db, staleRowId);
      expect(staleRowAfterRecovery.status).toBe('failed');
      expect(staleRowAfterRecovery.last_error).toBe('lock_expired_no_tx_found');
      expect(staleRowAfterRecovery.locked_until_utc).toBeNull();
      expect(staleRowAfterRecovery.tx_signature).toBe(staleRow.tx_signature);

      const anchorEvents = await getEventsPaginated(db, {
        eventType: 'anchor_published',
        limit: 10,
      });
      expect(anchorEvents.items).toHaveLength(0);
    });

    it('refreshes stale lock and increments attempt_count when tx is not finalized', async () => {
      /*
      Scenario: Stale lock tx exists but is not finalized yet
        Given a stale sending anchor run has an expired lock and tx_signature
        And Solana signature status lookup returns a non-finalized status
        And finalized getTransaction cannot return the transaction yet
        When stale lock recovery runs
        Then the stale run remains sending with a refreshed lock
        And attempt_count is incremented for the retry
        And no anchor_published event is appended
      */
      const originalHead = await seedLedgerEvent(db);
      const staleRowId = await seedRecoveryStaleLockWithTx(db, originalHead);
      const staleRow = await getAnchorRunById(db, staleRowId);
      configureSolanaMock({
        getSignatureStatus: { kind: 'non-finalized', confirmation_status: 'confirmed' },
        getTransaction: { kind: 'null' },
      });

      await recoverStaleLock(
        db,
        solana.createConnection(env.HELIUS_RPC_URL),
        staleRow,
        env.SOLANA_CLUSTER as Cluster,
      );

      const staleRowAfterRecovery = await getAnchorRunById(db, staleRowId);
      expect(staleRowAfterRecovery.status).toBe('sending');
      expect(staleRowAfterRecovery.last_error).toBeNull();
      expect(staleRowAfterRecovery.locked_until_utc).not.toBeNull();
      expect(staleRowAfterRecovery.locked_until_utc).not.toBe(staleRow.locked_until_utc);
      expect(staleRowAfterRecovery.attempt_count).toBe(staleRow.attempt_count + 1);
      expect(staleRowAfterRecovery.tx_signature).toBe(staleRow.tx_signature);

      const anchorEvents = await getEventsPaginated(db, {
        eventType: 'anchor_published',
        limit: 10,
      });
      expect(anchorEvents.items).toHaveLength(0);
    });

    it('propagates append failure without publishing stale row', async () => {
      // Scenario: recovery finds the stale tx on-chain, but ledger backfill
      // rejects the stale row's anchor payload. The row must remain retryable.
      const originalHead = await seedLedgerEvent(db);
      const staleRowId = await seedRecoveryStaleLockWithTx(db, {
        hash: originalHead.hash,
        seq: 0,
      });

      const staleRows = await db
        .select()
        .from(anchorRuns)
        .where(eq(anchorRuns.id, staleRowId))
        .all();
      const staleRow = staleRows[0];
      expect(staleRow).toBeDefined();
      if (!staleRow) {
        throw new Error('Expected stale anchor run row');
      }

      await expect(
        recoverStaleLock(
          db,
          solana.createConnection(env.HELIUS_RPC_URL),
          staleRow,
          env.SOLANA_CLUSTER as Cluster,
        ),
      ).rejects.toThrow('Failed to backfill anchor_published event: Payload validation failed');

      const rowsAfterFailure = await db
        .select()
        .from(anchorRuns)
        .where(eq(anchorRuns.id, staleRowId))
        .all();
      const staleRowAfterFailure = rowsAfterFailure[0];
      expect(staleRowAfterFailure).toBeDefined();
      if (!staleRowAfterFailure) {
        throw new Error('Expected stale anchor run row after failed recovery');
      }

      expect(staleRowAfterFailure.status).toBe('sending');
      expect(staleRowAfterFailure.locked_until_utc).toBe(staleRow.locked_until_utc);
      expect(staleRowAfterFailure.tx_signature).toBe(staleRow.tx_signature);
      expect(staleRowAfterFailure.last_anchor_wallet_sol_lamports).toBeNull();

      const anchorEvents = await getEventsPaginated(db, {
        eventType: 'anchor_published',
        limit: 10,
      });
      expect(
        anchorEvents.items.some(
          (event) =>
            isAnchorPayload(event.payload) &&
            event.payload.anchored_head_hash === originalHead.hash,
        ),
      ).toBe(false);
    });

    it('rejects invalid stale memo without publishing stale row or ledger event', async () => {
      // Scenario: recovery finds the stale tx on-chain, but the persisted memo
      // cannot be parsed as an anchor memo. The row must remain retryable.
      const originalHead = await seedLedgerEvent(db);
      const staleRowId = await seedRecoveryStaleLockWithTx(db, originalHead, 'not-an-anchor-memo');
      const staleRow = await getAnchorRunById(db, staleRowId);

      await expect(
        recoverStaleLock(
          db,
          solana.createConnection(env.HELIUS_RPC_URL),
          staleRow,
          env.SOLANA_CLUSTER as Cluster,
        ),
      ).rejects.toThrow('Failed to backfill anchor_published event: invalid anchor memo');

      const staleRowAfterFailure = await getAnchorRunById(db, staleRowId);
      expect(staleRowAfterFailure.status).toBe('sending');
      expect(staleRowAfterFailure.locked_until_utc).toBe(staleRow.locked_until_utc);
      expect(staleRowAfterFailure.tx_signature).toBe(staleRow.tx_signature);
      expect(staleRowAfterFailure.last_anchor_wallet_sol_lamports).toBeNull();

      const anchorEvents = await getEventsPaginated(db, {
        eventType: 'anchor_published',
        limit: 10,
      });
      expect(
        anchorEvents.items.some(
          (event) =>
            isAnchorPayload(event.payload) &&
            event.payload.anchored_head_hash === originalHead.hash,
        ),
      ).toBe(false);
    });

    it('rejects stale memo hash mismatch without publishing stale row or ledger event', async () => {
      // Scenario: recovery finds the stale tx on-chain and the memo parses,
      // but it points at a different head than the stale row. The row must remain retryable.
      const originalHead = await seedLedgerEvent(db);
      const mismatchedMemoHash =
        originalHead.hash === 'f'.repeat(64) ? 'e'.repeat(64) : 'f'.repeat(64);
      const staleRowId = await seedRecoveryStaleLockWithTx(
        db,
        originalHead,
        `ccv-anchor:${mismatchedMemoHash}`,
      );
      const staleRow = await getAnchorRunById(db, staleRowId);

      await expect(
        recoverStaleLock(
          db,
          solana.createConnection(env.HELIUS_RPC_URL),
          staleRow,
          env.SOLANA_CLUSTER as Cluster,
        ),
      ).rejects.toThrow('Failed to backfill anchor_published event: memo hash mismatch');

      const staleRowAfterFailure = await getAnchorRunById(db, staleRowId);
      expect(staleRowAfterFailure.status).toBe('sending');
      expect(staleRowAfterFailure.locked_until_utc).toBe(staleRow.locked_until_utc);
      expect(staleRowAfterFailure.tx_signature).toBe(staleRow.tx_signature);
      expect(staleRowAfterFailure.last_anchor_wallet_sol_lamports).toBeNull();

      const anchorEvents = await getEventsPaginated(db, {
        eventType: 'anchor_published',
        limit: 10,
      });
      expect(
        anchorEvents.items.some(
          (event) =>
            isAnchorPayload(event.payload) &&
            event.payload.anchored_head_hash === originalHead.hash,
        ),
      ).toBe(false);
    });

    it('rejects finalized transaction without blockTime before publishing stale row', async () => {
      // Scenario: recovery finds the stale tx on-chain, but Solana does not
      // provide a blockTime. The recovered event must not invent a timestamp.
      const originalHead = await seedLedgerEvent(db);
      const staleRowId = await seedRecoveryStaleLockWithTx(db, originalHead);
      const staleRow = await getAnchorRunById(db, staleRowId);
      const txSignature = staleRow.tx_signature;
      if (!txSignature) {
        throw new Error('Expected stale row to have a tx signature');
      }

      vi.spyOn(solana, 'getTransaction').mockResolvedValueOnce(
        ok({
          slot: 1000,
          blockTime: null,
          meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
          transaction: {
            message: { accountKeys: [], recentBlockhash: 'abc', instructions: [] },
            signatures: [txSignature],
          },
        }) as Awaited<ReturnType<typeof solana.getTransaction>>,
      );

      await expect(
        recoverStaleLock(
          db,
          solana.createConnection(env.HELIUS_RPC_URL),
          staleRow,
          env.SOLANA_CLUSTER as Cluster,
        ),
      ).rejects.toThrow('Failed to backfill anchor_published event: missing transaction blockTime');

      const staleRowAfterFailure = await getAnchorRunById(db, staleRowId);
      expect(staleRowAfterFailure.status).toBe('sending');
      expect(staleRowAfterFailure.locked_until_utc).toBe(staleRow.locked_until_utc);
      expect(staleRowAfterFailure.tx_signature).toBe(staleRow.tx_signature);
      expect(staleRowAfterFailure.last_anchor_wallet_sol_lamports).toBeNull();

      const anchorEvents = await getEventsPaginated(db, {
        eventType: 'anchor_published',
        limit: 10,
      });
      expect(
        anchorEvents.items.some(
          (event) =>
            isAnchorPayload(event.payload) &&
            event.payload.anchored_head_hash === originalHead.hash,
        ),
      ).toBe(false);
    });
  });

  describe('stale lock without tx_signature', () => {
    it('marks stale lock as failed with lock_expired_no_tx_found', async () => {
      // Insert a stale lock with no tx_signature
      await seedRecoveryStaleLockNoTx(db);
      // Seed a ledger event so the pipeline has a head to anchor
      await seedLedgerEvent(db);

      // Trigger anchor via manual endpoint
      const response = await SELF.fetch(postManualAnchor());
      expect(response.status).toBe(200);

      // Verify the stale lock was marked as failed
      const failedRows = await db
        .select()
        .from(anchorRuns)
        .where(eq(anchorRuns.status, 'failed'))
        .all();

      const recoveredStale = failedRows.find((r) => r.last_error === 'lock_expired_no_tx_found');
      expect(recoveredStale).toBeDefined();
      expect(recoveredStale!.locked_until_utc).toBeNull();
      expect(recoveredStale!.tx_signature).toBeNull();
      expect(recoveredStale!.anchored_head_hash).toBe(TEST_ALT_ANCHOR_HEAD_HASH);
    });

    it('proceeds to publish new anchor after recovering stale lock', async () => {
      // Insert a stale lock with no tx_signature
      await seedRecoveryStaleLockNoTx(db);
      // Seed a ledger event
      const { hash } = await seedLedgerEvent(db);

      // Trigger anchor
      const response = await SELF.fetch(postManualAnchor());
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
