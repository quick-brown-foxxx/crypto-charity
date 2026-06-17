import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
  SELF,
} from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';

const VALID_AUTH_TOKEN = 'test-webhook-secret-token-12345';
const VALID_SIGNATURE = '5xAbC1234mockTestVectorDonationConfirmedExample';

describe('POST /webhook/helius', () => {
  beforeAll(() => {
    // Set the auth secret for testing. The test `env` is mutable.
    env.HELIUS_WEBHOOK_AUTH_HEADER = VALID_AUTH_TOKEN;
    // Set a dummy RPC URL so processInbox doesn't throw on undefined URL.
    // The fetch will fail (no real endpoint), but that's fine — the webhook
    // response is already sent before async processing begins.
    env.HELIUS_RPC_URL = 'http://localhost:1/dummy-rpc';
  });

  // -----------------------------------------------------------------------
  // Helper
  // -----------------------------------------------------------------------

  /**
   * Send a POST request to the webhook endpoint with the given body and
   * optional auth token. Returns the Response after waiting for any
   * ctx.waitUntil() promises to settle.
   */
  async function postWebhook(
    body: unknown,
    authToken?: string,
  ): Promise<Response> {
    const ctx = createExecutionContext();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken !== undefined) {
      headers.Authorization = `Bearer ${authToken}`;
    }
    const request = new Request(
      'https://staging.open-care.org/webhook/helius',
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      },
    );
    const response = await SELF.fetch(request);
    await waitOnExecutionContext(ctx);
    return response;
  }

  // -----------------------------------------------------------------------
  // Auth tests
  // -----------------------------------------------------------------------

  describe('auth', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const response = await postWebhook([], undefined);
      expect(response.status).toBe(401);
      const json = await response.json<{ error: string }>();
      expect(json.error).toBe('missing_authorization_header');
    });

    it('returns 401 when Authorization header does not use Bearer scheme', async () => {
      const ctx = createExecutionContext();
      const request = new Request(
        'https://staging.open-care.org/webhook/helius',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Basic dGVzdDp0ZXN0',
          },
          body: JSON.stringify([]),
        },
      );
      const response = await SELF.fetch(request);
      await waitOnExecutionContext(ctx);
      expect(response.status).toBe(401);
      const json = await response.json<{ error: string }>();
      expect(json.error).toBe('unauthorized');
    });

    it('returns 401 for invalid Bearer token', async () => {
      const response = await postWebhook([], 'wrong-token');
      expect(response.status).toBe(401);
      const json = await response.json<{ error: string }>();
      expect(json.error).toBe('unauthorized');
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
      const request = new Request(
        'https://staging.open-care.org/webhook/helius',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${VALID_AUTH_TOKEN}`,
          },
          body: 'not-json',
        },
      );
      const response = await SELF.fetch(request);
      await waitOnExecutionContext(ctx);
      expect(response.status).toBe(400);
      const json = await response.json<{ error: string }>();
      expect(json.error).toBe('Invalid JSON body');
    });

    it('returns 400 when body is not an array', async () => {
      const response = await postWebhook(
        { not: 'an array' },
        VALID_AUTH_TOKEN,
      );
      expect(response.status).toBe(400);
      const json = await response.json<{ error: string }>();
      expect(json.error).toBe('Body must be a JSON array of webhook events');
    });

    it('returns 400 when array element has no signature', async () => {
      const response = await postWebhook(
        [{ slot: 123 }],
        VALID_AUTH_TOKEN,
      );
      expect(response.status).toBe(400);
      const json = await response.json<{ error: string }>();
      expect(json.error).toBe(
        'Each webhook event must have a string "signature" field',
      );
    });

    it('returns 400 when array element has non-string signature', async () => {
      const response = await postWebhook(
        [{ signature: 12345 }],
        VALID_AUTH_TOKEN,
      );
      expect(response.status).toBe(400);
      const json = await response.json<{ error: string }>();
      expect(json.error).toBe(
        'Each webhook event must have a string "signature" field',
      );
    });

    it('returns 400 when array element is null', async () => {
      const response = await postWebhook([null], VALID_AUTH_TOKEN);
      expect(response.status).toBe(400);
      const json = await response.json<{ error: string }>();
      expect(json.error).toBe(
        'Each webhook event must have a string "signature" field',
      );
    });
  });

  // -----------------------------------------------------------------------
  // Valid webhook tests
  // -----------------------------------------------------------------------

  describe('valid webhook events', () => {
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
      const result = await env.vault_db
        .prepare('SELECT signature, source, status FROM helius_inbox WHERE signature = ?')
        .bind(sig)
        .all<{ signature: string; source: string; status: string }>();

      expect(result.results).toHaveLength(1);
      expect(result.results[0].signature).toBe(sig);
      expect(result.results[0].source).toBe('webhook');
      // Status may be 'failed' after processInbox runs (RPC is unreachable),
      // but the row must exist.
      expect(result.results[0].status).toBeOneOf([
        'received',
        'processing',
        'failed',
      ]);
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
      const result = await env.vault_db
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
});
