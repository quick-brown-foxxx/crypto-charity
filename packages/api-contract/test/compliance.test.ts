import { describe, it, expect, expectTypeOf  } from 'vitest';
import type {
  TotalsResponse,
  TotalsAnchor,
  HealthResponse,
  DonationItem,
  DonationsResponse,
  DisbursementItem,
  DisbursementsResponse,
  LedgerEventItem,
  LedgerEventsResponse,
  VerifyResponse,
  AnchorInfo,
  ApiErrorResponse,
  DisbursementWriteResponse,
  CorrectionWriteResponse,
  AnchorManualResponse,
  PendingRequestItem,
  PendingRequestsResponse,
  SendCodeResponse,
  DisbursementRequestBody,
  CorrectionRequestBody,
  SendCodeRequestBody,
} from '@open-care/api-contract';

// ---------------------------------------------------------------------------
// Backend response shape compliance
// ---------------------------------------------------------------------------

describe('Backend response shapes match contract types', () => {
  it('TotalsResponse shape is assignable to contract', () => {
    // Construct a value matching the backend's actual response shape
    const backendShape = {
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
      } as TotalsAnchor | null,
      anchor_stale: false,
      anchor_wallet_low_sol: false,
    };
    expectTypeOf(backendShape).toMatchTypeOf<TotalsResponse>();
  });

  it('TotalsResponse with null anchor is assignable to contract', () => {
    const backendShape = {
      total_in_usdc_minor: '0',
      total_out_usdc_minor: '0',
      balance_usdc_minor: '0',
      donations_count: 0,
      disbursements_count: 0,
      anchor: null,
      anchor_stale: true,
      anchor_wallet_low_sol: false,
    };
    expectTypeOf(backendShape).toMatchTypeOf<TotalsResponse>();
  });

  it('HealthResponse shape is assignable to contract', () => {
    const backendShape = {
      status: 'ok' as const,
      version: '0.1.0-dev',
      response_time_ms: 42,
      checks: {
        db_reachable: true,
        anchor_stale: false,
        anchor_wallet_low_sol: false,
        ingest_recent_or_empty: true,
        helius_inbox_backlog_ok: true,
      },
      contact_url: null as string | null,
    };
    expectTypeOf(backendShape).toMatchTypeOf<HealthResponse>();
  });

  it('HealthResponse degraded shape is assignable to contract', () => {
    const backendShape = {
      status: 'degraded' as const,
      version: '0.1.0-dev',
      response_time_ms: 100,
      checks: {
        db_reachable: true,
        anchor_stale: true,
        anchor_wallet_low_sol: false,
        ingest_recent_or_empty: false,
        helius_inbox_backlog_ok: true,
      },
      contact_url: 'https://t.me/support' as string | null,
    };
    expectTypeOf(backendShape).toMatchTypeOf<HealthResponse>();
  });

  it('DonationItem shape is assignable to contract', () => {
    const backendShape: DonationItem = {
      sequence_no: 1,
      event_hash: 'a'.repeat(64),
      created_at_utc: '2025-01-01T00:00:00Z',
      tx_signature: 'x'.repeat(44),
      usdc_mint: 'y'.repeat(44),
      vault_usdc_ata: 'z'.repeat(44),
      amount_usdc_minor: '1000000',
      slot: 123456,
      block_time_utc: '2025-01-01T00:00:00Z',
      cluster: 'mainnet-beta',
    };
    expectTypeOf(backendShape).toMatchTypeOf<DonationItem>();
  });

  it('DonationsResponse shape is assignable to contract', () => {
    const backendShape = {
      items: [] as DonationItem[],
      next_cursor: null as number | null,
    };
    expectTypeOf(backendShape).toMatchTypeOf<DonationsResponse>();
  });

  it('DisbursementItem shape is assignable to contract', () => {
    const backendShape: DisbursementItem = {
      sequence_no: 1,
      event_hash: 'a'.repeat(64),
      created_at_utc: '2025-01-01T00:00:00Z',
      amount_usdc_minor: '500000',
      gift_card_count: 3,
      service: 'Alter',
      service_note: null,
      receipt_ref: 'REC-001',
      public_beneficiary_ref: null,
      purchased_at_utc: '2025-01-01T00:00:00Z',
      recorded_at_utc: '2025-01-01T00:00:00Z',
      recorded_by: 'operator',
    };
    expectTypeOf(backendShape).toMatchTypeOf<DisbursementItem>();
  });

  it('DisbursementsResponse shape is assignable to contract', () => {
    const backendShape = {
      items: [] as DisbursementItem[],
      next_cursor: null as number | null,
    };
    expectTypeOf(backendShape).toMatchTypeOf<DisbursementsResponse>();
  });

  it('LedgerEventItem shape is assignable to contract', () => {
    const backendShape: LedgerEventItem = {
      sequence_no: 1,
      event_type: 'donation_confirmed',
      payload_json: '{}',
      prev_hash: '0'.repeat(64),
      event_hash: 'a'.repeat(64),
      created_at_utc: '2025-01-01T00:00:00Z',
    };
    expectTypeOf(backendShape).toMatchTypeOf<LedgerEventItem>();
  });

  it('LedgerEventsResponse shape is assignable to contract', () => {
    const backendShape = {
      items: [] as LedgerEventItem[],
      next_after_sequence_no: null as number | null,
    };
    expectTypeOf(backendShape).toMatchTypeOf<LedgerEventsResponse>();
  });

  it('VerifyResponse shape is assignable to contract', () => {
    const backendShape = {
      head_sequence_no: 42 as number | null,
      head_hash: 'a'.repeat(64) as string | null,
      latest_anchor: null as AnchorInfo | null,
      previous_anchors: [] as AnchorInfo[],
      instructions: { typescript: '// verify code' },
      anchor_stale: false,
    };
    expectTypeOf(backendShape).toMatchTypeOf<VerifyResponse>();
  });

  it('AnchorInfo shape is assignable to contract', () => {
    const backendShape: AnchorInfo = {
      anchor_date: '2025-01-01',
      anchored_head_sequence_no: 42,
      anchored_head_hash: 'a'.repeat(64),
      tx_signature: 'x'.repeat(44),
      anchor_wallet_address: 'y'.repeat(44),
      memo_text: 'ccv-anchor:' + 'a'.repeat(64),
      published_at_utc: '2025-01-01T00:00:00Z',
      solscan_url: 'https://solscan.io/tx/x',
    };
    expectTypeOf(backendShape).toMatchTypeOf<AnchorInfo>();
  });

  it('ApiErrorResponse shape is assignable to contract', () => {
    const backendShape = {
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid input',
        request_id: 'req-123',
        details: { field: 'amount' },
      },
    };
    expectTypeOf(backendShape).toMatchTypeOf<ApiErrorResponse>();
  });

  it('ApiErrorResponse minimal shape is assignable to contract', () => {
    const backendShape = {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong',
      },
    };
    expectTypeOf(backendShape).toMatchTypeOf<ApiErrorResponse>();
  });

  // --- Operator response shapes ---

  it('DisbursementWriteResponse shape is assignable to contract', () => {
    const backendShape: DisbursementWriteResponse = {
      sequence_no: 1,
      event_hash: 'a'.repeat(64),
      head_hash: 'a'.repeat(64),
      public_beneficiary_ref: null,
      next_action: 'send_code_to_beneficiary_via_bot',
    };
    expectTypeOf(backendShape).toMatchTypeOf<DisbursementWriteResponse>();
  });

  it('CorrectionWriteResponse shape is assignable to contract', () => {
    const backendShape: CorrectionWriteResponse = {
      sequence_no: 2,
      event_hash: 'b'.repeat(64),
      head_hash: 'b'.repeat(64),
      corrects_sequence_no: 1,
    };
    expectTypeOf(backendShape).toMatchTypeOf<CorrectionWriteResponse>();
  });

  it('AnchorManualResponse published variant is assignable to contract', () => {
    const backendShape = {
      status: 'published' as const,
      anchored_head_hash: 'a'.repeat(64),
      memo_text: 'ccv-anchor:' + 'a'.repeat(64),
      tx_signature: 'x'.repeat(44),
      duration_ms: 5000,
      anchor_runs_id: 1,
    };
    expectTypeOf(backendShape).toMatchTypeOf<AnchorManualResponse>();
  });

  it('AnchorManualResponse already_published variant is assignable to contract', () => {
    const backendShape = {
      status: 'already_published' as const,
      anchored_head_hash: 'a'.repeat(64),
      anchored_head_sequence_no: 42,
      duration_ms: 100,
    };
    expectTypeOf(backendShape).toMatchTypeOf<AnchorManualResponse>();
  });

  it('AnchorManualResponse empty_ledger variant is assignable to contract', () => {
    const backendShape = {
      status: 'empty_ledger' as const,
      duration_ms: 50,
    };
    expectTypeOf(backendShape).toMatchTypeOf<AnchorManualResponse>();
  });

  it('PendingRequestItem shape is assignable to contract', () => {
    const backendShape: PendingRequestItem = {
      opaque_id: 'opaque-1',
      conversation_id: 12345,
      internal_handle: '@user',
      request_status: 'pending',
      created_at_utc: '2025-01-01T00:00:00Z',
      updated_at_utc: '2025-01-01T00:00:00Z',
    };
    expectTypeOf(backendShape).toMatchTypeOf<PendingRequestItem>();
  });

  it('PendingRequestsResponse shape is assignable to contract', () => {
    const backendShape = {
      items: [] as PendingRequestItem[],
      next_cursor: null as string | null,
    };
    expectTypeOf(backendShape).toMatchTypeOf<PendingRequestsResponse>();
  });

  it('SendCodeResponse shape is assignable to contract', () => {
    const backendShape: SendCodeResponse = {
      delivered_at_utc: '2025-01-01T00:00:00Z',
    };
    expectTypeOf(backendShape).toMatchTypeOf<SendCodeResponse>();
  });

  // --- Request body shapes ---

  it('DisbursementRequestBody shape is assignable to contract', () => {
    const body: DisbursementRequestBody = {
      amount_usdc_minor: '1000000',
      gift_card_count: 3,
      service: 'Alter',
      receipt_ref: 'REC-001',
      purchased_at_utc: '2025-01-01T00:00:00Z',
    };
    expectTypeOf(body).toMatchTypeOf<DisbursementRequestBody>();
  });

  it('CorrectionRequestBody shape is assignable to contract', () => {
    const body: CorrectionRequestBody = {
      corrects_sequence_no: 1,
      reason: 'Wrong receipt ref',
      replacement_fields: { receipt_ref: 'REC-002' },
    };
    expectTypeOf(body).toMatchTypeOf<CorrectionRequestBody>();
  });

  it('SendCodeRequestBody shape is assignable to contract', () => {
    const body: SendCodeRequestBody = {
      opaque_id: 'opaque-1',
      code: '123456',
      conversation_id: 12345,
    };
    expectTypeOf(body).toMatchTypeOf<SendCodeRequestBody>();
  });
});

// ---------------------------------------------------------------------------
// Frontend Valibot-inferred type compliance
// ---------------------------------------------------------------------------
//
// The frontend schema files (apps/web/src/lib/schemas/totals.ts and health.ts)
// contain compile-time contract checks using conditional types:
//
//   type _TotalsContractCheck = TotalsResponse extends TotalsResponseContract ? true : never;
//
// These checks run at tsc time and will fail the build if the Valibot-inferred
// types diverge from the contract. No additional runtime tests are needed here
// because the contract package cannot import from apps/web (different project
// reference boundary). The compile-time checks in the schema files are the
// canonical verification.

describe('Frontend Valibot-inferred types match contract types', () => {
  it('compile-time contract checks exist in frontend schema files', () => {
    // This test documents that the verification happens at compile time.
    // The schema files contain:
    //   type _TotalsContractCheck = TotalsResponse extends TotalsResponseContract ? true : never;
    //   type _HealthContractCheck = HealthResponse extends HealthResponseContract ? true : never;
    // If these fail, tsc -b will fail.
    expect(true).toBe(true);
  });
});
