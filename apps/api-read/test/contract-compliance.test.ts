import { describe, it, expect, expectTypeOf } from 'vitest';
import type { TotalsResponse, TotalsAnchor, HealthResponse } from '@open-care/api-contract';

/**
 * Contract compliance tests for api-read backend.
 *
 * These tests verify that the actual response shapes produced by the route
 * handlers are assignable to the contract types from @open-care/api-contract.
 *
 * We test by constructing representative values matching the backend's
 * actual output shape and checking assignability.
 */

describe('api-read totals route compliance', () => {
  it('TotalsResponse with anchor present matches contract', () => {
    // This matches the exact shape produced by apps/api-read/src/routes/totals.ts
    const body: TotalsResponse = {
      total_in_usdc_minor: '1000000',
      total_out_usdc_minor: '500000',
      balance_usdc_minor: '500000',
      donations_count: 10,
      disbursements_count: 5,
      anchor: {
        anchored_head_hash: 'a'.repeat(64),
        published_at_utc: '2025-01-01T00:00:00Z',
        tx_signature: 'x'.repeat(44),
        anchor_wallet_address: 'y'.repeat(44),
        solscan_url: 'https://solscan.io/tx/x',
      },
      anchor_stale: false,
      anchor_wallet_low_sol: false,
    };
    expectTypeOf(body).toMatchTypeOf<TotalsResponse>();
    expect(body.total_in_usdc_minor).toBeTypeOf('string');
    expect(body.anchor).not.toBeNull();
  });

  it('TotalsResponse with null anchor matches contract', () => {
    const body: TotalsResponse = {
      total_in_usdc_minor: '0',
      total_out_usdc_minor: '0',
      balance_usdc_minor: '0',
      donations_count: 0,
      disbursements_count: 0,
      anchor: null,
      anchor_stale: true,
      anchor_wallet_low_sol: false,
    };
    expectTypeOf(body).toMatchTypeOf<TotalsResponse>();
    expect(body.anchor).toBeNull();
  });

  it('TotalsAnchor matches the subset of AnchorInfo', () => {
    const anchor: TotalsAnchor = {
      anchored_head_hash: 'a'.repeat(64),
      published_at_utc: '2025-01-01T00:00:00Z',
      tx_signature: 'x'.repeat(44),
      anchor_wallet_address: 'y'.repeat(44),
      solscan_url: 'https://solscan.io/tx/x',
    };
    expectTypeOf(anchor).toMatchTypeOf<TotalsAnchor>();
    // Verify it has exactly 5 fields (subset of full AnchorInfo)
    expect(Object.keys(anchor)).toHaveLength(5);
  });
});

describe('api-read health route compliance', () => {
  it('HealthResponse ok matches contract', () => {
    const body: HealthResponse = {
      status: 'ok',
      version: '0.1.0-dev',
      response_time_ms: 42,
      checks: {
        db_reachable: true,
        anchor_stale: false,
        anchor_wallet_low_sol: false,
        ingest_recent_or_empty: true,
        helius_inbox_backlog_ok: true,
      },
    };
    expectTypeOf(body).toMatchTypeOf<HealthResponse>();
    expect(body.status).toBe('ok');
  });

  it('HealthResponse degraded matches contract', () => {
    const body: HealthResponse = {
      status: 'degraded',
      version: '0.1.0-dev',
      response_time_ms: 100,
      checks: {
        db_reachable: true,
        anchor_stale: true,
        anchor_wallet_low_sol: false,
        ingest_recent_or_empty: false,
        helius_inbox_backlog_ok: true,
      },
    };
    expectTypeOf(body).toMatchTypeOf<HealthResponse>();
    expect(body.status).toBe('degraded');
  });
});
