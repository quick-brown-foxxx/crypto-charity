import * as v from 'valibot';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ISO-8601 UTC timestamp with second precision and Z suffix. */
const timestamp = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/));

/** USDC minor-unit amount: 1–16 digit integer string. */
const usdcMinor = v.pipe(v.string(), v.regex(/^[0-9]{1,16}$/));

/** 64-character lowercase hex string. */
const hex64 = v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/));

/** Base58-encoded Solana address or signature. */
const base58 = v.pipe(v.string(), v.regex(/^[1-9A-HJ-NP-Za-km-z]+$/));

/** Solscan transaction URL. */
const solscanUrl = v.pipe(v.string(), v.regex(/^https:\/\/solscan\.io\/tx\//));

// ---------------------------------------------------------------------------
// AnchorInfo
// ---------------------------------------------------------------------------

export const AnchorInfoSchema = v.object({
  anchored_head_hash: hex64,
  published_at_utc: timestamp,
  tx_signature: base58,
  anchor_wallet_address: base58,
  solscan_url: solscanUrl,
});

export type AnchorInfo = v.InferOutput<typeof AnchorInfoSchema>;

// ---------------------------------------------------------------------------
// TotalsResponse
// ---------------------------------------------------------------------------

export const TotalsResponseSchema = v.object({
  total_in_usdc_minor: usdcMinor,
  total_out_usdc_minor: usdcMinor,
  balance_usdc_minor: usdcMinor,
  donations_count: v.pipe(v.number(), v.integer(), v.minValue(0)),
  disbursements_count: v.pipe(v.number(), v.integer(), v.minValue(0)),
  anchor: v.nullable(AnchorInfoSchema),
  anchor_stale: v.boolean(),
  anchor_wallet_low_sol: v.boolean(),
});

export type TotalsResponse = v.InferOutput<typeof TotalsResponseSchema>;
