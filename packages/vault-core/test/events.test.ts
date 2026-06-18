import { describe, it, expect } from 'vitest';
import {
  DonationPayloadSchema,
  DisbursementPayloadSchema,
  AnchorPayloadSchema,
  ReplacementFieldsSchema,
  CorrectionPayloadSchema,
  LedgerEventBaseSchema,
  parseLedgerEvent,
  isDonationPayload,
  isDisbursementPayload,
  isAnchorPayload,
  isCorrectionPayload,
} from '../src/events.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDonationPayload(overrides: Record<string, unknown> = {}) {
  return {
    cluster: 'mainnet-beta',
    usdc_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    treasury_wallet_address: '8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG',
    vault_usdc_ata: '52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG',
    tx_signature: '5xAbC1234mockTestVectorDonationConfirmedExample',
    transaction_version: 0,
    instruction_index: 3,
    inner_index: null,
    slot: 123456789,
    block_time_utc: '2026-06-14T10:23:00Z',
    amount_usdc_minor: '100000000',
    ...overrides,
  };
}

function makeDisbursementPayload(overrides: Record<string, unknown> = {}) {
  return {
    amount_usdc_minor: '50000000',
    gift_card_count: 5,
    service: 'Alter',
    service_note: null,
    receipt_ref: 'ALTER-2026-06-14-A1B2C3',
    public_beneficiary_ref: null,
    purchased_at_utc: '2025-01-15T10:00:00Z',
    recorded_at_utc: '2026-06-14T10:23:00Z',
    recorded_by: 'operator-1',
    ...overrides,
  };
}

function makeAnchorPayload(overrides: Record<string, unknown> = {}) {
  return {
    anchor_date: '2026-06-14',
    anchored_head_sequence_no: 42,
    anchored_head_hash: 'a'.repeat(64),
    tx_signature: 'x'.repeat(88),
    anchor_wallet_address: 'A'.repeat(44),
    memo_text: 'ccv-anchor:' + 'b'.repeat(64),
    published_at_utc: '2026-06-14T10:23:00Z',
    cluster: 'mainnet-beta',
    ...overrides,
  };
}

function makeCorrectionPayload(overrides: Record<string, unknown> = {}) {
  return {
    corrects_sequence_no: 5,
    reason: 'Fixed receipt reference',
    replacement_fields: { receipt_ref: 'ALTER-2026-06-14-NEWREF' },
    recorded_at_utc: '2026-06-14T10:23:00Z',
    recorded_by: 'operator-1',
    ...overrides,
  };
}

function makeDonationEvent(overrides: Record<string, unknown> = {}) {
  return {
    sequence_no: 1,
    event_type: 'donation_confirmed' as const,
    payload: makeDonationPayload(),
    prev_hash: '0'.repeat(64),
    created_at_utc: '2026-06-14T10:23:01Z',
    ...overrides,
  };
}

function makeDisbursementEvent(overrides: Record<string, unknown> = {}) {
  return {
    sequence_no: 2,
    event_type: 'disbursement_recorded' as const,
    payload: makeDisbursementPayload(),
    prev_hash: '1'.repeat(64),
    created_at_utc: '2026-06-14T10:23:02Z',
    ...overrides,
  };
}

function makeAnchorEvent(overrides: Record<string, unknown> = {}) {
  return {
    sequence_no: 3,
    event_type: 'anchor_published' as const,
    payload: makeAnchorPayload(),
    prev_hash: '2'.repeat(64),
    created_at_utc: '2026-06-14T10:23:03Z',
    ...overrides,
  };
}

