import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  createVaultDb,
  appendLedgerEvent,
  getHead,
  getRawEventsPaginated,
} from '@open-care/vault-db';
import type { VaultDb } from '@open-care/vault-db';
import { canonicalJson } from '@open-care/vault-core';
import type { DonationPayload } from '@open-care/vault-core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validCorrectionBody(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    corrects_sequence_no: 1,
    replacement_fields: {
      receipt_ref: 'ALTER-2026-06-14-CORRECTED',
    },
    reason: 'Fixed receipt reference',
    ...overrides,
  };
}

function post(body: unknown, contentType = 'application/json'): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': contentType };
  const bodyStr = contentType === 'application/json' ? JSON.stringify(body) : String(body);
  return SELF.fetch('https://example.com/api/corrections', {
    method: 'POST',
    headers,
    body: bodyStr,
  });
}

/** Seed a donation event. */
async function seedDonation(db: VaultDb): Promise<void> {
  const result = await appendLedgerEvent(db, {
    event_type: 'donation_confirmed',
    payload: {
      cluster: 'devnet',
      usdc_mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      treasury_wallet_address: '8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG',
      vault_usdc_ata: '52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG',
      tx_signature:
        '5Jofwx5DPe1qBwHL7hN3VpFqLxqFj4mJLo5iY7nP8kRt2sT9uVvWxYzAbCdEfGhIjKlMnOpQrStUvWxYz1234',
      transaction_version: 0,
      instruction_index: 0,
      inner_index: null,
      slot: 123456789,
      block_time_utc: '2026-06-14T10:23:00Z',
      amount_usdc_minor: '100000000',
    },
    created_at_utc: '2026-06-14T10:23:01Z',
  });
  if (!result.ok) {
    throw new Error(`Failed to seed donation: ${result.error.message}`);
  }
}

