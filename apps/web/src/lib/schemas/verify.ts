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

/** Base58-encoded Solana address or signature. */
const base58 = v.pipe(
  v.string(),
  v.regex(/^[1-9A-HJ-NP-Za-km-z]+$/),
);

/** Solscan transaction URL. */
const solscanUrl = v.pipe(
  v.string(),
  v.regex(/^https:\/\/solscan\.io\/tx\//),
);

/** Anchor date: YYYY-MM-DD. */
const anchorDate = v.pipe(
  v.string(),
  v.regex(/^\d{4}-\d{2}-\d{2}$/),
);

/** Anchor memo text: `ccv-anchor:` prefix + 64 hex chars. */
const memoText = v.pipe(
  v.string(),
  v.regex(/^ccv-anchor:[0-9a-f]{64}$/),
);

// ---------------------------------------------------------------------------
// LatestAnchor
// ---------------------------------------------------------------------------

export const LatestAnchorSchema = v.object({
  anchor_date: anchorDate,
  anchored_head_sequence_no: v.pipe(v.number(), v.integer(), v.minValue(0)),
  anchored_head_hash: hex64,
  tx_signature: base58,
  anchor_wallet_address: base58,
  memo_text: memoText,
  published_at_utc: timestamp,
  solscan_url: solscanUrl,
});

export type LatestAnchor = v.InferOutput<typeof LatestAnchorSchema>;

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

export const InstructionsSchema = v.object({
  typescript: v.string(),
});

export type Instructions = v.InferOutput<typeof InstructionsSchema>;

// ---------------------------------------------------------------------------
// VerifyResponse
// ---------------------------------------------------------------------------

export const VerifyResponseSchema = v.object({
  head_sequence_no: v.pipe(v.number(), v.integer(), v.minValue(0)),
  head_hash: hex64,
  latest_anchor: v.nullable(LatestAnchorSchema),
  previous_anchors: v.array(LatestAnchorSchema),
  instructions: InstructionsSchema,
  anchor_stale: v.boolean(),
});

export type VerifyResponse = v.InferOutput<typeof VerifyResponseSchema>;
