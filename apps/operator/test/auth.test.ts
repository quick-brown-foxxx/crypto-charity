import { describe, it, expect } from 'vitest';
import { exports } from 'cloudflare:workers';

const VALID_TOKEN = 'test-operator-token-abc123'; // Must match vitest.config.ts

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

describe('Auth middleware', () => {
  // Use /api/disbursements as a representative auth-protected route

  it('returns 401 when Authorization header is missing', async () => {
    const response = await exports.default.fetch('https://example.com/api/disbursements', {
      method: 'POST',
      body: '{}',
    });
    expect(response.status).toBe(401);
    const json = await response.json<{
      error: { code: string; message: string; request_id?: string };
    }>();
    expect(json.error.code).toBe('UNAUTHORIZED');
    expect(json.error.message).toContain('Missing');
    expect(json.error.request_id).toBeDefined();
    expect(typeof json.error.request_id).toBe('string');
  });

  it('returns 400 when Authorization header does not use Bearer scheme', async () => {
    const response = await exports.default.fetch('https://example.com/api/disbursements', {
      method: 'POST',
      headers: { Authorization: 'Basic dGVzdDp0ZXN0' },
      body: '{}',
    });
    expect(response.status).toBe(400);
    const json = await response.json<{
      error: { code: string; message: string; request_id?: string };
    }>();
    expect(json.error.code).toBe('BAD_REQUEST');
    expect(json.error.message).toContain('Bearer');
    expect(json.error.request_id).toBeDefined();
    expect(typeof json.error.request_id).toBe('string');
  });

  it('returns 401 when token is invalid', async () => {
    const response = await exports.default.fetch('https://example.com/api/disbursements', {
      method: 'POST',
      headers: authHeader('wrong-token'),
      body: '{}',
    });
    expect(response.status).toBe(401);
    const json = await response.json<{
      error: { code: string; message: string; request_id?: string };
    }>();
    expect(json.error.code).toBe('UNAUTHORIZED');
    expect(json.error.message).toContain('Invalid');
    expect(json.error.request_id).toBeDefined();
    expect(typeof json.error.request_id).toBe('string');
  });

  it('returns 400 when token is empty (Bearer with no token)', async () => {
    // HTTP header values get whitespace-trimmed, so "Bearer " becomes "Bearer"
    // which fails the startsWith('Bearer ') check → 400 BAD_REQUEST
    const response = await exports.default.fetch('https://example.com/api/disbursements', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' },
      body: '{}',
    });
    expect(response.status).toBe(400);
    const json = await response.json<{
      error: { code: string; message: string; request_id?: string };
    }>();
    expect(json.error.code).toBe('BAD_REQUEST');
    expect(json.error.request_id).toBeDefined();
    expect(typeof json.error.request_id).toBe('string');
  });

  it('allows request with valid token (returns downstream response)', async () => {
    const response = await exports.default.fetch('https://example.com/api/disbursements', {
      method: 'POST',
      headers: {
        ...authHeader(VALID_TOKEN),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount_usdc_minor: '50000000' }),
    });
    expect(response.status).toBe(200);
    const json = await response.json<{ sequence_no: number }>();
    expect(json.sequence_no).toBe(1);
  });

  it('applies auth to /api/anchor/manual', async () => {
    const response = await exports.default.fetch('https://example.com/api/anchor/manual', {
      method: 'POST',
      headers: authHeader(VALID_TOKEN),
    });
    expect(response.status).toBe(200);
    const json = await response.json<{ status: string }>();
    expect(json.status).toBe('empty_ledger');
  });

  it('applies auth to /tg/internal/pending-requests', async () => {
    const response = await exports.default.fetch(
      'https://example.com/tg/internal/pending-requests',
      {
        method: 'GET',
        headers: authHeader(VALID_TOKEN),
      },
    );
    expect(response.status).toBe(200);
    const json = await response.json<{ items: unknown[]; next_cursor: string | null }>();
    expect(json.items).toEqual([]);
    expect(json.next_cursor).toBeNull();
  });

  it('applies auth to /tg/internal/send-code', async () => {
    const response = await exports.default.fetch('https://example.com/tg/internal/send-code', {
      method: 'POST',
      headers: authHeader(VALID_TOKEN),
      body: JSON.stringify({ beneficiary_ref: 'benpub_TEST1234567890' }),
    });
    expect(response.status).toBe(200);
    const json = await response.json<{ delivered_at_utc: string }>();
    expect(json.delivered_at_utc).toBe('2026-06-14T10:23:00Z');
  });
});
