import { describe, it, expect } from 'vitest';
import { exports } from 'cloudflare:workers';

const VALID_TOKEN = 'test-operator-token-abc123';
const SITE_URL = 'https://staging.open-care.org'; // From wrangler.jsonc vars

function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${VALID_TOKEN}` };
}

describe('CORS middleware', () => {
  it('returns CORS headers on successful responses', async () => {
    const response = await exports.default.fetch(
      'https://example.com/api/disbursements',
      {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_usdc_minor: '50000000' }),
      },
    );
    expect(response.status).toBe(201);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(SITE_URL);
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('returns CORS headers on error responses (401)', async () => {
    const response = await exports.default.fetch(
      'https://example.com/api/disbursements',
      { method: 'POST', body: '{}' },
    );
    expect(response.status).toBe(401);
    // CORS middleware runs before auth, so error responses should still have CORS headers
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(SITE_URL);
  });

  it('handles OPTIONS preflight with 204 and CORS headers', async () => {
    const response = await exports.default.fetch(
      'https://example.com/api/disbursements',
      {
        method: 'OPTIONS',
        headers: {
          Origin: SITE_URL,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Authorization, Content-Type',
        },
      },
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(SITE_URL);
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    expect(response.headers.get('Access-Control-Max-Age')).toBe('86400');
  });

  it('returns CORS headers on health endpoint', async () => {
    const response = await exports.default.fetch('https://example.com/health');
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(SITE_URL);
  });

  it('OPTIONS preflight does not require auth', async () => {
    // OPTIONS should be handled by CORS middleware before auth middleware runs
    const response = await exports.default.fetch(
      'https://example.com/api/disbursements',
      { method: 'OPTIONS' },
    );
    expect(response.status).toBe(204);
    // No 401 — CORS middleware short-circuits before auth
  });
});
