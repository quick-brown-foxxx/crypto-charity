import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { SELF } from 'cloudflare:test';
import type {
  PendingRequestItem,
  PendingRequestsResponse,
  SendCodeResponse,
} from '@open-care/api-contract';
import {
  createCardRequestConversation,
  createTelegramApiMock,
  registerUser,
  sendCodeRequest,
} from './helpers.js';

const telegramApi = createTelegramApiMock();

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

function arrayField(record: Record<string, unknown>, field: string): unknown[] {
  expect(Array.isArray(record[field]), field).toBe(true);
  return record[field] as unknown[];
}

function pendingRequestItem(value: unknown): PendingRequestItem {
  const record = asRecord(value);
  const item = {
    opaque_id: stringField(record, 'opaque_id'),
    conversation_id: numberField(record, 'conversation_id'),
    internal_handle: stringField(record, 'internal_handle'),
    request_status: stringField(record, 'request_status'),
    created_at_utc: stringField(record, 'created_at_utc'),
    updated_at_utc: stringField(record, 'updated_at_utc'),
  } satisfies PendingRequestItem;
  return item;
}

describe('tg-bot backend contract compliance', () => {
  beforeEach(() => {
    telegramApi.setupSuccess();
  });

  afterEach(() => {
    telegramApi.restore();
  });

  /*
  Scenario: tg-bot internal endpoints return contract-shaped pending/send-code responses
    Given real bot test fixtures
    When pending requests and send-code internal endpoints are called
    Then their bodies match PendingRequestsResponse/SendCodeResponse
  */
  it('returns real PendingRequestsResponse and SendCodeResponse bodies', async () => {
    const userId = 490001;
    const opaqueId = await registerUser(userId, 'contract_user');
    const conversationId = await createCardRequestConversation(userId);

    const pendingResponse = await SELF.fetch('https://example.com/tg/internal/pending-requests');
    expect(pendingResponse.status).toBe(200);
    const pendingRecord = asRecord(await pendingResponse.json());
    const pendingBody = {
      items: arrayField(pendingRecord, 'items').map(pendingRequestItem),
      next_cursor: nullableStringField(pendingRecord, 'next_cursor'),
    } satisfies PendingRequestsResponse;

    expect(pendingBody.items.some((item) => item.opaque_id === opaqueId)).toBe(true);
    expectTypeOf(pendingBody).toMatchTypeOf<PendingRequestsResponse>();

    const sendCodeResponse = await sendCodeRequest({
      opaque_id: opaqueId,
      code: 'GIFT-CONTRACT-9001',
      conversation_id: conversationId,
    });
    expect(sendCodeResponse.status).toBe(200);
    const sendCodeRecord = asRecord(await sendCodeResponse.json());
    const sendCodeBody = {
      delivered_at_utc: stringField(sendCodeRecord, 'delivered_at_utc'),
    } satisfies SendCodeResponse;

    expect(sendCodeBody.delivered_at_utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expectTypeOf(sendCodeBody).toMatchTypeOf<SendCodeResponse>();
  });
});
