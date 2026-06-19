import { env, SELF } from 'cloudflare:test';
import { createVaultDb } from '@open-care/vault-db';
import { describe, it, expect, beforeEach } from 'vitest';
import { postManualAnchor } from './helpers.js';
import { cleanTables, seedActiveLock, seedLedgerEvent } from './seed.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/anchor/manual', () => {
  let db: ReturnType<typeof createVaultDb>;

  beforeEach(async () => {
    await cleanTables();
    db = createVaultDb(env.vault_db);
  });

  describe('valid trigger', () => {
    it('returns published with all expected fields', async () => {
      const { hash } = await seedLedgerEvent(db);

      const response = await SELF.fetch(postManualAnchor());
      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        status: string;
        anchored_head_hash: string;
        memo_text: string;
        tx_signature: string;
        duration_ms: number;
        anchor_runs_id: number;
      };

      expect(body.status).toBe('published');
      expect(body.anchored_head_hash).toBe(hash);
      expect(body.memo_text).toMatch(/^ccv-anchor:[0-9a-f]{64}$/);
      expect(body.tx_signature).toBeDefined();
      expect(body.tx_signature.length).toBeGreaterThan(0);
      expect(body.duration_ms).toBeGreaterThan(0);
      expect(body.anchor_runs_id).toBeGreaterThan(0);
    });

    it('returns empty_ledger when no events exist', async () => {
      const response = await SELF.fetch(postManualAnchor());
      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        status: string;
        duration_ms: number;
      };
      expect(body.status).toBe('empty_ledger');
      expect(body.duration_ms).toBeGreaterThan(0);
    });
  });

  describe('conflict response', () => {
    it('returns 409 with ANCHOR_RUN_IN_PROGRESS error code', async () => {
      await seedActiveLock(db);

      const response = await SELF.fetch(postManualAnchor());
      expect(response.status).toBe(409);

      const body = (await response.json()) as {
        error: { code: string; message: string; request_id?: string };
      };
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('ANCHOR_RUN_IN_PROGRESS');
      expect(body.error.message).toBe('Another anchor run is in progress');
      expect(body.error.request_id).toBeDefined();
      expect(typeof body.error.request_id).toBe('string');
    });

    it('returns correct Content-Type for error responses', async () => {
      await seedActiveLock(db);

      const response = await SELF.fetch(postManualAnchor());
      expect(response.status).toBe(409);
      expect(response.headers.get('Content-Type')).toContain('application/json');
    });
  });

  describe('response shape consistency', () => {
    it('published response has all required top-level fields', async () => {
      await seedLedgerEvent(db);

      const response = await SELF.fetch(postManualAnchor());
      expect(response.status).toBe(200);

      const body = (await response.json()) as Record<string, unknown>;
      // Required fields for published status
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('anchored_head_hash');
      expect(body).toHaveProperty('memo_text');
      expect(body).toHaveProperty('tx_signature');
      expect(body).toHaveProperty('duration_ms');
      expect(body).toHaveProperty('anchor_runs_id');
      // Should NOT have error field
      expect(body).not.toHaveProperty('error');
    });

    it('empty_ledger response has status and duration_ms', async () => {
      const response = await SELF.fetch(postManualAnchor());
      expect(response.status).toBe(200);

      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('duration_ms');
      expect(body).not.toHaveProperty('error');
    });

    it('conflict response has error object with code and message', async () => {
      await seedActiveLock(db);

      const response = await SELF.fetch(postManualAnchor());
      expect(response.status).toBe(409);

      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('error');
      const err = body.error as Record<string, unknown>;
      expect(err).toHaveProperty('code');
      expect(err).toHaveProperty('message');
      expect(typeof err.code).toBe('string');
      expect(typeof err.message).toBe('string');
    });
  });
});
