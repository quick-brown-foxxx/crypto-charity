import * as v from 'valibot';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ISO-8601 UTC timestamp with second precision and Z suffix. */
const timestamp = v.pipe(
  v.string(),
  v.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
);

/** USDC minor-unit amount: 1–16 digit integer string. */
const usdcMinor = v.pipe(
  v.string(),
  v.regex(/^[0-9]{1,16}$/),
);

/** Public beneficiary reference: `benpub_` prefix + 16 uppercase base32 chars. */
const publicBeneficiaryRef = v.pipe(
  v.string(),
  v.regex(/^benpub_[A-Z0-9]{16}$/),
);

/** Receipt reference: 4–64 alphanumeric or hyphen characters. */
const receiptRef = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9-]{4,64}$/),
);

// ---------------------------------------------------------------------------
// DisbursementItem
// ---------------------------------------------------------------------------

export const DisbursementItemSchema = v.object({
  sequence_no: v.pipe(v.number(), v.integer(), v.minValue(1)),
  amount_usdc_minor: usdcMinor,
  gift_card_count: v.pipe(v.number(), v.integer(), v.minValue(1)),
  service: v.picklist(['Alter', 'Yasno', 'Zigmund', 'Other']),
  service_note: v.nullable(v.string()),
  receipt_ref: receiptRef,
  public_beneficiary_ref: v.nullable(publicBeneficiaryRef),
  purchased_at_utc: timestamp,
  recorded_at_utc: timestamp,
});

export type DisbursementItem = v.InferOutput<typeof DisbursementItemSchema>;

// ---------------------------------------------------------------------------
// DisbursementsResponse
// ---------------------------------------------------------------------------

export const DisbursementsResponseSchema = v.object({
  items: v.array(DisbursementItemSchema),
  next_cursor: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
});

export type DisbursementsResponse = v.InferOutput<typeof DisbursementsResponseSchema>;
