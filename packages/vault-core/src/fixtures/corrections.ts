import type { CorrectionPayload, LedgerEventBase } from "../events.js";

export const sampleCorrectionPayload: CorrectionPayload = {
  corrects_sequence_no: 4,
  reason: "Receipt reference was incorrect; updated after vendor confirmation",
  replacement_fields: {
    receipt_ref: "RCPT-2026-001-CORRECTED",
  },
  recorded_at_utc: "2026-06-16T10:00:00Z",
  recorded_by: "operator",
};

export const sampleCorrectionEvent: LedgerEventBase = {
  sequence_no: 7,
  event_type: "correction_recorded",
  payload: sampleCorrectionPayload,
  prev_hash: "0000000000000000000000000000000000000000000000000000000000000003",
  created_at_utc: "2026-06-16T10:00:00Z",
};
