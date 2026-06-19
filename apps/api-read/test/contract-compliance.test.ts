import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import type {
  AnchorInfo,
  DisbursementItem,
  DisbursementsResponse,
  DonationItem,
  DonationsResponse,
  HealthResponse,
  LedgerEventItem,
  LedgerEventsResponse,
  TotalsAnchor,
  TotalsResponse,
  VerifyResponse,
} from '@open-care/api-contract';
import { seedPublishedAnchor, seedTestData } from './seed.js';

function asRecord(value: unknown): Record<string, unknown> {
  expect(value).toBeTypeOf('object');
  expect(value).not.toBeNull();
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, field: string): string {
  expect(record[field], field).toBeTypeOf('string');
  return record[field] as string;
}

function nullableStringField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  expect(value === null || typeof value === 'string', field).toBe(true);
  return value as string | null;
}

function numberField(record: Record<string, unknown>, field: string): number {
  expect(record[field], field).toBeTypeOf('number');
  return record[field] as number;
}

function nullableNumberField(record: Record<string, unknown>, field: string): number | null {
  const value = record[field];
  expect(value === null || typeof value === 'number', field).toBe(true);
  return value as number | null;
}

function booleanField(record: Record<string, unknown>, field: string): boolean {
  expect(record[field], field).toBeTypeOf('boolean');
  return record[field] as boolean;
}

function arrayField(record: Record<string, unknown>, field: string): unknown[] {
  expect(Array.isArray(record[field]), field).toBe(true);
  return record[field] as unknown[];
}

function maybeTotalsAnchor(value: unknown): TotalsAnchor | null {
  if (value === null) return null;
  const record = asRecord(value);
  const anchor = {
    anchored_head_hash: stringField(record, 'anchored_head_hash'),
    published_at_utc: stringField(record, 'published_at_utc'),
    tx_signature: stringField(record, 'tx_signature'),
    anchor_wallet_address: stringField(record, 'anchor_wallet_address'),
    solscan_url: stringField(record, 'solscan_url'),
  } satisfies TotalsAnchor;
  return anchor;
}

function donationItem(value: unknown): DonationItem {
  const record = asRecord(value);
  const item = {
    sequence_no: numberField(record, 'sequence_no'),
    event_hash: stringField(record, 'event_hash'),
    created_at_utc: stringField(record, 'created_at_utc'),
    tx_signature: stringField(record, 'tx_signature'),
    usdc_mint: stringField(record, 'usdc_mint'),
    vault_usdc_ata: stringField(record, 'vault_usdc_ata'),
    amount_usdc_minor: stringField(record, 'amount_usdc_minor'),
    slot: numberField(record, 'slot'),
    block_time_utc: stringField(record, 'block_time_utc'),
    cluster: stringField(record, 'cluster'),
  } satisfies DonationItem;
  return item;
}

function disbursementItem(value: unknown): DisbursementItem {
  const record = asRecord(value);
  const item = {
    sequence_no: numberField(record, 'sequence_no'),
    event_hash: stringField(record, 'event_hash'),
    created_at_utc: stringField(record, 'created_at_utc'),
    amount_usdc_minor: stringField(record, 'amount_usdc_minor'),
    gift_card_count: numberField(record, 'gift_card_count'),
    service: stringField(record, 'service'),
    service_note: nullableStringField(record, 'service_note'),
    receipt_ref: stringField(record, 'receipt_ref'),
    public_beneficiary_ref: nullableStringField(record, 'public_beneficiary_ref'),
    purchased_at_utc: stringField(record, 'purchased_at_utc'),
    recorded_at_utc: stringField(record, 'recorded_at_utc'),
    recorded_by: stringField(record, 'recorded_by'),
  } satisfies DisbursementItem;
  return item;
}

function ledgerEventItem(value: unknown): LedgerEventItem {
  const record = asRecord(value);
  const item = {
    sequence_no: numberField(record, 'sequence_no'),
    event_type: stringField(record, 'event_type'),
    payload_json: stringField(record, 'payload_json'),
    prev_hash: stringField(record, 'prev_hash'),
    event_hash: stringField(record, 'event_hash'),
    created_at_utc: stringField(record, 'created_at_utc'),
  } satisfies LedgerEventItem;
  return item;
}

function anchorInfo(value: unknown): AnchorInfo {
  const record = asRecord(value);
  const anchor = {
    anchor_date: stringField(record, 'anchor_date'),
    anchored_head_sequence_no: numberField(record, 'anchored_head_sequence_no'),
    anchored_head_hash: stringField(record, 'anchored_head_hash'),
    tx_signature: stringField(record, 'tx_signature'),
    anchor_wallet_address: stringField(record, 'anchor_wallet_address'),
    memo_text: stringField(record, 'memo_text'),
    published_at_utc: stringField(record, 'published_at_utc'),
    solscan_url: stringField(record, 'solscan_url'),
  } satisfies AnchorInfo;
  return anchor;
}

function nullableAnchorInfo(value: unknown): AnchorInfo | null {
  return value === null ? null : anchorInfo(value);
}

