import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ApiErrorResponse } from '@open-care/api-contract';
import worker from '../src/index.js';
import type { Env as IngestEnv } from '../src/lib/env.js';

function asRecord(value: unknown): Record<string, unknown> {
  expect(value).toBeTypeOf('object');
  expect(value).not.toBeNull();
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, field: string): string {
  expect(record[field], field).toBeTypeOf('string');
  return record[field] as string;
}

function optionalStringField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  expect(value === undefined || typeof value === 'string', field).toBe(true);
  return value as string | undefined;
}

describe('ingest backend contract compliance', () => {
  /*
  Scenario: ingest has no endpoint-specific success contracts
    Given an invalid ingest webhook request
    When the real ingest route returns an error
    Then that body matches shared ApiErrorResponse; success webhook ACK bodies are not contract-tested because api-contract defines no ingest success response types
  */
  it('returns a real shared ApiErrorResponse for an invalid webhook request', async () => {
    const ingestEnv = env as unknown as IngestEnv;
    ingestEnv.HELIUS_WEBHOOK_AUTH_HEADER = 'contract-test-secret';

    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request('https://staging.open-care.org/webhook/helius', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([]),
      }),
      ingestEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(401);
    const record = asRecord(await response.json());
    const error = asRecord(record.error);
    const requestId = optionalStringField(error, 'request_id');
    const body = {
      error: {
        code: stringField(error, 'code'),
        message: stringField(error, 'message'),
        ...(requestId === undefined ? {} : { request_id: requestId }),
      },
    } satisfies ApiErrorResponse;

    expect(body.error.code).toBe('UNAUTHORIZED');
    expectTypeOf(body).toMatchTypeOf<ApiErrorResponse>();
  });
});
