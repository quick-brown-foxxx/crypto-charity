import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createVaultDb, vaultSchema } from '@open-care/vault-db';
import { eq } from 'drizzle-orm';
import { utcNow } from '@open-care/vault-core';
import { insertIntoInbox, processInbox, checkDuplicateDonation } from '../src/lib/inbox.js';
import type { Env } from '../src/lib/env.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock fetch that returns a canned JSON-RPC response. */
function createMockFetch(
  responseBody: unknown,
  status = 200,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return (input, init) => {
    void input;
    void init;
    return Promise.resolve(
      new Response(JSON.stringify(responseBody), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  };
}

/**
 * Build a valid Solana JSON-RPC `getTransaction` response containing a
 * `transferChecked` instruction that sends USDC to the vault ATA.
 *
 * Defaults for mint and destination come from the wrangler vars exposed
 * on the test `env` object.
 */
function validTransferResponse(
  signature: string,
  overrides?: Partial<{
    slot: number;
    blockTime: number;
    amount: string;
    destination: string;
    mint: string;
  }>,
) {
  return {
    jsonrpc: '2.0',
    result: {
      slot: overrides?.slot ?? 123456789,
      blockTime: overrides?.blockTime ?? 1718400000,
      transaction: {
        message: {
          accountKeys: [
            'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            overrides?.destination ?? env.VAULT_USDC_ATA,
            'DonorWalletBase58address111111111111111111111',
          ],
          instructions: [
            {
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              parsed: {
                type: 'transferChecked',
                info: {
                  source: 'SourceATAbase58address11111111111111111111111',
                  destination: overrides?.destination ?? env.VAULT_USDC_ATA,
                  authority: 'DonorWalletBase58address111111111111111111111',
                  amount: overrides?.amount ?? '100000000',
                  mint: overrides?.mint ?? env.USDC_MINT,
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
// Signatures (≥32 chars to pass DonationPayloadSchema Zod validation)
// ---------------------------------------------------------------------------

const SIG_VALID = 'txn11111111111111111111111111111111111111111111';
const SIG_NO_MATCH = 'txn22222222222222222222222222222222222222222222';
const SIG_DUP = 'txn33333333333333333333333333333333333333333333';
const SIG_RPC_FAIL = 'txn44444444444444444444444444444444444444444444';
const SIG_MAX_RETRY = 'txn55555555555555555555555555555555555555555555';
const SIG_CHECK_DUP = 'txn66666666666666666666666666666666666666666666';
const SIG_NULL_RESULT = 'txn77777777777777777777777777777777777777777777';
const SIG_NETWORK_ERROR = 'txn88888888888888888888888888888888888888888888';
const SIG_MALFORMED = 'txn99999999999999999999999999999999999999999999';

// Shorter signatures for insertIntoInbox-only tests (no Zod validation there)
const SIG_INSERT_1 = 'test-sig-001';
const SIG_INSERT_2 = 'test-sig-002';
const SIG_INSERT_3 = 'test-sig-003';
const SIG_INSERT_4 = 'test-sig-004';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('inbox operations', () => {
  let db: ReturnType<typeof createVaultDb>;

  beforeAll(() => {
    db = createVaultDb(env.vault_db);
    // Secrets required by the Env type — set dummies since we use a mock fetch.
    env.HELIUS_RPC_URL = 'https://mock-rpc.example.com';
    env.HELIUS_WEBHOOK_AUTH_HEADER = 'test-auth-header';
  });

  beforeEach(async () => {
    // Clean slate: delete all rows from both tables before each test.
    // Drizzle's delete() without .where() deletes all rows.
    await db.delete(vaultSchema.ledgerEvents);
    await db.delete(vaultSchema.heliusInbox);
  });

  // ------------------------------------------------------------------
  // insertIntoInbox
  // ------------------------------------------------------------------

  describe('insertIntoInbox', () => {
    it('inserts a new entry', async () => {
      const result = await insertIntoInbox(db, [
        {
          signature: SIG_INSERT_1,
          source: 'webhook',
          rawPayloadJson: JSON.stringify({ test: true }),
          receivedAtUtc: utcNow(),
        },
      ]);
      expect(result.accepted).toBe(1);
      expect(result.duplicates).toBe(0);
    });

    it('rejects duplicate (signature, source) pair', async () => {
      const entry = {
        signature: SIG_INSERT_2,
        source: 'webhook' as const,
        rawPayloadJson: JSON.stringify({ test: true }),
        receivedAtUtc: utcNow(),
      };
      const r1 = await insertIntoInbox(db, [entry]);
      expect(r1.accepted).toBe(1);

      const r2 = await insertIntoInbox(db, [entry]);
      expect(r2.accepted).toBe(0);
      expect(r2.duplicates).toBe(1);
    });

    it('allows same signature with different source', async () => {
      const sig = SIG_INSERT_3;
      const r1 = await insertIntoInbox(db, [
        {
          signature: sig,
          source: 'webhook',
          rawPayloadJson: '{}',
          receivedAtUtc: utcNow(),
        },
      ]);
      expect(r1.accepted).toBe(1);

      const r2 = await insertIntoInbox(db, [
        {
          signature: sig,
          source: 'reconciliation',
          rawPayloadJson: '{}',
          receivedAtUtc: utcNow(),
        },
      ]);
      expect(r2.accepted).toBe(1);
    });

    it('handles multiple entries with mixed new/duplicate', async () => {
      const sig = SIG_INSERT_4;
      // Pre-insert one
      await insertIntoInbox(db, [
        {
          signature: sig,
          source: 'webhook',
          rawPayloadJson: '{}',
          receivedAtUtc: utcNow(),
        },
      ]);

      // Now insert 3: one duplicate, two new
      const result = await insertIntoInbox(db, [
        {
          signature: sig,
          source: 'webhook',
          rawPayloadJson: '{}',
          receivedAtUtc: utcNow(),
        },
        {
          signature: 'new-1',
          source: 'webhook',
          rawPayloadJson: '{}',
          receivedAtUtc: utcNow(),
        },
        {
          signature: 'new-2',
          source: 'webhook',
          rawPayloadJson: '{}',
          receivedAtUtc: utcNow(),
        },
      ]);
      expect(result.accepted).toBe(2);
      expect(result.duplicates).toBe(1);
    });
  });

  // ------------------------------------------------------------------
  // processInbox
  // ------------------------------------------------------------------

  describe('processInbox', () => {
    it('processes a valid transfer to processed status', async () => {
      await insertIntoInbox(db, [
        {
          signature: SIG_VALID,
          source: 'webhook',
          rawPayloadJson: JSON.stringify({ signature: SIG_VALID }),
          receivedAtUtc: utcNow(),
        },
      ]);

      const mockFetch = createMockFetch(validTransferResponse(SIG_VALID));
      const result = await processInbox(db, env as Env, mockFetch);

      expect(result.processed).toBe(1);
      expect(result.ignored).toBe(0);
      expect(result.failed).toBe(0);

      // Verify inbox status
      const rows = await db
        .select()
        .from(vaultSchema.heliusInbox)
        .where(eq(vaultSchema.heliusInbox.signature, SIG_VALID));
      expect(rows[0]?.status).toBe('processed');

      // Verify ledger event
      const ledgerRows = await db
        .select()
        .from(vaultSchema.ledgerEvents)
        .where(eq(vaultSchema.ledgerEvents.event_type, 'donation_confirmed'));
      expect(ledgerRows.length).toBe(1);

      const payload = JSON.parse(ledgerRows[0]!.payload_json) as Record<string, unknown>;
      expect(payload.tx_signature).toBe(SIG_VALID);
      expect(payload.amount_usdc_minor).toBe('100000000');
      expect(payload.slot).toBe(123456789);
    });

    it('marks ignored when no matching transfer found', async () => {
      await insertIntoInbox(db, [
        {
          signature: SIG_NO_MATCH,
          source: 'webhook',
          rawPayloadJson: JSON.stringify({ signature: SIG_NO_MATCH }),
          receivedAtUtc: utcNow(),
        },
      ]);

      // Mock response with a SOL transfer only (System Program), no SPL Token
      // instructions → parseSplTransfer returns err.
      const noTransferResponse = {
        jsonrpc: '2.0',
        result: {
          slot: 123,
          blockTime: 1718400000,
          transaction: {
            message: {
              accountKeys: ['11111111111111111111111111111111'],
              instructions: [
                {
                  programId: '11111111111111111111111111111111',
                  parsed: {
                    type: 'transfer',
                    info: {
                      source: 'a',
                      destination: 'b',
                      authority: 'a',
                      amount: '1000',
                      lamports: 1000,
                    },
                  },
                },
              ],
            },
            signatures: [SIG_NO_MATCH],
          },
          meta: { err: null, innerInstructions: [] },
        },
        id: 1,
      };

      const mockFetch = createMockFetch(noTransferResponse);
      const result = await processInbox(db, env as Env, mockFetch);

      expect(result.ignored).toBe(1);
      expect(result.processed).toBe(0);

      const rows = await db
        .select()
        .from(vaultSchema.heliusInbox)
        .where(eq(vaultSchema.heliusInbox.signature, SIG_NO_MATCH));
      expect(rows[0]?.status).toBe('ignored');
      expect(rows[0]?.reason).toBe('no_matching_transfer');
    });

    it('marks duplicate when signature already in ledger', async () => {
      // First: process a valid transfer → creates ledger event
      await insertIntoInbox(db, [
        {
          signature: SIG_DUP,
          source: 'webhook',
          rawPayloadJson: JSON.stringify({ signature: SIG_DUP }),
          receivedAtUtc: utcNow(),
        },
      ]);
      const mockFetch1 = createMockFetch(validTransferResponse(SIG_DUP));
      await processInbox(db, env as Env, mockFetch1);

      // Second: insert same signature with a different source so the
      // composite PK (signature, source) doesn't collide with the first row.
      await insertIntoInbox(db, [
        {
          signature: SIG_DUP,
          source: 'reconciliation',
          rawPayloadJson: JSON.stringify({ signature: SIG_DUP }),
          receivedAtUtc: utcNow(),
        },
      ]);
      const mockFetch2 = createMockFetch(validTransferResponse(SIG_DUP, { slot: 999 }));
      await processInbox(db, env as Env, mockFetch2);

      // Find the duplicate row
      const rows = await db
        .select()
        .from(vaultSchema.heliusInbox)
        .where(eq(vaultSchema.heliusInbox.signature, SIG_DUP));
      const dupRow = rows.find((r) => r.status === 'duplicate');
      expect(dupRow).toBeDefined();

      // Only one ledger event (the first one)
      const ledgerRows = await db
        .select()
        .from(vaultSchema.ledgerEvents)
        .where(eq(vaultSchema.ledgerEvents.event_type, 'donation_confirmed'));
      expect(ledgerRows.length).toBe(1);
    });

    it('handles RPC failure with retry (stays received)', async () => {
      await insertIntoInbox(db, [
        {
          signature: SIG_RPC_FAIL,
          source: 'webhook',
          rawPayloadJson: JSON.stringify({ signature: SIG_RPC_FAIL }),
          receivedAtUtc: utcNow(),
        },
      ]);

      // Mock fetch returns HTTP 429 (rate limited, retryable)
      const mockFetch = createMockFetch({ error: 'rate limited' }, 429);
      const result = await processInbox(db, env as Env, mockFetch);

      // Not failed yet — still retryable
      expect(result.failed).toBe(0);

      const rows = await db
        .select()
        .from(vaultSchema.heliusInbox)
        .where(eq(vaultSchema.heliusInbox.signature, SIG_RPC_FAIL));
      expect(rows[0]?.status).toBe('received');
      expect(rows[0]?.attempt_count).toBeGreaterThan(0);
      expect(rows[0]?.last_error).toBeTruthy();
    });

    it('marks failed after max retries', async () => {
      await insertIntoInbox(db, [
        {
          signature: SIG_MAX_RETRY,
          source: 'webhook',
          rawPayloadJson: JSON.stringify({ signature: SIG_MAX_RETRY }),
          receivedAtUtc: utcNow(),
        },
      ]);

      // Pre-set attempt_count to 9 so the next attempt hits the limit
      await db
        .update(vaultSchema.heliusInbox)
        .set({ attempt_count: 9 })
        .where(eq(vaultSchema.heliusInbox.signature, SIG_MAX_RETRY));

      // Mock fetch returns HTTP 500 (server error, retryable but attempts exhausted)
      const mockFetch = createMockFetch({ error: 'server error' }, 500);
      await processInbox(db, env as Env, mockFetch);

      const rows = await db
        .select()
        .from(vaultSchema.heliusInbox)
        .where(eq(vaultSchema.heliusInbox.signature, SIG_MAX_RETRY));
      expect(rows[0]?.status).toBe('failed');
    });

    it('handles null result as NOT_FINALIZED (stays received)', async () => {
      await insertIntoInbox(db, [
        {
          signature: SIG_NULL_RESULT,
          source: 'webhook',
          rawPayloadJson: JSON.stringify({ signature: SIG_NULL_RESULT }),
          receivedAtUtc: utcNow(),
        },
      ]);

      // Mock fetch returns a valid JSON-RPC envelope with result: null.
      // fetchTransaction treats null result as NOT_FINALIZED (retryable).
      const mockFetch = createMockFetch({
        jsonrpc: '2.0',
        result: null,
        id: 1,
      });
      const result = await processInbox(db, env as Env, mockFetch);

      // NOT_FINALIZED is retryable — entry stays received, not failed
      expect(result.failed).toBe(0);
      expect(result.processed).toBe(0);
      expect(result.ignored).toBe(0);

      const rows = await db
        .select()
        .from(vaultSchema.heliusInbox)
        .where(eq(vaultSchema.heliusInbox.signature, SIG_NULL_RESULT));
      expect(rows[0]?.status).toBe('received');
      expect(rows[0]?.attempt_count).toBeGreaterThan(0);
      expect(rows[0]?.last_error).toBeTruthy();
    });

    it('handles network error gracefully (stays received)', async () => {
      await insertIntoInbox(db, [
        {
          signature: SIG_NETWORK_ERROR,
          source: 'webhook',
          rawPayloadJson: JSON.stringify({ signature: SIG_NETWORK_ERROR }),
          receivedAtUtc: utcNow(),
        },
      ]);

      // Mock fetch that rejects with a network error.
      // fetchTransaction catches this and returns NETWORK_ERROR (retryable).
      const mockFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        void input;
        void init;
        return Promise.reject(new Error('Network failure'));
      };
      const result = await processInbox(db, env as Env, mockFetch);

      // NETWORK_ERROR is retryable — entry stays received, not failed
      expect(result.failed).toBe(0);
      expect(result.processed).toBe(0);
      expect(result.ignored).toBe(0);

      const rows = await db
        .select()
        .from(vaultSchema.heliusInbox)
        .where(eq(vaultSchema.heliusInbox.signature, SIG_NETWORK_ERROR));
      expect(rows[0]?.status).toBe('received');
      expect(rows[0]?.attempt_count).toBeGreaterThan(0);
      expect(rows[0]?.last_error).toBeTruthy();
    });

    it('handles malformed JSON response as PARSE_ERROR (marks failed)', async () => {
      await insertIntoInbox(db, [
        {
          signature: SIG_MALFORMED,
          source: 'webhook',
          rawPayloadJson: JSON.stringify({ signature: SIG_MALFORMED }),
          receivedAtUtc: utcNow(),
        },
      ]);

      // Mock fetch returns non-JSON content.
      // fetchTransaction catches JSON parse failure → PARSE_ERROR (non-retryable).
      const mockFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        void input;
        void init;
        return Promise.resolve(
          new Response('not json', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          }),
        );
      };
      const result = await processInbox(db, env as Env, mockFetch);

      // PARSE_ERROR is non-retryable — entry is marked failed
      expect(result.failed).toBe(1);
      expect(result.processed).toBe(0);
      expect(result.ignored).toBe(0);

      const rows = await db
        .select()
        .from(vaultSchema.heliusInbox)
        .where(eq(vaultSchema.heliusInbox.signature, SIG_MALFORMED));
      expect(rows[0]?.status).toBe('failed');
      expect(rows[0]?.reason).toBeTruthy();
    });
  });

  // ------------------------------------------------------------------
  // checkDuplicateDonation
  // ------------------------------------------------------------------

  describe('checkDuplicateDonation', () => {
    it('returns false for unknown signature', async () => {
      const result = await checkDuplicateDonation(db, 'unknown-sig');
      expect(result).toBe(false);
    });

    it('returns true after donation is appended to ledger', async () => {
      // Insert and process a valid transfer → creates ledger event
      await insertIntoInbox(db, [
        {
          signature: SIG_CHECK_DUP,
          source: 'webhook',
          rawPayloadJson: JSON.stringify({ signature: SIG_CHECK_DUP }),
          receivedAtUtc: utcNow(),
        },
      ]);
      const mockFetch = createMockFetch(validTransferResponse(SIG_CHECK_DUP));
      await processInbox(db, env as Env, mockFetch);

      const result = await checkDuplicateDonation(db, SIG_CHECK_DUP);
      expect(result).toBe(true);
    });
  });
});
