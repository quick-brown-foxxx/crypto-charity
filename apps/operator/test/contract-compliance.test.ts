import { exports } from 'cloudflare:workers';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  AnchorManualResponse,
  CorrectionWriteResponse,
  DisbursementItem,
  DisbursementWriteResponse,
  DisbursementsResponse,
  PendingRequestItem,
  PendingRequestsResponse,
  SendCodeResponse,
} from '@open-care/api-contract';

const VALID_TOKEN = 'test-operator-token-abc123';
const operatorWorker = (exports as unknown as { default: { fetch: typeof fetch } }).default;

function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${VALID_TOKEN}` };
}

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

function arrayField(record: Record<string, unknown>, field: string): unknown[] {
  expect(Array.isArray(record[field]), field).toBe(true);
  return record[field] as unknown[];
}

async function jsonFrom(
  response: Response,
  expectedStatus = 200,
): Promise<Record<string, unknown>> {
  expect(response.status).toBe(expectedStatus);
  return asRecord(await response.json());
}

describe('operator forwarded backend contract compliance', () => {
  /*
  Scenario: operator forwarded routes preserve downstream contract bodies
    Given mocked service bindings returning contract-shaped downstream responses
    When operator public/internal routes are called
    Then the operator body matches the forwarded contract types
  */
  it('preserves api-write disbursement and correction response contracts', async () => {
    const disbursementRecord = await jsonFrom(
      await operatorWorker.fetch('https://example.com/api/disbursements', {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_usdc_minor: '50000000', public_beneficiary_ref: null }),
      }),
      200,
    );
    expect(disbursementRecord).not.toHaveProperty('forwarded_body');
    const disbursementBody = {
      sequence_no: numberField(disbursementRecord, 'sequence_no'),
      event_hash: stringField(disbursementRecord, 'event_hash'),
      head_hash: stringField(disbursementRecord, 'head_hash'),
      public_beneficiary_ref: nullableStringField(disbursementRecord, 'public_beneficiary_ref'),
      next_action: stringField(disbursementRecord, 'next_action'),
    } satisfies DisbursementWriteResponse;
    expectTypeOf(disbursementBody).toMatchTypeOf<DisbursementWriteResponse>();

    const correctionRecord = await jsonFrom(
      await operatorWorker.fetch('https://example.com/api/corrections', {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ corrects_sequence_no: 7 }),
      }),
    );
    const correctionBody = {
      sequence_no: numberField(correctionRecord, 'sequence_no'),
      event_hash: stringField(correctionRecord, 'event_hash'),
      head_hash: stringField(correctionRecord, 'head_hash'),
      corrects_sequence_no: numberField(correctionRecord, 'corrects_sequence_no'),
    } satisfies CorrectionWriteResponse;
    expect(correctionBody.corrects_sequence_no).toBe(7);
    expectTypeOf(correctionBody).toMatchTypeOf<CorrectionWriteResponse>();
  });

  it('preserves api-read and anchor-cron response contracts', async () => {
    const readRecord = await jsonFrom(
      await operatorWorker.fetch('https://example.com/api/disbursements'),
    );
    const readItems = arrayField(readRecord, 'items');
    expect(readItems).toHaveLength(0);
    const readBody = {
      items: [] as DisbursementItem[],
      next_cursor: nullableNumberField(readRecord, 'next_cursor'),
    } satisfies DisbursementsResponse;
    expectTypeOf(readBody).toMatchTypeOf<DisbursementsResponse>();

    const anchorRecord = await jsonFrom(
      await operatorWorker.fetch('https://example.com/api/anchor/manual', {
        method: 'POST',
        headers: authHeader(),
      }),
    );
    const anchorBody = {
      status: 'empty_ledger',
      duration_ms: numberField(anchorRecord, 'duration_ms'),
    } satisfies AnchorManualResponse;
    expect(anchorRecord.status).toBe(anchorBody.status);
    expectTypeOf(anchorBody).toMatchTypeOf<AnchorManualResponse>();
  });

  it('preserves tg-bot internal response contracts', async () => {
    const pendingRecord = await jsonFrom(
      await operatorWorker.fetch('https://example.com/tg/internal/pending-requests', {
        headers: authHeader(),
      }),
    );
    const pendingItems = arrayField(pendingRecord, 'items');
    expect(pendingItems).toHaveLength(0);
    const pendingBody = {
      items: [] as PendingRequestItem[],
      next_cursor: nullableStringField(pendingRecord, 'next_cursor'),
    } satisfies PendingRequestsResponse;
    expectTypeOf(pendingBody).toMatchTypeOf<PendingRequestsResponse>();

    const sendCodeRecord = await jsonFrom(
      await operatorWorker.fetch('https://example.com/tg/internal/send-code', {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ opaque_id: 'opaque-1', code: 'CODE', conversation_id: 1 }),
      }),
    );
    const sendCodeBody = {
      delivered_at_utc: stringField(sendCodeRecord, 'delivered_at_utc'),
    } satisfies SendCodeResponse;
    expectTypeOf(sendCodeBody).toMatchTypeOf<SendCodeResponse>();
  });
});
