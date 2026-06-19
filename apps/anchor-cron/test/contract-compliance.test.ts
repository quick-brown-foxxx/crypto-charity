import { env, SELF } from 'cloudflare:test';
import { createVaultDb } from '@open-care/vault-db';
import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import type { AnchorManualResponse } from '@open-care/api-contract';
import { postManualAnchor } from './helpers.js';
import { cleanTables, seedLedgerEvent } from './seed.js';

function asRecord(value: unknown): Record<string, unknown> {
  expect(value).toBeTypeOf('object');
  expect(value).not.toBeNull();
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, field: string): string {
  expect(record[field], field).toBeTypeOf('string');
  return record[field] as string;
}

function numberField(record: Record<string, unknown>, field: string): number {
  expect(record[field], field).toBeTypeOf('number');
  return record[field] as number;
}

function anchorManualResponse(value: unknown): AnchorManualResponse {
  const record = asRecord(value);
  const status = stringField(record, 'status');

  if (status === 'published') {
    const body = {
      status,
      anchored_head_hash: stringField(record, 'anchored_head_hash'),
      memo_text: stringField(record, 'memo_text'),
      tx_signature: stringField(record, 'tx_signature'),
      duration_ms: numberField(record, 'duration_ms'),
      anchor_runs_id: numberField(record, 'anchor_runs_id'),
    } satisfies AnchorManualResponse;
    return body;
  }

  if (status === 'already_published') {
    const body = {
      status,
      anchored_head_hash: stringField(record, 'anchored_head_hash'),
      anchored_head_sequence_no: numberField(record, 'anchored_head_sequence_no'),
      duration_ms: numberField(record, 'duration_ms'),
    } satisfies AnchorManualResponse;
    return body;
  }

  expect(status).toBe('empty_ledger');
  const body = {
    status: 'empty_ledger',
    duration_ms: numberField(record, 'duration_ms'),
  } satisfies AnchorManualResponse;
  return body;
}

describe('anchor-cron backend contract compliance', () => {
  beforeEach(async () => {
    await cleanTables();
  });

  /*
  Scenario: anchor-cron manual trigger returns a contract variant
    Given a test ledger state
    When the real manual endpoint is posted
    Then the response body matches an AnchorManualResponse variant
  */
  it('returns a real AnchorManualResponse variant from POST /api/anchor/manual', async () => {
    const db = createVaultDb((env as unknown as { vault_db: D1Database }).vault_db);
    await seedLedgerEvent(db);

    const response = await SELF.fetch(postManualAnchor());
    expect(response.status).toBe(200);
    const body = anchorManualResponse(await response.json());

    expect(body.status).toBe('published');
    expectTypeOf(body).toMatchTypeOf<AnchorManualResponse>();
  });
});
