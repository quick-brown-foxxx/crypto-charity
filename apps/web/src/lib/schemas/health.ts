import * as v from 'valibot';

// ---------------------------------------------------------------------------
// HealthChecks
// ---------------------------------------------------------------------------

export const HealthChecksSchema = v.object({
  db_reachable: v.boolean(),
  anchor_stale: v.boolean(),
  anchor_wallet_low_sol: v.boolean(),
  ingest_recent_or_empty: v.boolean(),
  helius_inbox_backlog_ok: v.boolean(),
});

export type HealthChecks = v.InferOutput<typeof HealthChecksSchema>;

// ---------------------------------------------------------------------------
// HealthResponse
// ---------------------------------------------------------------------------

export const HealthResponseSchema = v.object({
  status: v.picklist(['ok', 'degraded']),
  checks: HealthChecksSchema,
});

export type HealthResponse = v.InferOutput<typeof HealthResponseSchema>;