async function responseJson(response: Response): Promise<unknown> {
  expect(response.status).toBe(200);
  return response.json();
}

describe('api-read backend contract compliance', () => {
  beforeAll(async () => {
    const db = await seedTestData();
    await seedPublishedAnchor(db);
  });

  /*
  Scenario: api-read public endpoints return bodies assignable to their contract types
    Given seeded/readable Worker state with a published anchor
    When real public API endpoints are requested
    Then returned JSON has the contract fields and type-level assertions bind it to the corresponding api-contract response type
  */
  it('returns a real TotalsResponse body from GET /api/totals', async () => {
    const record = asRecord(await responseJson(await SELF.fetch('https://example.com/api/totals')));
    const body = {
      total_in_usdc_minor: stringField(record, 'total_in_usdc_minor'),
      total_out_usdc_minor: stringField(record, 'total_out_usdc_minor'),
      balance_usdc_minor: stringField(record, 'balance_usdc_minor'),
      donations_count: numberField(record, 'donations_count'),
      disbursements_count: numberField(record, 'disbursements_count'),
      anchor: maybeTotalsAnchor(record.anchor),
      anchor_stale: booleanField(record, 'anchor_stale'),
      anchor_wallet_low_sol: booleanField(record, 'anchor_wallet_low_sol'),
    } satisfies TotalsResponse;

    expectTypeOf(body).toMatchTypeOf<TotalsResponse>();
    expect(body.anchor).not.toBeNull();
  });

  it('returns a real DonationsResponse body from GET /api/donations', async () => {
    const record = asRecord(
      await responseJson(await SELF.fetch('https://example.com/api/donations')),
    );
    const body = {
      items: arrayField(record, 'items').map(donationItem),
      next_cursor: nullableNumberField(record, 'next_cursor'),
    } satisfies DonationsResponse;

    expect(body.items.length).toBeGreaterThan(0);
    expectTypeOf(body).toMatchTypeOf<DonationsResponse>();
  });

  it('returns a real DisbursementsResponse body from GET /api/disbursements', async () => {
    const record = asRecord(
      await responseJson(await SELF.fetch('https://example.com/api/disbursements')),
    );
    const body = {
      items: arrayField(record, 'items').map(disbursementItem),
      next_cursor: nullableNumberField(record, 'next_cursor'),
    } satisfies DisbursementsResponse;

    expect(body.items.length).toBeGreaterThan(0);
    expectTypeOf(body).toMatchTypeOf<DisbursementsResponse>();
  });

  it('returns a real LedgerEventsResponse body from GET /api/ledger-events', async () => {
    const record = asRecord(
      await responseJson(await SELF.fetch('https://example.com/api/ledger-events')),
    );
    const body = {
      items: arrayField(record, 'items').map(ledgerEventItem),
      next_after_sequence_no: nullableNumberField(record, 'next_after_sequence_no'),
    } satisfies LedgerEventsResponse;

    expect(body.items.length).toBeGreaterThan(0);
    expectTypeOf(body).toMatchTypeOf<LedgerEventsResponse>();
  });

  it('returns a real VerifyResponse body from GET /api/verify', async () => {
    const record = asRecord(await responseJson(await SELF.fetch('https://example.com/api/verify')));
    const instructions = asRecord(record.instructions);
    const body = {
      head_sequence_no: nullableNumberField(record, 'head_sequence_no'),
      head_hash: nullableStringField(record, 'head_hash'),
      latest_anchor: nullableAnchorInfo(record.latest_anchor),
      previous_anchors: arrayField(record, 'previous_anchors').map(anchorInfo),
      instructions: { typescript: stringField(instructions, 'typescript') },
      anchor_stale: booleanField(record, 'anchor_stale'),
    } satisfies VerifyResponse;

    expect(body.latest_anchor).not.toBeNull();
    expect(body.previous_anchors.length).toBeGreaterThan(0);
    expectTypeOf(body).toMatchTypeOf<VerifyResponse>();
  });

  it('returns a real HealthResponse body from GET /api/health', async () => {
    const record = asRecord(await responseJson(await SELF.fetch('https://example.com/api/health')));
    const checks = asRecord(record.checks);
    const body = {
      status: stringField(record, 'status') as HealthResponse['status'],
      version: stringField(record, 'version'),
      response_time_ms: numberField(record, 'response_time_ms'),
      checks: {
        db_reachable: booleanField(checks, 'db_reachable'),
        anchor_stale: booleanField(checks, 'anchor_stale'),
        anchor_wallet_low_sol: booleanField(checks, 'anchor_wallet_low_sol'),
        ingest_recent_or_empty: booleanField(checks, 'ingest_recent_or_empty'),
        helius_inbox_backlog_ok: booleanField(checks, 'helius_inbox_backlog_ok'),
      },
      contact_url: nullableStringField(record, 'contact_url'),
    } satisfies HealthResponse;

    expect(['ok', 'degraded']).toContain(body.status);
    expectTypeOf(body).toMatchTypeOf<HealthResponse>();
  });
});
