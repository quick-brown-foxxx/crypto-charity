import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createVaultDb } from '@open-care/vault-db';
import { vaultSchema } from '@open-care/vault-db';
import { eq, sql } from 'drizzle-orm';
import { reconcileMissedSignatures } from '../src/lib/reconciliation.js';
import { insertIntoInbox, processInbox, nowIso } from '../src/lib/inbox.js';
import type { Env } from '../src/lib/env.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock `fetch` that returns a `getSignaturesForAddress` JSON-RPC
 * response containing the given list of successful (err=null) signatures.
 */
function createMockFetch(signatures: string[]): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return (input, init) => {
    void input;
    void init;
    const result = signatures.map((sig) => ({
      signature: sig,
      slot: 123,
      err: null,
      blockTime: 1718400000,
      confirmationStatus: 'finalized',
    }));
    return Promise.resolve(new Response(
      JSON.stringify({ jsonrpc: '2.0', result, id: 1 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
  };
}

/**
 * Create a mock `fetch` that returns a fixed JSON-RPC response body with the
 * given HTTP status code.
 */
function createRpcMockFetch(
  response: unknown,
  status = 200,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return (input, init) => {
    void input;
    void init;
    return Promise.resolve(new Response(JSON.stringify(response), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }));
  };
}

/**
 * Build a valid `getTransaction` JSON-RPC response for a successful
 * `transferChecked` SPL USDC transfer to the vault ATA.
 *
 * Uses the vault ATA and USDC mint from the test environment (injected from
 * `wrangler.jsonc` vars by the Cloudflare Vitest pool).
 */
function validTransferResponse(signature: string) {
  return {
    jsonrpc: '2.0',
    result: {
      slot: 123456789,
      blockTime: 1718400000,
      transaction: {
        message: {
          accountKeys: [
            'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            env.VAULT_USDC_ATA,
            'DonorBase58Address11111111111111111111111',
          ],
          instructions: [
            {
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              parsed: {
                type: 'transferChecked',
                info: {
                  source: 'SourceATA111111111111111111111111111111111',
                  destination: env.VAULT_USDC_ATA,
                  authority: 'DonorBase58Address11111111111111111111111',
                  amount: '50000000',
                  mint: env.USDC_MINT,
                  decimals: 6,
                },
              },
            },
          ],
        },
        signatures: [signature],
      },
      meta: { err: null, innerInstructions: [] },
    },
    id: 1,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reconciliation', () => {
  let db: ReturnType<typeof createVaultDb>;

  beforeAll(() => {
    db = createVaultDb(env.vault_db);
    // HELIUS_RPC_URL is a secret in production; set a mock value for tests.
    env.HELIUS_RPC_URL = 'https://mock-rpc.example.com';
  });

  beforeEach(async () => {
    // Clean state: delete all rows from both tables before each test.
    await db.delete(vaultSchema.heliusInbox);
    await db.delete(vaultSchema.ledgerEvents);
  });

  // -----------------------------------------------------------------------
  // Test 1: Basic reconciliation — all signatures are new
  // -----------------------------------------------------------------------

  it('inserts all signatures when none exist in system', async () => {
    const sigs = [
      'rec-sig-aaa11111111111111111111111111111111',
      'rec-sig-bbb11111111111111111111111111111111',
      'rec-sig-ccc11111111111111111111111111111111',
    ];
    const mockFetch = createMockFetch(sigs);
    const result = await reconcileMissedSignatures(
      db,
      env as Env,
      mockFetch,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.inserted).toBe(3);
      expect(result.value.skipped).toBe(0);
    }

    // Verify each signature was inserted with source='reconciliation'
    for (const sig of sigs) {
      const rows = await db
        .select()
        .from(vaultSchema.heliusInbox)
        .where(eq(vaultSchema.heliusInbox.signature, sig));
      expect(rows.length).toBe(1);
      expect(rows[0]?.source).toBe('reconciliation');
      expect(rows[0]?.status).toBe('received');
    }
  });

  // -----------------------------------------------------------------------
  // Test 2: Skip signatures already in helius_inbox
  // -----------------------------------------------------------------------

  it('skips signatures already in helius_inbox', async () => {
    const existingSig = 'rec-existing-inbox11111111111111111111111';
    const newSig = 'rec-new-sig111111111111111111111111111111111';

    // Pre-insert one signature into inbox (source='webhook')
    await insertIntoInbox(db, [
      {
        signature: existingSig,
        source: 'webhook',
        rawPayloadJson: '{}',
        receivedAtUtc: nowIso(),
      },
    ]);

    const mockFetch = createMockFetch([existingSig, newSig]);
    const result = await reconcileMissedSignatures(
      db,
      env as Env,
      mockFetch,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.inserted).toBe(1);
      expect(result.value.skipped).toBe(1);
    }

    // New signature should be in inbox with source='reconciliation'
    const newRows = await db
      .select()
      .from(vaultSchema.heliusInbox)
      .where(eq(vaultSchema.heliusInbox.signature, newSig));
    expect(newRows.length).toBe(1);
    expect(newRows[0]?.source).toBe('reconciliation');
  });

  // -----------------------------------------------------------------------
  // Test 3: Skip signatures already in ledger_events (not in inbox)
  // -----------------------------------------------------------------------

  it('skips signatures already in ledger_events (not in inbox)', async () => {
    const ledgerSig = 'rec-existing-ledger11111111111111111111111';
    const newSig = 'rec-new-sig-2111111111111111111111111111111';

    // Pre-seed a donation in the ledger by processing through the inbox
    // pipeline with a mock RPC that returns a valid SPL transfer.
    await insertIntoInbox(db, [
      {
        signature: ledgerSig,
        source: 'webhook',
        rawPayloadJson: JSON.stringify({ signature: ledgerSig }),
        receivedAtUtc: nowIso(),
      },
    ]);
    const rpcMock = createRpcMockFetch(validTransferResponse(ledgerSig));
    await processInbox(db, env as Env, rpcMock);

    // Remove the inbox row so reconciliation tests the ledger-only path.
    // (reconcileMissedSignatures checks inbox first; if the row remained
    // it would be skipped by the inbox check, not the ledger check.)
    await db.run(
      sql`DELETE FROM helius_inbox WHERE signature = ${ledgerSig}`,
    );

    const mockFetch = createMockFetch([ledgerSig, newSig]);
    const result = await reconcileMissedSignatures(
      db,
      env as Env,
      mockFetch,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.inserted).toBe(1);
      expect(result.value.skipped).toBe(1);
    }
  });

  // -----------------------------------------------------------------------
  // Test 4: Skip signatures in both inbox and ledger
  // -----------------------------------------------------------------------

  it('skips signatures in both inbox and ledger', async () => {
    const inboxSig = 'rec-inbox-only111111111111111111111111111111';
    const ledgerSig = 'rec-ledger-only11111111111111111111111111111';
    const newSig = 'rec-new-sig-311111111111111111111111111111111';

    // Pre-insert one signature into inbox only
    await insertIntoInbox(db, [
      {
        signature: inboxSig,
        source: 'webhook',
        rawPayloadJson: '{}',
        receivedAtUtc: nowIso(),
      },
    ]);

    // Pre-seed another signature into the ledger (via inbox → process)
    await insertIntoInbox(db, [
      {
        signature: ledgerSig,
        source: 'webhook',
        rawPayloadJson: JSON.stringify({ signature: ledgerSig }),
        receivedAtUtc: nowIso(),
      },
    ]);
    const rpcMock = createRpcMockFetch(validTransferResponse(ledgerSig));
    await processInbox(db, env as Env, rpcMock);
    // Remove inbox row so ledgerSig is only in the ledger
    await db.run(
      sql`DELETE FROM helius_inbox WHERE signature = ${ledgerSig}`,
    );

    const mockFetch = createMockFetch([inboxSig, ledgerSig, newSig]);
    const result = await reconcileMissedSignatures(
      db,
      env as Env,
      mockFetch,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.inserted).toBe(1);
      expect(result.value.skipped).toBe(2);
    }
  });

  // -----------------------------------------------------------------------
  // Test 5: Empty signature list
  // -----------------------------------------------------------------------

  it('handles empty signature list', async () => {
    const mockFetch = createMockFetch([]);
    const result = await reconcileMissedSignatures(
      db,
      env as Env,
      mockFetch,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.inserted).toBe(0);
      expect(result.value.skipped).toBe(0);
    }
  });

  // -----------------------------------------------------------------------
  // Test 6: RPC failure
  // -----------------------------------------------------------------------

  it('returns error on RPC failure', async () => {
    const mockFetch = createRpcMockFetch(
      { error: 'internal error' },
      500,
    );
    const result = await reconcileMissedSignatures(
      db,
      env as Env,
      mockFetch,
    );

    expect(result.ok).toBe(false);
  });
});
