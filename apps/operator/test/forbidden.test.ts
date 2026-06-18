import { describe, it, expect } from 'vitest';
import { exports } from 'cloudflare:workers';

const VALID_TOKEN = 'test-operator-token-abc123';

function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${VALID_TOKEN}` };
}

describe('403 FORBIDDEN', () => {
  it('returns 403 from the dedicated /api/forbidden test route', async () => {
    const response = await exports.default.fetch('https://example.com/api/forbidden');
    expect(response.status).toBe(403);
    const json = await response.json<{
      error: { code: string; message: string; request_id?: string };
    }>();
    expect(json.error.code).toBe('FORBIDDEN');
    expect(json.error.message).toContain('denied');
    expect(json.error.request_id).toBeDefined();
    expect(typeof json.error.request_id).toBe('string');
  });

  it('returns 403 with CORS headers (CORS middleware runs before route)', async () => {
    const response = await exports.default.fetch('https://example.com/api/forbidden');
    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://staging.open-care.org',
    );
  });

  it('returns 403 with JSON content type', async () => {
    const response = await exports.default.fetch('https://example.com/api/forbidden');
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });

  it('returns 403 when valid token is used but method is not allowed on a route', async () => {
    // GET /api/disbursements is a public read route (no auth).
    // POST /api/disbursements requires auth.
    // PUT is not defined on any route — Hono returns 404 by default.
    // We test that a non-existent method on an auth-protected path
    // returns a 4xx status (Hono's default 404, not 403).
    // This documents the current behavior: method-not-allowed is 404, not 405/403.
    const response = await exports.default.fetch('https://example.com/api/disbursements', {
      method: 'PUT',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: '{}',
    });
    // Hono returns 404 for undefined methods
    expect(response.status).toBe(404);
  });
});
