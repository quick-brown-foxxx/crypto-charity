import type { DisbursementPayload, LedgerEventBase } from "../events.js";

// Disbursement 1: 75 USDC to Alter service, with beneficiary ref
export const sampleDisbursement1Payload: DisbursementPayload = {
  amount_usdc_minor: "75000000", // 75 USDC
  gift_card_count: 3,
  service: "Alter",
  service_note: "Q2 2026 mental health support program",
  receipt_ref: "RCPT-2026-001",
  public_beneficiary_ref: "benpub_7G9Q2KX4N5P8R2T6",
  purchased_at_utc: "2026-06-15T09:00:00Z",
  recorded_at_utc: "2026-06-15T09:30:00Z",
  recorded_by: "operator",
};

// Disbursement 2: 30 USDC to Yasno service, no beneficiary ref
export const sampleDisbursement2Payload: DisbursementPayload = {
  amount_usdc_minor: "30000000", // 30 USDC
  gift_card_count: 1,
  service: "Yasno",
  service_note: null,
  receipt_ref: "RCPT-2026-002",
  public_beneficiary_ref: null,
  purchased_at_utc: "2026-06-15T14:00:00Z",
  recorded_at_utc: "2026-06-15T14:15:00Z",
  recorded_by: "operator",
};

// Pre-hash event base for disbursement 1 (sequence_no=4, prev_hash placeholder)
// NOTE: prev_hash must be set to the actual hash of the previous event at runtime.
// Use a placeholder that callers replace.
export const sampleDisbursement1Event: LedgerEventBase = {
  sequence_no: 4,
  event_type: "disbursement_recorded",
  payload: sampleDisbursement1Payload,
  prev_hash: "0000000000000000000000000000000000000000000000000000000000000001",
  created_at_utc: "2026-06-15T09:30:00Z",
};

// Pre-hash event base for disbursement 2 (sequence_no=5)
export const sampleDisbursement2Event: LedgerEventBase = {
  sequence_no: 5,
  event_type: "disbursement_recorded",
  payload: sampleDisbursement2Payload,
  prev_hash: "0000000000000000000000000000000000000000000000000000000000000002",
  created_at_utc: "2026-06-15T14:15:00Z",
};

export const sampleDisbursementPayloads: DisbursementPayload[] = [
  sampleDisbursement1Payload,
  sampleDisbursement2Payload,
];
