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

/** Base58-encoded Solana address or signature. */
const base58 = v.pipe(
  v.string(),
  v.regex(/^[1-9A-HJ-NP-Za-km-z]+$/),
);

// ---------------------------------------------------------------------------
// DonationItem
// ---------------------------------------------------------------------------

export const DonationItemSchema = v.object({
  sequence_no: v.pipe(v.number(), v.integer(), v.minValue(1)),
  amount_usdc_minor: usdcMinor,
  tx_signature: base58,
  usdc_mint: base58,
  vault_usdc_ata: base58,
  block_time_utc: timestamp,
});

export type DonationItem = v.InferOutput<typeof DonationItemSchema>;

// ---------------------------------------------------------------------------
// DonationsResponse
// ---------------------------------------------------------------------------

export const DonationsResponseSchema = v.object({
  items: v.array(DonationItemSchema),
  next_cursor: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
});

export type DonationsResponse = v.InferOutput<typeof DonationsResponseSchema>;
