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
import type { AnchorPayload, CorrectionPayload, DisbursementPayload } from '@open-care/vault-core';

type CorrectionSuccessJson = {
  sequence_no: number;
  event_hash: string;
  head_hash: string;
  corrects_sequence_no: number;
};

type ValidationErrorJson = {
  error: {
    code: string;
    request_id?: string;
    details: {
      code?: string;
      field_errors: Record<string, string[]>;
    };
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validCorrectionBody(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    corrects_sequence_no: 2,
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

function createTestVaultDb(): VaultDb {
  const testEnv = env as unknown as { vault_db: D1Database };
  return createVaultDb(testEnv.vault_db);
}

async function responseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** Seed a donation event. */
async function seedDonation(db: VaultDb): Promise<number> {
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
  return result.value.sequence_no;
}

function disbursementPayload(overrides?: Partial<DisbursementPayload>): DisbursementPayload {
  return {
    amount_usdc_minor: '50000000',
    gift_card_count: 2,
    service: 'Alter',
    service_note: null,
    receipt_ref: 'ALTER-2026-06-14-SEED',
    public_beneficiary_ref: 'benpub_A2B3C4D5E6F7G2H3',
    purchased_at_utc: '2026-06-14T10:23:00Z',
    recorded_at_utc: '2026-06-14T10:25:14Z',
    recorded_by: 'test-operator',
    ...overrides,
  };
}

/** Seed a disbursement event. */
async function seedDisbursement(
  db: VaultDb,
  overrides?: Partial<DisbursementPayload>,
): Promise<number> {
  const result = await appendLedgerEvent(db, {
    event_type: 'disbursement_recorded',
    payload: disbursementPayload(overrides),
    created_at_utc: '2026-06-14T10:25:14Z',
  });
  if (!result.ok) {
    throw new Error(`Failed to seed disbursement: ${result.error.message}`);
  }
  return result.value.sequence_no;
}

async function seedAnchor(db: VaultDb): Promise<number> {
  const head = await getHead(db);
  if (!head) {
    throw new Error('Cannot seed anchor without a ledger head');
  }

  const payload: AnchorPayload = {
    anchor_date: '2026-06-16',
    anchored_head_sequence_no: head.sequence_no,
    anchored_head_hash: head.event_hash,
    tx_signature: '7nOpQ3456seedAnchorDevnetExampleTx',
    anchor_wallet_address: 'BhKtkM1oHADwo8ap5P6Lymj7b3iaspiAm37RA9KMn8YG',
    memo_text: `ccv-anchor:${head.event_hash}`,
    published_at_utc: '2026-06-16T01:00:00Z',
    cluster: 'devnet',
  };

  const result = await appendLedgerEvent(db, {
    event_type: 'anchor_published',
    payload,
    created_at_utc: payload.published_at_utc,
  });
  if (!result.ok) {
    throw new Error(`Failed to seed anchor: ${result.error.message}`);
  }
  return result.value.sequence_no;
}

async function seedCorrection(db: VaultDb, correctsSequenceNo: number): Promise<number> {
  const payload: CorrectionPayload = {
    corrects_sequence_no: correctsSequenceNo,
    reason: 'Seed correction event for target validation test',
    replacement_fields: {
      receipt_ref: 'ALTER-2026-06-14-SEED-CORR',
    },
    recorded_at_utc: '2026-06-16T10:00:00Z',
    recorded_by: 'operator',
  };

  const result = await appendLedgerEvent(db, {
    event_type: 'correction_recorded',
    payload,
    created_at_utc: payload.recorded_at_utc,
  });
  if (!result.ok) {
    throw new Error(`Failed to seed correction: ${result.error.message}`);
  }
  return result.value.sequence_no;
}

async function expectCorrectionTargetRejected(response: Response): Promise<void> {
  expect(response.status).toBe(422);

  const json = await responseJson<ValidationErrorJson>(response);
  expect(json.error.code).toBe('VALIDATION_ERROR');
  expect(json.error.request_id).toBeDefined();
  expect(typeof json.error.request_id).toBe('string');
  expect(json.error.details.code).toBe('CORRECTION_TARGET_NOT_DISBURSEMENT');
  expect(json.error.details.field_errors).toHaveProperty('corrects_sequence_no');
}

async function getCorrectionPayloadBySequenceNo(
  db: VaultDb,
  sequenceNo: number,
): Promise<CorrectionPayload> {
  const rawPage = await getRawEventsPaginated(db, { cursor: sequenceNo - 1, limit: 1 });
  const event = rawPage.items[0];

  expect(event).toBeDefined();
  expect(event!.sequence_no).toBe(sequenceNo);
  expect(event!.event_type).toBe('correction_recorded');

  return JSON.parse(event!.payload_json) as CorrectionPayload;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/corrections', () => {
  let db: VaultDb;

  beforeAll(async () => {
    db = createTestVaultDb();
    // Seed a donation followed by a disbursement and a later bump event so
    // the default valid correction target is the disbursement at sequence_no 2.
    await seedDonation(db);
    await seedDisbursement(db);
    await seedDisbursement(db, { receipt_ref: 'ALTER-2026-06-14-HEAD-BUMP' });
  });

  // ------------------------------------------------------------------
  // 1. Valid correction → 200, correct response shape
  // ------------------------------------------------------------------

  it('returns 200 with correct response shape for a valid correction', async () => {
    const response = await post(validCorrectionBody());
    expect(response.status).toBe(200);

    const json = await responseJson<CorrectionSuccessJson>(response);
    expect(typeof json.sequence_no).toBe('number');
    expect(json.sequence_no).toBeGreaterThan(0);
    expect(typeof json.event_hash).toBe('string');
    expect(json.event_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof json.head_hash).toBe('string');
    expect(json.head_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(json.head_hash).toBe(json.event_hash);
    expect(typeof json.corrects_sequence_no).toBe('number');
    expect(json.corrects_sequence_no).toBe(2);
  });

  // ------------------------------------------------------------------
  // 2. service_note replacement fields → 200
  // ------------------------------------------------------------------

  /*
  Scenario: Service-note-only correction succeeds
    Given an existing disbursement with an original service note
    When the operator submits a correction with only `service_note: "Updated note"`
    Then the API returns 200
    And a correction ledger event is appended showing the replacement service note.
  */
  it('returns 200 and appends a correction event for service_note-only replacement', async () => {
    const targetSeqNo = await seedDisbursement(db, {
      service: 'Other',
      service_note: 'Original note',
      receipt_ref: 'ALTER-2026-06-14-SVC-ORIG',
    });
    await seedDisbursement(db, { receipt_ref: 'ALTER-2026-06-14-SVC-BUMP' });

    const response = await post(
      validCorrectionBody({
        corrects_sequence_no: targetSeqNo,
        replacement_fields: {
          service_note: 'Updated note',
        },
        reason: 'Updated service note',
      }),
    );

    expect(response.status).toBe(200);
    const json = await responseJson<CorrectionSuccessJson>(response);
    expect(json.corrects_sequence_no).toBe(targetSeqNo);

    const payload = await getCorrectionPayloadBySequenceNo(db, json.sequence_no);
    expect(payload.corrects_sequence_no).toBe(targetSeqNo);
    expect(payload.replacement_fields).toEqual({
      service_note: 'Updated note',
    });
  });

  /*
  Scenario: Receipt reference and service note correction succeeds
    Given an existing disbursement with original receipt ref and service note
    When the operator submits a correction with `receipt_ref: "NEW-REF"` and `service_note: "Updated note"`
    Then the API returns 200
    And the correction event records both replacement fields.
  */
  it('returns 200 and appends a correction event for receipt_ref and service_note replacement', async () => {
    const targetSeqNo = await seedDisbursement(db, {
      service: 'Other',
      service_note: 'Original note',
      receipt_ref: 'ALTER-2026-06-14-BOTH-ORIG',
    });
    await seedDisbursement(db, { receipt_ref: 'ALTER-2026-06-14-BOTH-BUMP' });

    const response = await post(
      validCorrectionBody({
        corrects_sequence_no: targetSeqNo,
        replacement_fields: {
          receipt_ref: 'NEW-REF',
          service_note: 'Updated note',
        },
        reason: 'Updated receipt reference and service note',
      }),
    );

    expect(response.status).toBe(200);
    const json = await responseJson<CorrectionSuccessJson>(response);
    expect(json.corrects_sequence_no).toBe(targetSeqNo);

    const payload = await getCorrectionPayloadBySequenceNo(db, json.sequence_no);
    expect(payload.corrects_sequence_no).toBe(targetSeqNo);
    expect(payload.replacement_fields).toEqual({
      receipt_ref: 'NEW-REF',
      service_note: 'Updated note',
    });
  });

  /*
  Scenario: Empty replacement_fields is rejected
    Given an existing disbursement
    When the operator submits a correction with `replacement_fields: {}`
    Then the API returns 422 with the existing validation error shape
    And no correction event is appended.
  */
  it('returns 422 and does not append a correction event when replacement_fields is empty', async () => {
    const headBefore = await getHead(db);
    expect(headBefore).not.toBeNull();

    const response = await post(
      validCorrectionBody({
        replacement_fields: {},
      }),
    );

    expect(response.status).toBe(422);

    const json = await responseJson<ValidationErrorJson>(response);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.request_id).toBeDefined();
    expect(typeof json.error.request_id).toBe('string');
    expect(json.error.details.field_errors).toHaveProperty('replacement_fields');

    const headAfter = await getHead(db);
    expect(headAfter!.sequence_no).toBe(headBefore!.sequence_no);
    expect(headAfter!.event_hash).toBe(headBefore!.event_hash);
  });

  // ------------------------------------------------------------------
  // 3. Non-disbursement correction targets → 422
  // ------------------------------------------------------------------

  it('returns 422 when corrects_sequence_no targets a donation_confirmed event', async () => {
    const response = await post(validCorrectionBody({ corrects_sequence_no: 1 }));

    await expectCorrectionTargetRejected(response);
  });

  it('returns 422 when corrects_sequence_no targets an anchor_published event', async () => {
    const anchorSeqNo = await seedAnchor(db);
    await seedDisbursement(db, { receipt_ref: 'ALTER-2026-06-14-ANCHOR-BUMP' });

    const response = await post(validCorrectionBody({ corrects_sequence_no: anchorSeqNo }));

    await expectCorrectionTargetRejected(response);
  });

  it('returns 422 when corrects_sequence_no targets a correction_recorded event', async () => {
    const disbursementSeqNo = await seedDisbursement(db, {
      receipt_ref: 'ALTER-2026-06-14-CORR-TARGET',
    });
    const correctionSeqNo = await seedCorrection(db, disbursementSeqNo);
    await seedDisbursement(db, { receipt_ref: 'ALTER-2026-06-14-CORR-BUMP' });

    const response = await post(validCorrectionBody({ corrects_sequence_no: correctionSeqNo }));

    await expectCorrectionTargetRejected(response);
  });

  // ------------------------------------------------------------------
  // 4. corrects_sequence_no >= current head → 422
  // ------------------------------------------------------------------

  it('returns 422 when corrects_sequence_no equals current head', async () => {
    // Get current head
    const head = await getHead(db);
    const headSeq = head!.sequence_no;

    const response = await post(validCorrectionBody({ corrects_sequence_no: headSeq }));
    expect(response.status).toBe(422);

    const json = await responseJson<ValidationErrorJson>(response);
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

    const json = await responseJson<ValidationErrorJson>(response);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.request_id).toBeDefined();
    expect(typeof json.error.request_id).toBe('string');
    expect(json.error.details.field_errors).toHaveProperty('corrects_sequence_no');
  });

  // ------------------------------------------------------------------
  // 5. replacement_fields with amount_usdc_minor → 422 (whitelist rejection)
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

    const json = await responseJson<ValidationErrorJson>(response);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.request_id).toBeDefined();
    expect(typeof json.error.request_id).toBe('string');
    // The Zod .strict() on ReplacementFieldsSchema catches unknown keys
    expect(json.error.details.field_errors).toHaveProperty('replacement_fields');
  });

  // ------------------------------------------------------------------
  // 6. replacement_fields with gift_card_count → 422 (whitelist rejection)
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

    const json = await responseJson<ValidationErrorJson>(response);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.request_id).toBeDefined();
    expect(typeof json.error.request_id).toBe('string');
    expect(json.error.details.field_errors).toHaveProperty('replacement_fields');
  });

  // ------------------------------------------------------------------
  // 7. replacement_fields with unknown key → 422 (whitelist rejection)
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

    const json = await responseJson<ValidationErrorJson>(response);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.request_id).toBeDefined();
    expect(typeof json.error.request_id).toBe('string');
    expect(json.error.details.field_errors).toHaveProperty('replacement_fields');
  });

  // ------------------------------------------------------------------
  // 8. Missing reason → 422
  // ------------------------------------------------------------------

  it('returns 422 when reason is missing', async () => {
    const body = validCorrectionBody();
    delete body.reason;

    const response = await post(body);
    expect(response.status).toBe(422);

    const json = await responseJson<ValidationErrorJson>(response);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.request_id).toBeDefined();
    expect(typeof json.error.request_id).toBe('string');
    expect(json.error.details.field_errors).toHaveProperty('reason');
  });

  // ------------------------------------------------------------------
  // 9. Bivalent: original event's payload_json unchanged after correction
  // ------------------------------------------------------------------

  it('preserves original event payload_json byte-for-byte after correction', async () => {
    // Build the disbursement payload and compute its canonical JSON.
    const originalDisbursementPayload = disbursementPayload({
      receipt_ref: 'ALTER-2026-06-14-BIVALENT-ORIG',
    });
    const expectedPayloadJson = canonicalJson(originalDisbursementPayload);

    // Seed a fresh disbursement (the beforeAll seed may have been corrected already)
    const freshDb = createTestVaultDb();
    const seedResult = await appendLedgerEvent(freshDb, {
      event_type: 'disbursement_recorded',
      payload: originalDisbursementPayload,
      created_at_utc: originalDisbursementPayload.recorded_at_utc,
    });
    if (!seedResult.ok) {
      throw new Error(`Failed to seed fresh disbursement: ${seedResult.error.message}`);
    }
    const freshSeqNo = seedResult.value.sequence_no;

    // Seed another disbursement after the fresh target so the head is > freshSeqNo
    await seedDisbursement(freshDb, { receipt_ref: 'ALTER-2026-06-14-BIVALENT-BUMP' });

    // Apply a correction to this fresh disbursement
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
    expect(originalEvent!.event_type).toBe('disbursement_recorded');

    // The payload_json must be byte-for-byte identical to the canonical JSON
    // that was stored — NOT re-serialized by the API.
    expect(originalEvent!.payload_json).toBe(expectedPayloadJson);
  });
});
