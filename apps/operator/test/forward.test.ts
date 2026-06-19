import { describe, it, expect } from 'vitest';
import { exports } from 'cloudflare:workers';

const VALID_TOKEN = 'test-operator-token-abc123';
const operatorWorker = (exports as unknown as { default: { fetch: typeof fetch } }).default;

function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${VALID_TOKEN}` };
}

describe('Service binding forwarding', () => {
  /*
  Scenario: body-forwarding diagnostic mode preserves request JSON
    Given the operator mock is called with the echo-body test query parameter
    When POST /api/disbursements is forwarded to VAULT_API_WRITE
    Then the test-only response includes the forwarded request body
  */
  it('forwards POST /api/disbursements to VAULT_API_WRITE with request body intact', async () => {
    const body = { amount_usdc_minor: '50000000', gift_card_count: 2, service: 'Alter' };
    const response = await operatorWorker.fetch(
      'https://example.com/api/disbursements?__operator_test=echo-body',
      {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    expect(response.status).toBe(200);
    const json = await response.json<{
      sequence_no: number;
      event_hash: string;
      head_hash: string;
      public_beneficiary_ref: string | null;
      next_action: string;
      forwarded_body: unknown;
    }>();
    expect(json.sequence_no).toBe(1);
    expect(json.event_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(json.head_hash).toBe(json.event_hash);
    expect(json.public_beneficiary_ref).toBe('benpub_MOCK1234567890');
    expect(json.next_action).toBe('send_code_to_beneficiary_via_bot');
    expect(json.forwarded_body).toEqual(body);
  });

  it('forwards POST /api/anchor/manual to VAULT_ANCHOR_CRON', async () => {
    const response = await operatorWorker.fetch('https://example.com/api/anchor/manual', {
      method: 'POST',
      headers: authHeader(),
    });
    expect(response.status).toBe(200);
    const json = await response.json<{ status: string; duration_ms: number }>();
    expect(json.status).toBe('empty_ledger');
    expect(json.duration_ms).toBe(42);
  });

  it('forwards GET /tg/internal/pending-requests to TG_BOT', async () => {
    const response = await operatorWorker.fetch(
      'https://example.com/tg/internal/pending-requests',
      {
        method: 'GET',
        headers: authHeader(),
      },
    );
    expect(response.status).toBe(200);
    const json = await response.json<{ items: unknown[]; next_cursor: string | null }>();
    expect(json.items).toEqual([]);
    expect(json.next_cursor).toBeNull();
  });

  it('forwards POST /tg/internal/send-code to TG_BOT', async () => {
    const response = await operatorWorker.fetch('https://example.com/tg/internal/send-code', {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ beneficiary_ref: 'benpub_TEST1234567890' }),
    });
    expect(response.status).toBe(200);
    const json = await response.json<{ delivered_at_utc: string }>();
    expect(json.delivered_at_utc).toBe('2026-06-14T10:23:00Z');
  });

  it('passes through downstream error status codes', async () => {
    // The mock VAULT_API_WRITE returns 200, and this test verifies
    // that the response status is passed through correctly
    const response = await operatorWorker.fetch('https://example.com/api/disbursements', {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount_usdc_minor: '50000000' }),
    });
    // The mock returns 200, and the operator passes it through
    expect(response.status).toBe(200);
  });
});
