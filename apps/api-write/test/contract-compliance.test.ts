import { SELF } from 'cloudflare:test';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  CorrectionWriteResponse,
  DisbursementWriteResponse,
} from '@open-care/api-contract';

function validDisbursementBody(receiptRef: string): Record<string, unknown> {
  return {
    amount_usdc_minor: '50000000',
    gift_card_count: 2,
    service: 'Alter',
    service_note: null,
    receipt_ref: receiptRef,
    purchased_at_utc: '2026-06-14T10:23:00Z',
  };
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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

async function expectDisbursementWriteResponse(response: Response): Promise<DisbursementWriteResponse> {
  expect(response.status).toBe(200);
  const record = asRecord(await response.json());
  const body = {
    sequence_no: numberField(record, 'sequence_no'),
    event_hash: stringField(record, 'event_hash'),
    head_hash: stringField(record, 'head_hash'),
    public_beneficiary_ref: nullableStringField(record, 'public_beneficiary_ref'),
    next_action: stringField(record, 'next_action'),
  } satisfies DisbursementWriteResponse;

  expectTypeOf(body).toMatchTypeOf<DisbursementWriteResponse>();
  return body;
}

async function expectCorrectionWriteResponse(response: Response): Promise<CorrectionWriteResponse> {
  expect(response.status).toBe(200);
  const record = asRecord(await response.json());
  const body = {
    sequence_no: numberField(record, 'sequence_no'),
    event_hash: stringField(record, 'event_hash'),
    head_hash: stringField(record, 'head_hash'),
    corrects_sequence_no: numberField(record, 'corrects_sequence_no'),
  } satisfies CorrectionWriteResponse;

  expectTypeOf(body).toMatchTypeOf<CorrectionWriteResponse>();
  return body;
}

describe('api-write backend contract compliance', () => {
  /*
  Scenario: api-write write endpoints return contract-shaped responses
    Given valid write requests against test DB state
    When real write endpoints are called
    Then success JSON bodies match write response contracts
  */
  it('returns real write contract bodies for disbursements and corrections', async () => {
    const disbursement = await expectDisbursementWriteResponse(
      await postJson('/api/disbursements', validDisbursementBody('ALTER-2026-06-14-COMP01')),
    );

    expect(disbursement.event_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(disbursement.head_hash).toBe(disbursement.event_hash);
    expect(disbursement.next_action).toBe('send_code_to_beneficiary_via_bot');

    // Corrections must target an event below the current head, so append a
    // second event before correcting the first disbursement.
    await expectDisbursementWriteResponse(
      await postJson('/api/disbursements', validDisbursementBody('ALTER-2026-06-14-COMP03')),
    );

    const correction = await expectCorrectionWriteResponse(
      await postJson('/api/corrections', {
        corrects_sequence_no: disbursement.sequence_no,
        replacement_fields: { receipt_ref: 'ALTER-2026-06-14-COMP02' },
        reason: 'Backend contract compliance correction',
      }),
    );

    expect(correction.corrects_sequence_no).toBe(disbursement.sequence_no);
    expect(correction.event_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(correction.head_hash).toBe(correction.event_hash);
  });
});