function makeCorrectionEvent(overrides: Record<string, unknown> = {}) {
  return {
    sequence_no: 4,
    event_type: 'correction_recorded' as const,
    payload: makeCorrectionPayload(),
    prev_hash: '3'.repeat(64),
    created_at_utc: '2026-06-14T10:23:04Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// DonationPayloadSchema
// ---------------------------------------------------------------------------

describe('DonationPayloadSchema', () => {
  describe('valid', () => {
    it('accepts a full valid donation payload with all required fields', () => {
      const result = DonationPayloadSchema.safeParse(makeDonationPayload());
      expect(result.success).toBe(true);
    });

    it('accepts inner_index: null', () => {
      const result = DonationPayloadSchema.safeParse(makeDonationPayload({ inner_index: null }));
      expect(result.success).toBe(true);
    });

    it('accepts inner_index: 0 (number)', () => {
      const result = DonationPayloadSchema.safeParse(makeDonationPayload({ inner_index: 0 }));
      expect(result.success).toBe(true);
    });

    it('accepts transaction_version: 0', () => {
      const result = DonationPayloadSchema.safeParse(
        makeDonationPayload({ transaction_version: 0 }),
      );
      expect(result.success).toBe(true);
    });

    it('accepts transaction_version: "legacy"', () => {
      const result = DonationPayloadSchema.safeParse(
        makeDonationPayload({ transaction_version: 'legacy' }),
      );
      expect(result.success).toBe(true);
    });

    it('accepts cluster: "devnet"', () => {
      const result = DonationPayloadSchema.safeParse(makeDonationPayload({ cluster: 'devnet' }));
      expect(result.success).toBe(true);
    });

    it('accepts cluster: "localnet"', () => {
      const result = DonationPayloadSchema.safeParse(makeDonationPayload({ cluster: 'localnet' }));
      expect(result.success).toBe(true);
    });
  });

  describe('invalid', () => {
    it('rejects a payload missing cluster', () => {
      const payload = makeDonationPayload();
      const withoutCluster: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(payload)) {
        if (k !== 'cluster') withoutCluster[k] = v;
      }
      const result = DonationPayloadSchema.safeParse(withoutCluster);
      expect(result.success).toBe(false);
    });

    it('rejects cluster: "testnet" (not in enum)', () => {
      const result = DonationPayloadSchema.safeParse(makeDonationPayload({ cluster: 'testnet' }));
      expect(result.success).toBe(false);
    });

    it('rejects amount_usdc_minor: "0" (must be > 0)', () => {
      const result = DonationPayloadSchema.safeParse(
        makeDonationPayload({ amount_usdc_minor: '0' }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects amount_usdc_minor: "-100" (negative)', () => {
      const result = DonationPayloadSchema.safeParse(
        makeDonationPayload({ amount_usdc_minor: '-100' }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects amount_usdc_minor: "abc" (not digits)', () => {
      const result = DonationPayloadSchema.safeParse(
        makeDonationPayload({ amount_usdc_minor: 'abc' }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects block_time_utc: "invalid"', () => {
      const result = DonationPayloadSchema.safeParse(
        makeDonationPayload({ block_time_utc: 'invalid' }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects block_time_utc missing Z suffix', () => {
      const result = DonationPayloadSchema.safeParse(
        makeDonationPayload({ block_time_utc: '2026-06-14T10:23:00' }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects transaction_version: 1 (not 0 or "legacy")', () => {
      const result = DonationPayloadSchema.safeParse(
        makeDonationPayload({ transaction_version: 1 }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects transaction_version: "v0"', () => {
      const result = DonationPayloadSchema.safeParse(
        makeDonationPayload({ transaction_version: 'v0' }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects slot: 0 (must be positive)', () => {
      const result = DonationPayloadSchema.safeParse(makeDonationPayload({ slot: 0 }));
      expect(result.success).toBe(false);
    });

    it('rejects slot: -1', () => {
      const result = DonationPayloadSchema.safeParse(makeDonationPayload({ slot: -1 }));
      expect(result.success).toBe(false);
    });

    it('rejects instruction_index: -1', () => {
      const result = DonationPayloadSchema.safeParse(
        makeDonationPayload({ instruction_index: -1 }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects instruction_index: 1.5 (not integer)', () => {
      const result = DonationPayloadSchema.safeParse(
        makeDonationPayload({ instruction_index: 1.5 }),
      );
      expect(result.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// DisbursementPayloadSchema
// ---------------------------------------------------------------------------

describe('DisbursementPayloadSchema', () => {
  describe('valid', () => {
    it('accepts a full valid disbursement with service "Alter" and service_note null', () => {
      const result = DisbursementPayloadSchema.safeParse(makeDisbursementPayload());
      expect(result.success).toBe(true);
    });

    it('accepts service "Other" with service_note "Custom provider note"', () => {
      const result = DisbursementPayloadSchema.safeParse(
        makeDisbursementPayload({
          service: 'Other',
          service_note: 'Custom provider note',
        }),
      );
      expect(result.success).toBe(true);
    });

    it('accepts public_beneficiary_ref: null', () => {
      const result = DisbursementPayloadSchema.safeParse(
        makeDisbursementPayload({ public_beneficiary_ref: null }),
      );
      expect(result.success).toBe(true);
    });

    it('accepts a valid public_beneficiary_ref (base32, no 0/1/8/9)', () => {
      const result = DisbursementPayloadSchema.safeParse(
        makeDisbursementPayload({
          public_beneficiary_ref: 'benpub_7G3Q2KX4N5P2R2T6',
        }),
      );
      expect(result.success).toBe(true);
    });

    it('accepts gift_card_count: 1', () => {
      const result = DisbursementPayloadSchema.safeParse(
        makeDisbursementPayload({ gift_card_count: 1 }),
      );
      expect(result.success).toBe(true);
    });

    it('accepts gift_card_count: 1000', () => {
      const result = DisbursementPayloadSchema.safeParse(
        makeDisbursementPayload({ gift_card_count: 1000 }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe('invalid', () => {
    it('rejects service "Alter" with non-null service_note (cross-field)', () => {
      const result = DisbursementPayloadSchema.safeParse(
        makeDisbursementPayload({
          service: 'Alter',
          service_note: 'should be null',
        }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects service "Other" with null service_note (cross-field)', () => {
      const result = DisbursementPayloadSchema.safeParse(
        makeDisbursementPayload({
          service: 'Other',
          service_note: null,
        }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects gift_card_count: 0', () => {
      const result = DisbursementPayloadSchema.safeParse(
        makeDisbursementPayload({ gift_card_count: 0 }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects gift_card_count: 1001', () => {
      const result = DisbursementPayloadSchema.safeParse(
        makeDisbursementPayload({ gift_card_count: 1001 }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects gift_card_count: 1.5 (not integer)', () => {
      const result = DisbursementPayloadSchema.safeParse(
        makeDisbursementPayload({ gift_card_count: 1.5 }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects purchased_at_utc far in the future', () => {
      const result = DisbursementPayloadSchema.safeParse(
        makeDisbursementPayload({
          purchased_at_utc: '2099-01-01T00:00:00Z',
        }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects receipt_ref: "ab" (too short, min 4 chars)', () => {
      const result = DisbursementPayloadSchema.safeParse(
        makeDisbursementPayload({ receipt_ref: 'ab' }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects public_beneficiary_ref containing "0" (not in base32 charset)', () => {
      const result = DisbursementPayloadSchema.safeParse(
        makeDisbursementPayload({
          public_beneficiary_ref: 'benpub_7G9Q0KX4N5P8R2T6',
        }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects service: "UnknownService" (not in enum)', () => {
      const result = DisbursementPayloadSchema.safeParse(
        makeDisbursementPayload({ service: 'UnknownService' }),
      );
      expect(result.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// AnchorPayloadSchema
// ---------------------------------------------------------------------------

describe('AnchorPayloadSchema', () => {
  describe('valid', () => {
    it('accepts a full valid anchor payload', () => {
      const result = AnchorPayloadSchema.safeParse(makeAnchorPayload());
      expect(result.success).toBe(true);
    });

    it('accepts cluster: "devnet"', () => {
      const result = AnchorPayloadSchema.safeParse(makeAnchorPayload({ cluster: 'devnet' }));
      expect(result.success).toBe(true);
    });

    it('accepts anchor_date with valid YYYY-MM-DD format (regex-only, no calendar validation)', () => {
      // The schema only checks the regex pattern, not calendar validity.
      // "2026-13-01" matches \d{4}-\d{2}-\d{2} even though month 13 is invalid.
      const result = AnchorPayloadSchema.safeParse(
        makeAnchorPayload({ anchor_date: '2026-13-01' }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe('invalid', () => {
    it('rejects anchored_head_hash with uppercase hex chars', () => {
      const result = AnchorPayloadSchema.safeParse(
        makeAnchorPayload({
          anchored_head_hash: 'A'.repeat(32) + 'b'.repeat(32),
        }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects anchored_head_hash too short (63 chars)', () => {
      const result = AnchorPayloadSchema.safeParse(
        makeAnchorPayload({ anchored_head_hash: 'a'.repeat(63) }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects memo_text with wrong format (no "ccv-anchor:" prefix)', () => {
      const result = AnchorPayloadSchema.safeParse(
        makeAnchorPayload({ memo_text: 'b'.repeat(64) }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects memo_text with uppercase hex in the hash portion', () => {
      const result = AnchorPayloadSchema.safeParse(
        makeAnchorPayload({
          memo_text: 'ccv-anchor:' + 'B'.repeat(64),
        }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects anchor_date: "not-a-date" (does not match YYYY-MM-DD regex)', () => {
      const result = AnchorPayloadSchema.safeParse(
        makeAnchorPayload({ anchor_date: 'not-a-date' }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects published_at_utc with invalid timestamp', () => {
      const result = AnchorPayloadSchema.safeParse(
        makeAnchorPayload({ published_at_utc: 'invalid' }),
      );
      expect(result.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// ReplacementFieldsSchema
// ---------------------------------------------------------------------------

describe('ReplacementFieldsSchema', () => {
  describe('valid', () => {
    it('accepts an empty object {}', () => {
      const result = ReplacementFieldsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('accepts only receipt_ref', () => {
      const result = ReplacementFieldsSchema.safeParse({
        receipt_ref: 'ALTER-2026-06-14-NEWREF',
      });
      expect(result.success).toBe(true);
    });

    it('accepts only service_note', () => {
      const result = ReplacementFieldsSchema.safeParse({
        service_note: 'Updated provider details',
      });
      expect(result.success).toBe(true);
    });

    it('accepts both receipt_ref and service_note', () => {
      const result = ReplacementFieldsSchema.safeParse({
        receipt_ref: 'ALTER-2026-06-14-NEWREF',
        service_note: 'Updated provider details',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('invalid', () => {
    it('rejects an object with an extra field (strict mode)', () => {
      const result = ReplacementFieldsSchema.safeParse({ extra: 'field' });
      expect(result.success).toBe(false);
    });

    it('rejects receipt_ref too short (less than 4 chars)', () => {
      const result = ReplacementFieldsSchema.safeParse({ receipt_ref: 'ab' });
      expect(result.success).toBe(false);
    });

    it('rejects service_note as an empty string', () => {
      const result = ReplacementFieldsSchema.safeParse({ service_note: '' });
      expect(result.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// CorrectionPayloadSchema
// ---------------------------------------------------------------------------

describe('CorrectionPayloadSchema', () => {
  describe('valid', () => {
    it('accepts a full valid correction payload', () => {
      const result = CorrectionPayloadSchema.safeParse(makeCorrectionPayload());
      expect(result.success).toBe(true);
    });

    it('accepts replacement_fields: {}', () => {
      const result = CorrectionPayloadSchema.safeParse(
        makeCorrectionPayload({ replacement_fields: {} }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe('invalid', () => {
    it('rejects corrects_sequence_no: 0 (must be positive)', () => {
      const result = CorrectionPayloadSchema.safeParse(
        makeCorrectionPayload({ corrects_sequence_no: 0 }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects reason as an empty string', () => {
      const result = CorrectionPayloadSchema.safeParse(makeCorrectionPayload({ reason: '' }));
      expect(result.success).toBe(false);
    });

    it('rejects recorded_at_utc with invalid timestamp', () => {
      const result = CorrectionPayloadSchema.safeParse(
        makeCorrectionPayload({ recorded_at_utc: 'invalid' }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects replacement_fields containing amount_usdc_minor (immutable per I-11)', () => {
      const result = CorrectionPayloadSchema.safeParse(
        makeCorrectionPayload({
          replacement_fields: { amount_usdc_minor: '50000000' },
        }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects replacement_fields containing gift_card_count (immutable per I-11)', () => {
      const result = CorrectionPayloadSchema.safeParse(
        makeCorrectionPayload({
          replacement_fields: { gift_card_count: 10 },
        }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects replacement_fields containing both amount_usdc_minor and gift_card_count', () => {
      const result = CorrectionPayloadSchema.safeParse(
        makeCorrectionPayload({
          replacement_fields: { amount_usdc_minor: '50000000', gift_card_count: 10 },
        }),
      );
      expect(result.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// LedgerEventBaseSchema
// ---------------------------------------------------------------------------

describe('LedgerEventBaseSchema', () => {
  describe('valid', () => {
    it('accepts a full donation event', () => {
      const result = LedgerEventBaseSchema.safeParse(makeDonationEvent());
      expect(result.success).toBe(true);
    });

    it('accepts a full disbursement event', () => {
      const result = LedgerEventBaseSchema.safeParse(makeDisbursementEvent());
      expect(result.success).toBe(true);
    });

    it('accepts a full anchor event', () => {
      const result = LedgerEventBaseSchema.safeParse(makeAnchorEvent());
      expect(result.success).toBe(true);
    });

    it('accepts a full correction event', () => {
      const result = LedgerEventBaseSchema.safeParse(makeCorrectionEvent());
      expect(result.success).toBe(true);
    });
  });

  describe('invalid', () => {
    it('rejects event_type: "unknown_type" (not in enum)', () => {
      const result = LedgerEventBaseSchema.safeParse(
        makeDonationEvent({ event_type: 'unknown_type' }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects prev_hash with uppercase hex chars', () => {
      const result = LedgerEventBaseSchema.safeParse(
        makeDonationEvent({
          prev_hash: 'A'.repeat(32) + '0'.repeat(32),
        }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects prev_hash too short (63 chars)', () => {
      const result = LedgerEventBaseSchema.safeParse(
        makeDonationEvent({ prev_hash: '0'.repeat(63) }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects sequence_no: 0 (must be positive)', () => {
      const result = LedgerEventBaseSchema.safeParse(makeDonationEvent({ sequence_no: 0 }));
      expect(result.success).toBe(false);
    });

    it('rejects created_at_utc with invalid timestamp', () => {
      const result = LedgerEventBaseSchema.safeParse(
        makeDonationEvent({ created_at_utc: 'invalid' }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects donation_confirmed event with a disbursement payload (type mismatch)', () => {
      const result = LedgerEventBaseSchema.safeParse({
        ...makeDonationEvent(),
        payload: makeDisbursementPayload(),
      });
      expect(result.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

describe('type guards', () => {
  const donationPayload = makeDonationPayload();
  const disbursementPayload = makeDisbursementPayload();
  const anchorPayload = makeAnchorPayload();
  const correctionPayload = makeCorrectionPayload();

  it('isDonationPayload returns true for a donation payload', () => {
    expect(isDonationPayload(donationPayload)).toBe(true);
  });

  it('isDonationPayload returns false for a disbursement payload', () => {
    expect(isDonationPayload(disbursementPayload)).toBe(false);
  });

  it('isDisbursementPayload returns true for a disbursement payload', () => {
    expect(isDisbursementPayload(disbursementPayload)).toBe(true);
  });

  it('isDisbursementPayload returns false for a donation payload', () => {
    expect(isDisbursementPayload(donationPayload)).toBe(false);
  });

  it('isAnchorPayload returns true for an anchor payload', () => {
    expect(isAnchorPayload(anchorPayload)).toBe(true);
  });

  it('isCorrectionPayload returns true for a correction payload', () => {
    expect(isCorrectionPayload(correctionPayload)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseLedgerEvent
// ---------------------------------------------------------------------------

describe('parseLedgerEvent', () => {
  it('returns { ok: true } for a valid donation event', () => {
    const result = parseLedgerEvent(makeDonationEvent());
    expect(result.ok).toBe(true);
  });

  it('returns { ok: false, error } for an invalid event', () => {
    const result = parseLedgerEvent(makeDonationEvent({ created_at_utc: 'invalid' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeDefined();
      expect(result.error.issues).toBeDefined();
      expect(Array.isArray(result.error.issues)).toBe(true);
    }
  });

  it('parsed payload has correct subtype (cluster exists for donation)', () => {
    const result = parseLedgerEvent(makeDonationEvent());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.payload).toHaveProperty('cluster');
      expect(typeof result.value.payload.cluster).toBe('string');
    }
  });
});