/** Seed a disbursement event (to bump the head past the donation). */
async function seedDisbursement(db: VaultDb): Promise<void> {
  const result = await appendLedgerEvent(db, {
    event_type: 'disbursement_recorded',
    payload: {
      amount_usdc_minor: '50000000',
      gift_card_count: 2,
      service: 'Alter',
      service_note: null,
      receipt_ref: 'ALTER-2026-06-14-SEED',
      public_beneficiary_ref: 'benpub_A2B3C4D5E6F7G2H3',
      purchased_at_utc: '2026-06-14T10:23:00Z',
      recorded_at_utc: '2026-06-14T10:25:14Z',
      recorded_by: 'test-operator',
    },
    created_at_utc: '2026-06-14T10:25:14Z',
  });
  if (!result.ok) {
    throw new Error(`Failed to seed disbursement: ${result.error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/corrections', () => {
  let db: VaultDb;

  beforeAll(async () => {
    db = createVaultDb(env.vault_db);
    // Seed at least 2 events so head >= 2, allowing correction of sequence_no 1
    await seedDonation(db);
    await seedDisbursement(db);
  });

  // ------------------------------------------------------------------
  // 1. Valid correction → 200, correct response shape
  // ------------------------------------------------------------------

  it('returns 200 with correct response shape for a valid correction', async () => {
    const response = await post(validCorrectionBody());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(typeof json.sequence_no).toBe('number');
    expect(json.sequence_no).toBeGreaterThan(0);
    expect(typeof json.event_hash).toBe('string');
    expect(json.event_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof json.head_hash).toBe('string');
    expect(json.head_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(json.head_hash).toBe(json.event_hash);
    expect(typeof json.corrects_sequence_no).toBe('number');
    expect(json.corrects_sequence_no).toBe(1);
  });

  // ------------------------------------------------------------------
  // 2. corrects_sequence_no >= current head → 422
  // ------------------------------------------------------------------

  it('returns 422 when corrects_sequence_no equals current head', async () => {
    // Get current head
    const head = await getHead(db);
    const headSeq = head!.sequence_no;

    const response = await post(validCorrectionBody({ corrects_sequence_no: headSeq }));
    expect(response.status).toBe(422);

    const json = await response.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.request_id).toBeDefined();
    expect(typeof json.error.request_id).toBe('string');
    expect(json.error.details.field_errors).toHaveProperty('corrects_sequence_no');
  });

  it('returns 422 when corrects_sequence_no exceeds current head', async () => {
    const head = await getHead(db);
    const headSeq = head!.sequence_no;

    const response = await post(validCorrectionBody({ corrects_sequence_no: headSeq + 999 }));
    expect(response.status).toBe(422);

    const json = await response.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.request_id).toBeDefined();
    expect(typeof json.error.request_id).toBe('string');
    expect(json.error.details.field_errors).toHaveProperty('corrects_sequence_no');
  });

  // ------------------------------------------------------------------
  // 3. replacement_fields with amount_usdc_minor → 422 (whitelist rejection)
  // ------------------------------------------------------------------

  it('returns 422 when replacement_fields contains amount_usdc_minor', async () => {
    const response = await post(
      validCorrectionBody({
        replacement_fields: {
          receipt_ref: 'ALTER-2026-06-14-CORRECTED',
          amount_usdc_minor: '99999999',
        },
      }),
    );
    expect(response.status).toBe(422);

    const json = await response.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.request_id).toBeDefined();
    expect(typeof json.error.request_id).toBe('string');
    // The Zod .strict() on ReplacementFieldsSchema catches unknown keys
    expect(json.error.details.field_errors).toHaveProperty('replacement_fields');
  });

  // ------------------------------------------------------------------
  // 4. replacement_fields with gift_card_count → 422 (whitelist rejection)
  // ------------------------------------------------------------------

  it('returns 422 when replacement_fields contains gift_card_count', async () => {
    const response = await post(
      validCorrectionBody({
        replacement_fields: {
          receipt_ref: 'ALTER-2026-06-14-CORRECTED',
          gift_card_count: 5,
        },
      }),
    );
    expect(response.status).toBe(422);

    const json = await response.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.request_id).toBeDefined();
    expect(typeof json.error.request_id).toBe('string');
    expect(json.error.details.field_errors).toHaveProperty('replacement_fields');
  });

  // ------------------------------------------------------------------
  // 5. replacement_fields with unknown key → 422 (whitelist rejection)
  // ------------------------------------------------------------------

  it('returns 422 when replacement_fields contains an unknown key', async () => {
    const response = await post(
      validCorrectionBody({
        replacement_fields: {
          receipt_ref: 'ALTER-2026-06-14-CORRECTED',
          foo_bar_baz: 'some value',
        },
      }),
    );
    expect(response.status).toBe(422);

    const json = await response.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.request_id).toBeDefined();
    expect(typeof json.error.request_id).toBe('string');
    expect(json.error.details.field_errors).toHaveProperty('replacement_fields');
  });

  // ------------------------------------------------------------------
  // 6. Missing reason → 422
  // ------------------------------------------------------------------

  it('returns 422 when reason is missing', async () => {
    const body = validCorrectionBody();
    delete body.reason;

    const response = await post(body);
    expect(response.status).toBe(422);

    const json = await response.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.request_id).toBeDefined();
    expect(typeof json.error.request_id).toBe('string');
    expect(json.error.details.field_errors).toHaveProperty('reason');
  });

  // ------------------------------------------------------------------
  // 7. Bivalent: original event's payload_json unchanged after correction
  // ------------------------------------------------------------------

  it('preserves original event payload_json byte-for-byte after correction', async () => {
    // Build the donation payload and compute its canonical JSON
    const donationPayload: DonationPayload = {
      cluster: 'devnet',
      usdc_mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      treasury_wallet_address: '8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG',
      vault_usdc_ata: '52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG',
      tx_signature:
        '5Jofwx5DPe1qBwHL7hN3VpFqLxqFj4mJLo5iY7nP8kRt2sT9uVvWxYzAbCdEfGhIjKlMnOpQrStUvWxYz1234',
      transaction_version: 0,
      instruction_index: 0,
      inner_index: null,
      slot: 123456789,
      block_time_utc: '2026-06-14T10:23:00Z',
      amount_usdc_minor: '100000000',
    };
    const expectedPayloadJson = canonicalJson(donationPayload);

    // Seed a fresh donation (the beforeAll seed may have been corrected already)
    const freshDb = createVaultDb(env.vault_db);
    const seedResult = await appendLedgerEvent(freshDb, {
      event_type: 'donation_confirmed',
      payload: donationPayload,
      created_at_utc: '2026-06-14T10:23:01Z',
    });
    if (!seedResult.ok) {
      throw new Error(`Failed to seed fresh donation: ${seedResult.error.message}`);
    }
    const freshSeqNo = seedResult.value.sequence_no;

    // Seed a disbursement after the fresh donation so the head is > freshSeqNo
    const bumpResult = await appendLedgerEvent(freshDb, {
      event_type: 'disbursement_recorded',
      payload: {
        amount_usdc_minor: '1000000',
        gift_card_count: 1,
        service: 'Alter',
        service_note: null,
        receipt_ref: 'ALTER-2026-06-14-BUMP',
        public_beneficiary_ref: 'benpub_A2B3C4D5E6F7G2H3',
        purchased_at_utc: '2026-06-14T10:23:00Z',
        recorded_at_utc: '2026-06-14T10:25:14Z',
        recorded_by: 'test-operator',
      },
      created_at_utc: '2026-06-14T10:25:14Z',
    });
    if (!bumpResult.ok) {
      throw new Error(`Failed to seed bump disbursement: ${bumpResult.error.message}`);
    }

    // Apply a correction to this fresh donation
    const correctionResponse = await post(
      validCorrectionBody({
        corrects_sequence_no: freshSeqNo,
        replacement_fields: {
          receipt_ref: 'ALTER-2026-06-14-BIVALENT',
        },
        reason: 'Bivalent test correction',
      }),
    );
    expect(correctionResponse.status).toBe(200);

    // Fetch the original event directly from the DB to verify payload_json
    // is byte-for-byte identical to the canonical JSON that was stored.
    // Use getRawEventsPaginated which returns payload_json as the raw DB string.
    const rawPage = await getRawEventsPaginated(freshDb, { limit: 100 });
    const originalEvent = rawPage.items.find((item) => item.sequence_no === freshSeqNo);
    expect(originalEvent).toBeDefined();
    expect(originalEvent!.event_type).toBe('donation_confirmed');

    // The payload_json must be byte-for-byte identical to the canonical JSON
    // that was stored — NOT re-serialized by the API.
    expect(originalEvent!.payload_json).toBe(expectedPayloadJson);
  });
});
