import type { AnchorPayload, LedgerEventBase } from "../events.js";

export const sampleAnchorPayload: AnchorPayload = {
  anchor_date: "2026-06-15",
  anchored_head_sequence_no: 5,
  anchored_head_hash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  tx_signature: "7nOpQ3456seedAnchorDevnetExampleTx",
  anchor_wallet_address: "BhKtkM1oHADwo8ap5P6Lymj7b3iaspiAm37RA9KMn8YG",
  memo_text: "ccv-anchor:a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  published_at_utc: "2026-06-16T01:00:00Z",
  cluster: "devnet",
};

export const sampleAnchorEvent: LedgerEventBase = {
  sequence_no: 6,
  event_type: "anchor_published",
  payload: sampleAnchorPayload,
  prev_hash: "0000000000000000000000000000000000000000000000000000000000000004",
  created_at_utc: "2026-06-16T01:00:00Z",
};
