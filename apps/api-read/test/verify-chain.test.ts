import { describe, it, expect, beforeAll } from 'vitest';
import { SELF } from 'cloudflare:test';
import { getHead } from '@open-care/vault-db';
import { seedTestData } from './seed.js';
import { fetchAllLedgerEvents, verifyChainFromApi } from '../../../test/verify/verify-chain.js';
import type { VaultDb } from '@open-care/vault-db';
import type { FetchLike, PublicLedgerEvent } from '../../../test/verify/verify-chain.js';

function ledgerEvent(sequenceNo: number): PublicLedgerEvent {
  return {
    sequence_no: sequenceNo,
    event_type: 'donation_confirmed',
    payload_json: '{}',
    payload: {},
    prev_hash: '0'.repeat(64),
    event_hash: '1'.repeat(64),
    created_at_utc: '2026-01-01T00:00:00.000Z',
  };
}

function fetchPages(pages: unknown[]): FetchLike {
  let pageIndex = 0;
  return () => {
    const page = pages[pageIndex];
    pageIndex += 1;
    if (page === undefined) {
      return Promise.reject(new Error('No fake ledger-events page left'));
    }
    return Promise.resolve(
      new Response(JSON.stringify(page), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
}

describe('public ledger chain verifier', () => {
  let expectedHeadHash: string;
  let expectedHeadSequenceNo: number;

  beforeAll(async () => {
    const db: VaultDb = await seedTestData();
    const head = await getHead(db);
    if (!head) {
      throw new Error('Expected seeded ledger to have a head');
    }
    expectedHeadHash = head.event_hash;
    expectedHeadSequenceNo = head.sequence_no;
  });

  /*
  Scenario: Verifier recomputes a seeded public ledger chain
    Given the read API has seeded ledger events
    When reusable verifier logic fetches `/api/ledger-events`
    Then each event hash is recomputed from canonical JSON
    And each `prev_hash` matches the previous event hash
    And the computed head hash equals the expected seeded head hash
  */
  it('recomputes event hashes and verifies chain links from the read API', async () => {
    const fetchFromSelf: FetchLike = (input, init) => SELF.fetch(input, init);
    const result = await verifyChainFromApi({
      baseUrl: 'https://example.com',
      fetchFn: fetchFromSelf,
    });

    expect(result.ok).toBe(true);
    expect(result.computedHeadHash).toBe(expectedHeadHash);
    expect(result.computedHeadSequenceNo).toBe(expectedHeadSequenceNo);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'event hashes recompute', status: 'pass' }),
        expect.objectContaining({ name: 'chain links verify', status: 'pass' }),
        expect.objectContaining({ name: 'verify head hash matches ledger', status: 'pass' }),
      ]),
    );
  });

  it('fails clearly when the ledger-events cursor does not advance', async () => {
    const fetchFn = fetchPages([
      { items: [ledgerEvent(1)], next_after_sequence_no: 1 },
      { items: [ledgerEvent(2)], next_after_sequence_no: 1 },
    ]);

    await expect(fetchAllLedgerEvents('https://example.com', fetchFn, 1)).rejects.toThrow(
      '/api/ledger-events returned non-advancing next_after_sequence_no 1 after cursor 1',
    );
  });

  it('fails clearly when an empty ledger-events page returns a cursor', async () => {
    const fetchFn = fetchPages([{ items: [], next_after_sequence_no: 1 }]);

    await expect(fetchAllLedgerEvents('https://example.com', fetchFn, 1)).rejects.toThrow(
      '/api/ledger-events returned next_after_sequence_no with an empty page',
    );
  });

  it('fails clearly when the ledger-events cursor points ahead of the returned page', async () => {
    const fetchFn = fetchPages([
      { items: [ledgerEvent(1), ledgerEvent(2)], next_after_sequence_no: 3 },
    ]);

    await expect(fetchAllLedgerEvents('https://example.com', fetchFn, 2)).rejects.toThrow(
      '/api/ledger-events returned next_after_sequence_no 3; expected last sequence_no 2',
    );
  });

  it('fails clearly when ledger-events sequence numbers are not strictly increasing', async () => {
    const fetchFn = fetchPages([
      { items: [ledgerEvent(1), ledgerEvent(1)], next_after_sequence_no: null },
    ]);

    await expect(fetchAllLedgerEvents('https://example.com', fetchFn, 2)).rejects.toThrow(
      '/api/ledger-events returned non-increasing sequence_no 1 after 1',
    );
  });
});
