export interface HealthChecks {
  db_reachable: boolean;
  anchor_stale: boolean;
  anchor_wallet_low_sol: boolean;
  ingest_recent_or_empty: boolean;
  helius_inbox_backlog_ok: boolean;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  response_time_ms: number;
  checks: HealthChecks;
  contact_url: string | null;
}
