import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createVaultDb, vaultSchema } from '@open-care/vault-db';
import type { Env } from '../src/lib/env.js';
import worker from '../src/index.js';

// ---------------------------------------------------------------------------
// Mock helpers (same pattern as reconciliation.test.ts)
// ---------------------------------------------------------------------------

/**
 * Create a mock `fetch` that returns a `getSignaturesForAddress` JSON-RPC
 * response containing the given list of successful (err=null) signatures.
 */
function createMockFetch(
  signatures: string[],
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
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
    return Promise.resolve(
      new Response(JSON.stringify({ jsonrpc: '2.0', result, id: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scheduled handler', () => {
  let db: ReturnType<typeof createVaultDb>;

  beforeAll(() => {
    db = createVaultDb(env.vault_db);
    // HELIUS_RPC_URL is a secret in production; set a mock value for tests.
    (env as unknown as Env).HELIUS_RPC_URL = 'https://mock-rpc.example.com';
  });

  beforeEach(async () => {
    // Clean state: delete all rows from both tables before each test.
    await db.delete(vaultSchema.heliusInbox);
    await db.delete(vaultSchema.ledgerEvents);
  });

  it('triggers reconciliation and processes results without crashing on empty state', async () => {
    // Save and mock globalThis.fetch so the scheduled handler's internal
    // reconcileMissedSignatures call gets a controlled RPC response.
    const originalFetch = globalThis.fetch;
    const mockFetch = createMockFetch([]);
    globalThis.fetch = mockFetch;

    try {
      // Minimal ScheduledEvent shape — only the fields the handler might touch.
      const mockEvent = {
        scheduledTime: Date.now(),
        cron: '0 */6 * * *',
        type: 'scheduled',
      } as ScheduledEvent;

      // Mock ExecutionContext: capture the promise passed to waitUntil.
      const mockCtx = {
        waitUntil: vi.fn(),
      } as unknown as ExecutionContext;

      // Invoke the scheduled handler. It should:
      // 1. Call reconcileMissedSignatures (gets empty list → inserted=0, skipped=0)
      // 2. Call ctx.waitUntil(processInbox(...)) to schedule inbox processing
      await worker.scheduled(mockEvent, env as Env, mockCtx);

      // If we reached here without throwing, the handler completed successfully.
      // Verify waitUntil was called (inbox processing was scheduled).
      // eslint-disable-next-line @typescript-eslint/unbound-method -- standard vitest spy assertion
      expect(mockCtx.waitUntil).toHaveBeenCalledTimes(1);

      // With an empty RPC response and clean DB, no inbox rows should have
      // been created.
      const inboxRows = await db.select().from(vaultSchema.heliusInbox);
      expect(inboxRows.length).toBe(0);
    } finally {
      // Always restore the original fetch.
      globalThis.fetch = originalFetch;
    }
  });
});
