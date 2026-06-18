import { describe, it, expect } from 'vitest';
import { exports } from 'cloudflare:workers';

const VALID_TOKEN = 'test-operator-token-abc123';

function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${VALID_TOKEN}` };
}

describe('429 RATE_LIMITED', () => {
  // The rate limiter is per-IP, 10 requests per 60 seconds.
  // Each test uses a unique IP to avoid cross-test contamination
  // (the rate limiter state persists within the same isolate).

  it('allows a single request through', async () => {
    const ip = { 'CF-Connecting-IP': '192.0.2.1' };
    const response = await exports.default.fetch('https://example.com/api/disbursements', {
      method: 'POST',
      headers: { ...authHeader(), ...ip, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount_usdc_minor: '50000000' }),
    });
    expect(response.status).toBe(201);
  });

  it('allows 10 requests (at the limit)', async () => {
    const ip = { 'CF-Connecting-IP': '192.0.2.2' };
    // Send 10 requests rapidly — all should pass
    for (let i = 0; i < 10; i++) {
      const response = await exports.default.fetch('https://example.com/api/disbursements', {
        method: 'POST',
        headers: { ...authHeader(), ...ip, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_usdc_minor: '50000000' }),
      });
      expect(response.status).toBe(201);
    }
  });

  it('returns 429 on the 11th request', async () => {
    const ip = { 'CF-Connecting-IP': '192.0.2.3' };

    // First 10 requests (warm up the counter)
    for (let i = 0; i < 10; i++) {
      await exports.default.fetch('https://example.com/api/disbursements', {
        method: 'POST',
        headers: { ...authHeader(), ...ip, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_usdc_minor: '50000000' }),
      });
    }

    // 11th request should be rate-limited
    const response = await exports.default.fetch('https://example.com/api/disbursements', {
      method: 'POST',
      headers: { ...authHeader(), ...ip, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount_usdc_minor: '50000000' }),
    });
    expect(response.status).toBe(429);
    const json = await response.json<{ error: { code: string; message: string; request_id?: string } }>();
    expect(json.error.code).toBe('RATE_LIMITED');
    expect(json.error.message).toContain('Too many requests');
    expect(json.error.request_id).toBeDefined();
    expect(typeof json.error.request_id).toBe('string');
  });

  it('includes Retry-After header on 429 response', async () => {
    const ip = { 'CF-Connecting-IP': '192.0.2.4' };

    // Warm up to 10
    for (let i = 0; i < 10; i++) {
      await exports.default.fetch('https://example.com/api/disbursements', {
        method: 'POST',
        headers: { ...authHeader(), ...ip, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_usdc_minor: '50000000' }),
      });
    }

    const response = await exports.default.fetch('https://example.com/api/disbursements', {
      method: 'POST',
      headers: { ...authHeader(), ...ip, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount_usdc_minor: '50000000' }),
    });
    expect(response.status).toBe(429);
    const retryAfter = response.headers.get('Retry-After');
    expect(retryAfter).toBeTruthy();
    // Retry-After should be a positive integer (seconds)
    const seconds = parseInt(retryAfter, 10);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(60);
  });

  it('different IPs have separate rate limits', async () => {
    const ipA = { 'CF-Connecting-IP': '192.0.2.10' };
    const ipB = { 'CF-Connecting-IP': '192.0.2.20' };

    // Exhaust IP A's limit
    for (let i = 0; i < 10; i++) {
      await exports.default.fetch('https://example.com/api/disbursements', {
        method: 'POST',
        headers: { ...authHeader(), ...ipA, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_usdc_minor: '50000000' }),
      });
    }

    // IP A's 11th request should be rate-limited
    const responseA = await exports.default.fetch('https://example.com/api/disbursements', {
      method: 'POST',
      headers: { ...authHeader(), ...ipA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount_usdc_minor: '50000000' }),
    });
    expect(responseA.status).toBe(429);

    // IP B's first request should still pass
    const responseB = await exports.default.fetch('https://example.com/api/disbursements', {
      method: 'POST',
      headers: { ...authHeader(), ...ipB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount_usdc_minor: '50000000' }),
    });
    expect(responseB.status).toBe(201);
  });

  it('rate limits apply to /api/corrections', async () => {
    const ip = { 'CF-Connecting-IP': '192.0.2.30' };

    for (let i = 0; i < 10; i++) {
      await exports.default.fetch('https://example.com/api/corrections', {
        method: 'POST',
        headers: { ...authHeader(), ...ip, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          corrects_sequence_no: 1,
          reason: 'Fix receipt ref',
          replacement_fields: { receipt_ref: 'NEW-REF-001' },
          recorded_at_utc: '2026-06-14T10:30:00Z',
          recorded_by: 'test-operator',
        }),
      });
    }

    const response = await exports.default.fetch('https://example.com/api/corrections', {
      method: 'POST',
      headers: { ...authHeader(), ...ip, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        corrects_sequence_no: 1,
        reason: 'Fix receipt ref',
        replacement_fields: { receipt_ref: 'NEW-REF-001' },
        recorded_at_utc: '2026-06-14T10:30:00Z',
        recorded_by: 'test-operator',
      }),
    });
    expect(response.status).toBe(429);
  });

  it('rate limits apply to /api/anchor/manual', async () => {
    const ip = { 'CF-Connecting-IP': '192.0.2.40' };

    for (let i = 0; i < 10; i++) {
      await exports.default.fetch('https://example.com/api/anchor/manual', {
        method: 'POST',
        headers: { ...authHeader(), ...ip },
      });
    }

    const response = await exports.default.fetch('https://example.com/api/anchor/manual', {
      method: 'POST',
      headers: { ...authHeader(), ...ip },
    });
    expect(response.status).toBe(429);
  });

  it('rate limiter does not apply to public GET routes', async () => {
    const ip = { 'CF-Connecting-IP': '192.0.2.50' };

    // Send many requests to a public route — all should pass
    for (let i = 0; i < 15; i++) {
      const response = await exports.default.fetch('https://example.com/api/disbursements', {
        method: 'GET',
        headers: { ...ip },
      });
      expect(response.status).toBe(200);
    }
  });
});
