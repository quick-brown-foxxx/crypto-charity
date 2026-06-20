import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker from '../src/index.js';
import type { Env as IngestEnv } from '../src/lib/env.js';

const VALID_AUTH_TOKEN = 'test-webhook-secret-token-12345';
const VALID_SIGNATURE = '5xAbC1234mockTestVectorDonationConfirmedExample';
const ACK_FAST_SIGNATURE = 'ackfast111111111111111111111111111111111111111';
const ACK_FAST_TIMEOUT_MS = 1_000;

describe('POST /webhook/helius', () => {
  beforeAll(() => {
    const ingestEnv = env as unknown as IngestEnv;
    // Set the auth secret for testing. The test `env` is mutable.
    ingestEnv.HELIUS_WEBHOOK_AUTH_HEADER = VALID_AUTH_TOKEN;
    // Set a dummy RPC URL so processInbox doesn't throw on undefined URL.
    // The fetch will fail (no real endpoint), but that's fine — the webhook
    // response is already sent before async processing begins.
    ingestEnv.HELIUS_RPC_URL = 'http://localhost:1/dummy-rpc';
  });

  // -----------------------------------------------------------------------
  // Helper
  // -----------------------------------------------------------------------

  /**
   * Send a POST request to the webhook endpoint with the given body and
   * optional auth token. Returns the Response after waiting for any
   * ctx.waitUntil() promises to settle.
   */
  async function postWebhook(body: unknown, authToken?: string): Promise<Response> {
    const ingestEnv = env as unknown as IngestEnv;
    const ctx = createExecutionContext();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken !== undefined) {
      headers.Authorization = `Bearer ${authToken}`;
    }
    const request = new Request('https://staging.open-care.org/webhook/helius', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const response = await worker.fetch(request, ingestEnv, ctx);
    await waitOnExecutionContext(ctx);
    return response;
  }

  function validTransferRpcResponse(signature: string): unknown {
    const ingestEnv = env as unknown as IngestEnv;

    return {
      jsonrpc: '2.0',
      result: {
        slot: 123456789,
        blockTime: 1718400000,
        transaction: {
          message: {
            accountKeys: [
              'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              ingestEnv.VAULT_USDC_ATA,
              'DonorWalletBase58address111111111111111111111',
            ],
            instructions: [
              {
                programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                parsed: {
                  type: 'transferChecked',
                  info: {
                    source: 'SourceATAbase58address11111111111111111111111',
                    destination: ingestEnv.VAULT_USDC_ATA,
                    authority: 'DonorWalletBase58address111111111111111111111',
                    amount: '100000000',
                    mint: ingestEnv.USDC_MINT,
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

  function createDeferredRpcFetch(responseBody: unknown): {
    fetch: typeof fetch;
    release: () => void;
    requestStarted: Promise<void>;
  } {
    let resolveGate: (() => void) | undefined;
    let resolveRequestStarted: (() => void) | undefined;
    let released = false;
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    const requestStarted = new Promise<void>((resolve) => {
      resolveRequestStarted = resolve;
    });

    return {
      fetch: async () => {
        resolveRequestStarted?.();
        await gate;
        return new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
      release: () => {
        if (released) return;
        released = true;
        resolveGate?.();
      },
      requestStarted,
    };
  }

  async function waitForPromiseOrTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T | 'timed_out'> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<'timed_out'>((resolve) => {
      timeoutId = setTimeout(() => resolve('timed_out'), timeoutMs);
    });

    const result = await Promise.race([promise, timeoutPromise]);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    return result;
  }

  // -----------------------------------------------------------------------
  // Auth tests
  // -----------------------------------------------------------------------

  describe('auth', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const response = await postWebhook([], undefined);
      expect(response.status).toBe(401);
      const json = await response.json<{
        error: { code: string; message: string; request_id: string };
      }>();
      expect(json.error.code).toBe('UNAUTHORIZED');
      expect(json.error.message).toBe('Missing Authorization header');
      expect(json.error.request_id).toBeDefined();
      expect(typeof json.error.request_id).toBe('string');
      expect(json.error.request_id).toMatch(/^req_[a-f0-9]{8}$/);
    });

    it('returns 401 when Authorization header does not use Bearer scheme', async () => {
      const ctx = createExecutionContext();
      const ingestEnv = env as unknown as IngestEnv;
      const request = new Request('https://staging.open-care.org/webhook/helius', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Basic dGVzdDp0ZXN0',
        },
        body: JSON.stringify([]),
      });
      const response = await worker.fetch(request, ingestEnv, ctx);
      await waitOnExecutionContext(ctx);
      expect(response.status).toBe(401);
      const json = await response.json<{
        error: { code: string; message: string; request_id: string };
      }>();
      expect(json.error.code).toBe('UNAUTHORIZED');
      expect(json.error.message).toBe('Authorization header must use Bearer scheme');
      expect(json.error.request_id).toBeDefined();
      expect(typeof json.error.request_id).toBe('string');
      expect(json.error.request_id).toMatch(/^req_[a-f0-9]{8}$/);
    });

    it('returns 401 for invalid Bearer token', async () => {
      const response = await postWebhook([], 'wrong-token');
      expect(response.status).toBe(401);
      const json = await response.json<{
        error: { code: string; message: string; request_id: string };
      }>();
      expect(json.error.code).toBe('UNAUTHORIZED');
      expect(json.error.message).toBe('Invalid authorization token');
      expect(json.error.request_id).toBeDefined();
      expect(typeof json.error.request_id).toBe('string');
      expect(json.error.request_id).toMatch(/^req_[a-f0-9]{8}$/);
    });

    it('returns 200 for valid Authorization token with empty body', async () => {
      const response = await postWebhook([], VALID_AUTH_TOKEN);
      expect(response.status).toBe(200);
      const json = await response.json<{
        accepted: number;
        duplicates: number;
      }>();
      expect(json.accepted).toBe(0);
      expect(json.duplicates).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Payload validation tests
  // -----------------------------------------------------------------------

  describe('payload validation', () => {
    it('returns 400 for invalid JSON body', async () => {
      const ctx = createExecutionContext();
      const ingestEnv = env as unknown as IngestEnv;
      const request = new Request('https://staging.open-care.org/webhook/helius', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${VALID_AUTH_TOKEN}`,
        },
        body: 'not-json',
      });
      const response = await worker.fetch(request, ingestEnv, ctx);
      await waitOnExecutionContext(ctx);
      expect(response.status).toBe(400);
      const json = await response.json<{
        error: { code: string; message: string; request_id: string };
      }>();
      expect(json.error.code).toBe('BAD_REQUEST');
      expect(json.error.message).toBe('Invalid JSON body');
      expect(json.error.request_id).toBeDefined();
      expect(typeof json.error.request_id).toBe('string');
      expect(json.error.request_id).toMatch(/^req_[a-f0-9]{8}$/);
    });

    it('returns 400 when body is not an array', async () => {
      const response = await postWebhook({ not: 'an array' }, VALID_AUTH_TOKEN);
      expect(response.status).toBe(400);
      const json = await response.json<{
        error: { code: string; message: string; request_id: string };
      }>();
      expect(json.error.code).toBe('BAD_REQUEST');
      expect(json.error.message).toMatch(/^Invalid webhook payload:/);
      expect(json.error.request_id).toBeDefined();
      expect(typeof json.error.request_id).toBe('string');
      expect(json.error.request_id).toMatch(/^req_[a-f0-9]{8}$/);
    });

    it('returns 400 when array element has no signature', async () => {
      const response = await postWebhook([{ slot: 123 }], VALID_AUTH_TOKEN);
      expect(response.status).toBe(400);
      const json = await response.json<{
        error: { code: string; message: string; request_id: string };
      }>();
      expect(json.error.code).toBe('BAD_REQUEST');
      expect(json.error.message).toMatch(/^Invalid webhook payload:.*signature/);
      expect(json.error.request_id).toBeDefined();
      expect(typeof json.error.request_id).toBe('string');
      expect(json.error.request_id).toMatch(/^req_[a-f0-9]{8}$/);
    });

    it('returns 400 when array element has non-string signature', async () => {
      const response = await postWebhook([{ signature: 12345 }], VALID_AUTH_TOKEN);
      expect(response.status).toBe(400);
      const json = await response.json<{
        error: { code: string; message: string; request_id: string };
      }>();
      expect(json.error.code).toBe('BAD_REQUEST');
      expect(json.error.message).toMatch(/^Invalid webhook payload:.*signature/);
      expect(json.error.request_id).toBeDefined();
      expect(typeof json.error.request_id).toBe('string');
      expect(json.error.request_id).toMatch(/^req_[a-f0-9]{8}$/);
    });

    it('returns 400 when array element is null', async () => {
      const response = await postWebhook([null], VALID_AUTH_TOKEN);
      expect(response.status).toBe(400);
      const json = await response.json<{
        error: { code: string; message: string; request_id: string };
      }>();
      expect(json.error.code).toBe('BAD_REQUEST');
      expect(json.error.message).toMatch(/^Invalid webhook payload:/);
      expect(json.error.request_id).toBeDefined();
      expect(typeof json.error.request_id).toBe('string');
      expect(json.error.request_id).toMatch(/^req_[a-f0-9]{8}$/);
    });
  });

  // -----------------------------------------------------------------------
  // Valid webhook tests
  // -----------------------------------------------------------------------

  describe('valid webhook events', () => {
    /*
    Scenario: Webhook acknowledges before asynchronous processing completes
      Given a valid authenticated Helius webhook request whose async processing is deliberately delayed
      When the webhook is invoked
      Then the HTTP response is 200 within about one second
      And async side effects are not required before the response is observed
      And after waiting for the execution context, the donation ledger side effect is persisted
    */
    it('returns 200 quickly before delayed waitUntil processing completes', async () => {
      const ingestEnv = env as unknown as IngestEnv;
      await ingestEnv.vault_db.prepare('DELETE FROM helius_inbox').run();

      const originalFetch = globalThis.fetch;
      const delayedRpc = createDeferredRpcFetch(validTransferRpcResponse(ACK_FAST_SIGNATURE));
      globalThis.fetch = delayedRpc.fetch;

      const ctx = createExecutionContext();
      const request = new Request('https://staging.open-care.org/webhook/helius', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${VALID_AUTH_TOKEN}`,
        },
        body: JSON.stringify([
          {
            signature: ACK_FAST_SIGNATURE,
            slot: 123456789,
            timestamp: 1718400000,
            tokenTransfers: [],
          },
        ]),
      });

      try {
        const startedAtMs = performance.now();
        const responsePromise = Promise.resolve(worker.fetch(request, ingestEnv, ctx));
        const response = await waitForPromiseOrTimeout(responsePromise, ACK_FAST_TIMEOUT_MS);
        const elapsedMs = performance.now() - startedAtMs;

        expect(response).not.toBe('timed_out');
        expect(elapsedMs).toBeLessThan(ACK_FAST_TIMEOUT_MS);

        const webhookResponse = response as Response;
        expect(webhookResponse.status).toBe(200);
        await expect(webhookResponse.json()).resolves.toEqual({ accepted: 1, duplicates: 0 });

        const rpcRequestStarted = await waitForPromiseOrTimeout(
          delayedRpc.requestStarted,
          ACK_FAST_TIMEOUT_MS,
        );
        expect(
          rpcRequestStarted,
          `Timed out after ${ACK_FAST_TIMEOUT_MS}ms waiting for delayed RPC request to start`,
        ).not.toBe('timed_out');

        const ledgerRowsBeforeWait = await ingestEnv.vault_db
          .prepare(
            `SELECT COUNT(*) AS cnt
             FROM ledger_events
             WHERE event_type = 'donation_confirmed'
               AND json_extract(payload_json, '$.tx_signature') = ?`,
          )
          .bind(ACK_FAST_SIGNATURE)
          .first<{ cnt: number }>();

        expect(ledgerRowsBeforeWait?.cnt).toBe(0);

        delayedRpc.release();
        await waitOnExecutionContext(ctx);

        const ledgerRowsAfterWait = await ingestEnv.vault_db
          .prepare(
            `SELECT COUNT(*) AS cnt
             FROM ledger_events
             WHERE event_type = 'donation_confirmed'
               AND json_extract(payload_json, '$.tx_signature') = ?`,
          )
          .bind(ACK_FAST_SIGNATURE)
          .first<{ cnt: number }>();

        expect(ledgerRowsAfterWait?.cnt).toBe(1);

        const inboxRow = await ingestEnv.vault_db
          .prepare('SELECT status FROM helius_inbox WHERE signature = ? AND source = ?')
          .bind(ACK_FAST_SIGNATURE, 'webhook')
          .first<{ status: string }>();

        expect(inboxRow?.status).toBe('processed');
      } finally {
        delayedRpc.release();
        globalThis.fetch = originalFetch;
      }
    });

    it('accepts a single valid webhook event', async () => {
      const response = await postWebhook(
        [
          {
            signature: VALID_SIGNATURE,
            slot: 123456789,
            timestamp: 1718400000,
            tokenTransfers: [],
          },
        ],
        VALID_AUTH_TOKEN,
      );
      expect(response.status).toBe(200);
      const json = await response.json<{
        accepted: number;
        duplicates: number;
      }>();
      expect(json.accepted).toBe(1);
      expect(json.duplicates).toBe(0);
    });

    it('accepts multiple valid webhook events', async () => {
      const response = await postWebhook(
        [
          { signature: 'sig-aaa-111', slot: 1, timestamp: 1, tokenTransfers: [] },
          { signature: 'sig-bbb-222', slot: 2, timestamp: 2, tokenTransfers: [] },
          { signature: 'sig-ccc-333', slot: 3, timestamp: 3, tokenTransfers: [] },
        ],
        VALID_AUTH_TOKEN,
      );
      expect(response.status).toBe(200);
      const json = await response.json<{
        accepted: number;
        duplicates: number;
      }>();
      expect(json.accepted).toBe(3);
      expect(json.duplicates).toBe(0);
    });

    it('inserts rows into helius_inbox with source=webhook', async () => {
      const sig = 'sig-inbox-verify-001';
      await postWebhook(
        [{ signature: sig, slot: 1, timestamp: 1, tokenTransfers: [] }],
        VALID_AUTH_TOKEN,
      );

      // Query the inbox directly via D1 to verify the row was inserted.
      const result = await (env as unknown as IngestEnv).vault_db
        .prepare('SELECT signature, source, status FROM helius_inbox WHERE signature = ?')
        .bind(sig)
        .all<{ signature: string; source: string; status: string }>();

      expect(result.results).toHaveLength(1);
      const inboxRow = result.results[0];
      expect(inboxRow).toBeDefined();
      expect(inboxRow!.signature).toBe(sig);
      expect(inboxRow!.source).toBe('webhook');
      // Status may be 'failed' after processInbox runs (RPC is unreachable),
      // but the row must exist.
      expect(inboxRow!.status).toBeOneOf(['received', 'processing', 'failed']);
    });
  });

  // -----------------------------------------------------------------------
  // Duplicate tests
  // -----------------------------------------------------------------------

  describe('duplicate handling', () => {
    it('counts duplicate signatures correctly', async () => {
      const sig = 'sig-dup-test-999';

      // First request — should be accepted
      const r1 = await postWebhook(
        [{ signature: sig, slot: 1, timestamp: 1, tokenTransfers: [] }],
        VALID_AUTH_TOKEN,
      );
      expect(r1.status).toBe(200);
      const j1 = await r1.json<{ accepted: number; duplicates: number }>();
      expect(j1.accepted).toBe(1);
      expect(j1.duplicates).toBe(0);

      // Second request with same signature — should be a duplicate
      const r2 = await postWebhook(
        [{ signature: sig, slot: 2, timestamp: 2, tokenTransfers: [] }],
        VALID_AUTH_TOKEN,
      );
      expect(r2.status).toBe(200);
      const j2 = await r2.json<{ accepted: number; duplicates: number }>();
      expect(j2.accepted).toBe(0);
      expect(j2.duplicates).toBe(1);
    });

    it('has exactly one inbox row for a duplicate signature', async () => {
      const sig = 'sig-dup-row-count-888';

      // Send twice
      await postWebhook(
        [{ signature: sig, slot: 1, timestamp: 1, tokenTransfers: [] }],
        VALID_AUTH_TOKEN,
      );
      await postWebhook(
        [{ signature: sig, slot: 2, timestamp: 2, tokenTransfers: [] }],
        VALID_AUTH_TOKEN,
      );

      // Verify exactly one row exists (composite PK prevents duplicates)
      const result = await (env as unknown as IngestEnv).vault_db
        .prepare('SELECT COUNT(*) as cnt FROM helius_inbox WHERE signature = ?')
        .bind(sig)
        .first<{ cnt: number }>();

      expect(result).not.toBeNull();
      expect(result!.cnt).toBe(1);
    });

    it('handles mixed new and duplicate events in one request', async () => {
      const newSig = 'sig-mixed-new-777';
      const dupSig = 'sig-mixed-dup-666';

      // Seed the duplicate signature first
      await postWebhook(
        [{ signature: dupSig, slot: 1, timestamp: 1, tokenTransfers: [] }],
        VALID_AUTH_TOKEN,
      );

      // Send a batch with one new and one duplicate
      const response = await postWebhook(
        [
          { signature: newSig, slot: 2, timestamp: 2, tokenTransfers: [] },
          { signature: dupSig, slot: 3, timestamp: 3, tokenTransfers: [] },
        ],
        VALID_AUTH_TOKEN,
      );
      expect(response.status).toBe(200);
      const json = await response.json<{
        accepted: number;
        duplicates: number;
      }>();
      expect(json.accepted).toBe(1);
      expect(json.duplicates).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Error shape compliance
  // -----------------------------------------------------------------------

  describe('error shape compliance', () => {
    it('returns standard { error: { code, message, request_id } } shape for 401', async () => {
      const response = await postWebhook([], undefined);
      expect(response.status).toBe(401);
      const json = await response.json<Record<string, unknown>>();
      // Top-level shape
      expect(json).toHaveProperty('error');
      expect(typeof json.error).toBe('object');
      expect(json.error).not.toBeNull();
      const err = json.error as Record<string, unknown>;
      expect(err).toHaveProperty('code');
      expect(err).toHaveProperty('message');
      expect(err).toHaveProperty('request_id');
      expect(typeof err.code).toBe('string');
      expect(typeof err.message).toBe('string');
      expect(typeof err.request_id).toBe('string');
      expect(err.request_id).toMatch(/^req_[a-f0-9]{8}$/);
      // No flat string error
      expect(typeof json.error).not.toBe('string');
    });

    it('returns standard { error: { code, message, request_id } } shape for 400', async () => {
      const response = await postWebhook({ not: 'an array' }, VALID_AUTH_TOKEN);
      expect(response.status).toBe(400);
      const json = await response.json<Record<string, unknown>>();
      expect(json).toHaveProperty('error');
      expect(typeof json.error).toBe('object');
      expect(json.error).not.toBeNull();
      const err = json.error as Record<string, unknown>;
      expect(err).toHaveProperty('code');
      expect(err).toHaveProperty('message');
      expect(err).toHaveProperty('request_id');
      expect(typeof err.code).toBe('string');
      expect(typeof err.message).toBe('string');
      expect(typeof err.request_id).toBe('string');
      expect(err.request_id).toMatch(/^req_[a-f0-9]{8}$/);
      expect(typeof json.error).not.toBe('string');
    });
  });
});
