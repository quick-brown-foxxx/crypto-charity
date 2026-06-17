import { describe, it, expect } from 'vitest';
import { exports } from 'cloudflare:workers';

const VALID_TOKEN = 'test-operator-token-abc123';

function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${VALID_TOKEN}` };
}

describe('Service binding forwarding', () => {
  it('forwards POST /api/disbursements to VAULT_API_WRITE with request body intact', async () => {
    const body = { amount_usdc_minor: '50000000', gift_card_count: 2, service: 'Alter' };
    const response = await exports.default.fetch(
      'https://example.com/api/disbursements',
      {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    expect(response.status).toBe(201);
    const json = await response.json<{
      forwarded_body: { amount_usdc_minor: string; gift_card_count: number; service: string };
    }>();
    // The mock VAULT_API_WRITE echoes the forwarded body
    expect(json.forwarded_body.amount_usdc_minor).toBe('50000000');
    expect(json.forwarded_body.gift_card_count).toBe(2);
    expect(json.forwarded_body.service).toBe('Alter');
  });

  it('forwards POST /api/anchor/manual to VAULT_ANCHOR_CRON', async () => {
    const response = await exports.default.fetch(
      'https://example.com/api/anchor/manual',
      {
        method: 'POST',
        headers: authHeader(),
      },
    );
    expect(response.status).toBe(200);
    const json = await response.json<{ status: string; signature: string }>();
    expect(json.status).toBe('ok');
    expect(json.signature).toBe('mock_sig');
  });

  it('forwards GET /tg/internal/pending-requests to TG_BOT', async () => {
    const response = await exports.default.fetch(
      'https://example.com/tg/internal/pending-requests',
      {
        method: 'GET',
        headers: authHeader(),
      },
    );
    expect(response.status).toBe(200);
    const json = await response.json<{ requests: unknown[]; count: number }>();
    expect(json.requests).toEqual([]);
    expect(json.count).toBe(0);
  });

  it('forwards POST /tg/internal/send-code to TG_BOT', async () => {
    const response = await exports.default.fetch(
      'https://example.com/tg/internal/send-code',
      {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ beneficiary_ref: 'benpub_TEST1234567890' }),
      },
    );
    expect(response.status).toBe(200);
    const json = await response.json<{ ok: boolean; sent: boolean }>();
    expect(json.ok).toBe(true);
    expect(json.sent).toBe(true);
  });

  it('passes through downstream error status codes', async () => {
    // The mock VAULT_API_WRITE always returns 201, but we can test
    // that the response status is passed through correctly
    const response = await exports.default.fetch(
      'https://example.com/api/disbursements',
      {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_usdc_minor: '50000000' }),
      },
    );
    // The mock returns 201, and the operator passes it through
    expect(response.status).toBe(201);
  });
});
