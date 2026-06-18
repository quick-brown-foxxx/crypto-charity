import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createVaultDb, getEventsPaginated } from '@open-care/vault-db';
import { verifyChain } from '@open-care/vault-core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validBody(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    amount_usdc_minor: '50000000',
    gift_card_count: 2,
    service: 'Alter',
    service_note: null,
    receipt_ref: 'ALTER-2026-06-14-A1B2C3',
    purchased_at_utc: '2026-06-14T10:23:00Z',
    ...overrides,
  };
}

function post(body: unknown, contentType = 'application/json'): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': contentType };
  const bodyStr = contentType === 'application/json' ? JSON.stringify(body) : String(body);
  return SELF.fetch('https://example.com/api/disbursements', {
    method: 'POST',
    headers,
    body: bodyStr,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/disbursements', () => {
  // ------------------------------------------------------------------
  // 1. Valid disbursement → 200, correct response shape
  // ------------------------------------------------------------------

  it('returns 200 with correct response shape for a valid disbursement', async () => {
    const response = await post(validBody());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(typeof json.sequence_no).toBe('number');
    expect(json.sequence_no).toBeGreaterThan(0);
    expect(typeof json.event_hash).toBe('string');
    expect(json.event_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(json.head_hash).toBe(json.event_hash);
    expect(typeof json.public_beneficiary_ref).toBe('string');
    expect(json.public_beneficiary_ref).toMatch(/^benpub_[A-Z2-7]{16}$/);
    expect(json.next_action).toBe('send_code_to_beneficiary_via_bot');
  });

  // ------------------------------------------------------------------
  // 2. Omitted public_beneficiary_ref → server generates one
  // ------------------------------------------------------------------

  it('generates a beneficiary ref when public_beneficiary_ref is omitted', async () => {
    const body = validBody();
    // Ensure the key is not present at all
    delete body.public_beneficiary_ref;

    const response = await post(body);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(typeof json.public_beneficiary_ref).toBe('string');
    expect(json.public_beneficiary_ref).toMatch(/^benpub_[A-Z2-7]{16}$/);
  });

  // ------------------------------------------------------------------
  // 3. Explicit null public_beneficiary_ref → kept as null
  // ------------------------------------------------------------------

  it('keeps public_beneficiary_ref as null when explicitly set to null', async () => {
    const response = await post(validBody({ public_beneficiary_ref: null }));
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.public_beneficiary_ref).toBeNull();
  });

  // ------------------------------------------------------------------
  // 4. String public_beneficiary_ref → 422 VALIDATION_ERROR
  // ------------------------------------------------------------------

  it('rejects a string public_beneficiary_ref with 422', async () => {
    const response = await post(validBody({ public_beneficiary_ref: 'benpub_7G9Q2KX4N5P8R2T6' }));
    expect(response.status).toBe(422);

    const json = await response.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.request_id).toBeDefined();
    expect(typeof json.error.request_id).toBe('string');
    expect(json.error.details.field_errors).toHaveProperty('public_beneficiary_ref');
  });

  // ------------------------------------------------------------------
  // 5. Missing required fields → 422 with field errors
  // ------------------------------------------------------------------

  it('returns 422 with field errors for an empty body', async () => {
    const response = await post({});
    expect(response.status).toBe(422);

    const json = await response.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.request_id).toBeDefined();
    expect(typeof json.error.request_id).toBe('string');

    const fieldErrors = json.error.details.field_errors;
    // At minimum, amount_usdc_minor, gift_card_count, service, receipt_ref,
    // and purchased_at_utc should be flagged.
    expect(fieldErrors).toHaveProperty('amount_usdc_minor');
    expect(fieldErrors).toHaveProperty('gift_card_count');
    expect(fieldErrors).toHaveProperty('service');
    expect(fieldErrors).toHaveProperty('receipt_ref');
    expect(fieldErrors).toHaveProperty('purchased_at_utc');
  });

  // ------------------------------------------------------------------
  // 6. Invalid amount format → 422
  // ------------------------------------------------------------------

  it('returns 422 for a non-numeric amount_usdc_minor', async () => {
    const response = await post(validBody({ amount_usdc_minor: 'abc' }));
    expect(response.status).toBe(422);

    const json = await response.json();
    expect(json.error.details.field_errors).toHaveProperty('amount_usdc_minor');
  });

  // ------------------------------------------------------------------
  // 7. Future purchased_at_utc → 422
  // ------------------------------------------------------------------

  it('returns 422 for a future purchased_at_utc', async () => {
    // 1 year in the future
    const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z');

    const response = await post(validBody({ purchased_at_utc: futureDate }));
    expect(response.status).toBe(422);

    const json = await response.json();
    expect(json.error.details.field_errors).toHaveProperty('purchased_at_utc');
  });

  // ------------------------------------------------------------------
  // 8. "Other" service without service_note → 422
  // ------------------------------------------------------------------

  it('returns 422 when service is "Other" and service_note is null', async () => {
    const response = await post(validBody({ service: 'Other', service_note: null }));
    expect(response.status).toBe(422);

    const json = await response.json();
    expect(json.error.details.field_errors).toHaveProperty('service_note');
  });

  // ------------------------------------------------------------------
  // 9. "Other" service with service_note → 200
  // ------------------------------------------------------------------

  it('accepts "Other" service with a service_note', async () => {
    const response = await post(
      validBody({ service: 'Other', service_note: 'Custom provider note' }),
    );
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.sequence_no).toBeGreaterThan(0);
  });

  // ------------------------------------------------------------------
  // 10. Known service with non-null service_note → 422
  // ------------------------------------------------------------------

  it('returns 422 when a known service has a non-null service_note', async () => {
    const response = await post(validBody({ service: 'Alter', service_note: 'should be null' }));
    expect(response.status).toBe(422);

    const json = await response.json();
    expect(json.error.details.field_errors).toHaveProperty('service_note');
  });

  // ------------------------------------------------------------------
  // 11. Invalid JSON body → 400
  // ------------------------------------------------------------------

  it('returns 400 for a non-JSON body', async () => {
    const response = await post('not json', 'text/plain');
    expect(response.status).toBe(400);

    const json = await response.json();
    expect(json.error.code).toBe('BAD_REQUEST');
    expect(json.error.request_id).toBeDefined();
    expect(typeof json.error.request_id).toBe('string');
  });

  // ------------------------------------------------------------------
  // 12. Multiple appends → hash chain links correctly
  // ------------------------------------------------------------------

  it('builds a valid hash chain across multiple disbursements', async () => {
    // First disbursement
    const r1 = await post(validBody({ receipt_ref: 'ALTER-2026-06-14-CHAIN1' }));
    expect(r1.status).toBe(200);
    const j1 = await r1.json();
    const seq1 = j1.sequence_no;

    // Second disbursement
    const r2 = await post(validBody({ receipt_ref: 'ALTER-2026-06-14-CHAIN2' }));
    expect(r2.status).toBe(200);
    const j2 = await r2.json();
    const seq2 = j2.sequence_no;

    // Sequence numbers should increment
    expect(seq2).toBe(seq1 + 1);

    // Verify the hash chain via vault-db helpers
    const db = createVaultDb(env.vault_db);
    const page = await getEventsPaginated(db, { limit: 100 });
    expect(page.items.length).toBeGreaterThanOrEqual(2);

    const chainResult = await verifyChain(page.items);
    expect(chainResult.valid).toBe(true);
  });

  // ------------------------------------------------------------------
  // 13. Invalid receipt_ref format → 422
  // ------------------------------------------------------------------

  it('returns 422 for an invalid receipt_ref format', async () => {
    const response = await post(validBody({ receipt_ref: '!!invalid!!' }));
    expect(response.status).toBe(422);

    const json = await response.json();
    expect(json.error.details.field_errors).toHaveProperty('receipt_ref');
  });
});
