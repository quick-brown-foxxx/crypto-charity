import * as v from 'valibot';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ISO-8601 UTC timestamp with second precision and Z suffix. */
const timestamp = v.pipe(
  v.string(),
  v.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
);

/** 64-character lowercase hex string. */
const hex64 = v.pipe(
  v.string(),
  v.regex(/^[0-9a-f]{64}$/),
);

// ---------------------------------------------------------------------------
// LedgerEventItem
// ---------------------------------------------------------------------------

export const LedgerEventItemSchema = v.object({
  sequence_no: v.pipe(v.number(), v.integer(), v.minValue(1)),
  event_type: v.picklist([
    'donation_confirmed',
    'disbursement_recorded',
    'anchor_published',
    'correction_recorded',
  ]),
  payload_json: v.string(),
  prev_hash: hex64,
  event_hash: hex64,
  created_at_utc: timestamp,
});

export type LedgerEventItem = v.InferOutput<typeof LedgerEventItemSchema>;

// ---------------------------------------------------------------------------
// LedgerEventsResponse
// ---------------------------------------------------------------------------

export const LedgerEventsResponseSchema = v.object({
  items: v.array(LedgerEventItemSchema),
  next_after_sequence_no: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
});

export type LedgerEventsResponse = v.InferOutput<typeof LedgerEventsResponseSchema>;
