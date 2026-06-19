import { describe, it, expect } from 'vitest';
import { exports } from 'cloudflare:workers';

describe('503 UNAVAILABLE', () => {
  it('returns the forwardToService 503 response when service binding fetch throws', async () => {
    /*
    Scenario: downstream service binding fetch throws during forwarding
      Given the operator VAULT_API_READ test binding throws for a test request
      When a request is made to GET /api/disbursements?... through the operator Worker
      Then forwardToService catches the failure and returns status 503 with error code UNAVAILABLE.
    */
    const response = await exports.default.fetch(
      'https://example.com/api/disbursements?__operator_test=unavailable',
    );
    expect(response.status).toBe(503);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://staging.open-care.org',
    );
    expect(response.headers.get('Content-Type')).toContain('application/json');
    const json = await response.json<{
      error: { code: string; message: string; request_id?: string };
    }>();
    expect(json.error.code).toBe('UNAVAILABLE');
    expect(json.error.message).toBe('Downstream service unreachable.');
    expect(json.error.request_id).toBeDefined();
    expect(typeof json.error.request_id).toBe('string');
  });
});
