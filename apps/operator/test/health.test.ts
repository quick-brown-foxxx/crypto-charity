import { describe, it, expect } from 'vitest';
import { exports } from 'cloudflare:workers';

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const response = await exports.default.fetch('https://example.com/health');
    expect(response.status).toBe(200);
    const json = await response.json<{ status: string }>();
    expect(json.status).toBe('ok');
  });

  it('does not require auth', async () => {
    // No Authorization header
    const response = await exports.default.fetch('https://example.com/health');
    expect(response.status).toBe(200);
  });

  it('returns JSON content type', async () => {
    const response = await exports.default.fetch('https://example.com/health');
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });
});
