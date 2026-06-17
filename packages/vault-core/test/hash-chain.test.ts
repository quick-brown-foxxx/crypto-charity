import { describe, it, expect } from 'vitest';
import { computeEventHash, verifyChain, ZERO_HASH } from '../src/hash-chain.js';
import type { LedgerEvent, LedgerEventBase } from '../src/events.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeDonationEvent(overrides: Partial<LedgerEventBase> = {}): LedgerEventBase {
  return {
    sequence_no: 1,
    event_type: 'donation_confirmed',
    payload: {
      cluster: 'mainnet-beta',
      usdc_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      treasury_wallet_address: '8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG',
      vault_usdc_ata: '52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG',
      tx_signature: '5xAbC1234mockTestVectorDonationConfirmedExample',
      transaction_version: 0,
      instruction_index: 3,
      inner_index: null,
      slot: 123456789,
      block_time_utc: '2026-06-14T10:23:00Z',
      amount_usdc_minor: '100000000',
    },
    prev_hash: ZERO_HASH,
    created_at_utc: '2026-06-14T10:23:01Z',
    ...overrides,
  };
}

async function hashEvent(base: LedgerEventBase): Promise<LedgerEvent> {
  const event_hash = await computeEventHash(base);
  return { ...base, event_hash };
}

// ---------------------------------------------------------------------------
// computeEventHash
// ---------------------------------------------------------------------------

describe('computeEventHash', () => {
  it('produces deterministic output for the same event', async () => {
    const event = makeDonationEvent();
    const hash1 = await computeEventHash(event);
    const hash2 = await computeEventHash(event);
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different payloads', async () => {
    const event1 = makeDonationEvent();
    const event2 = makeDonationEvent({
      payload: {
        cluster: 'mainnet-beta',
        usdc_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        treasury_wallet_address: '8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG',
        vault_usdc_ata: '52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG',
        tx_signature: 'differentTxSignature9876543210abcdefABCDEF',
        transaction_version: 0,
        instruction_index: 3,
        inner_index: null,
        slot: 123456789,
        block_time_utc: '2026-06-14T10:23:00Z',
        amount_usdc_minor: '200000000',
      },
    });
    const hash1 = await computeEventHash(event1);
    const hash2 = await computeEventHash(event2);
    expect(hash1).not.toBe(hash2);
  });

  it('excludes event_hash from the preimage', async () => {
    const base = makeDonationEvent();
    const hashWithoutEventHash = await computeEventHash(base);

    // LedgerEvent extends LedgerEventBase, so it is assignable.
    // We set a fake event_hash to prove it does not affect the computed hash.
    const withFakeHash: LedgerEvent = {
      ...base,
      event_hash: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    };
    const hashWithFakeHash = await computeEventHash(withFakeHash);

    expect(hashWithFakeHash).toBe(hashWithoutEventHash);
  });

  it('returns 64 lowercase hex characters', async () => {
    const event = makeDonationEvent();
    const hash = await computeEventHash(event);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes when prev_hash differs', async () => {
    const event1 = makeDonationEvent({ prev_hash: ZERO_HASH });
    const event2 = makeDonationEvent({
      prev_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    const hash1 = await computeEventHash(event1);
    const hash2 = await computeEventHash(event2);
    expect(hash1).not.toBe(hash2);
  });

  it('produces different hashes when sequence_no differs', async () => {
    const event1 = makeDonationEvent({ sequence_no: 1 });
    const event2 = makeDonationEvent({ sequence_no: 2 });
    const hash1 = await computeEventHash(event1);
    const hash2 = await computeEventHash(event2);
    expect(hash1).not.toBe(hash2);
  });
});

// ---------------------------------------------------------------------------
// verifyChain
// ---------------------------------------------------------------------------

describe('verifyChain', () => {
  it('returns an error for an empty chain', async () => {
    const result = await verifyChain([]);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Chain is empty');
  });

  it('accepts a single valid event with ZERO_HASH prev_hash', async () => {
    const base = makeDonationEvent({ prev_hash: ZERO_HASH });
    const event = await hashEvent(base);
    const result = await verifyChain([event]);
    expect(result.valid).toBe(true);
  });

  it('rejects a first event whose prev_hash is not 64 zeros', async () => {
    const base = makeDonationEvent({
      prev_hash: 'abcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd',
    });
    const event = await hashEvent(base);
    const result = await verifyChain([event]);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('First event prev_hash must be 64 zeros');
  });

  it('accepts a valid 3-event chain', async () => {
    const base1 = makeDonationEvent({ sequence_no: 1, prev_hash: ZERO_HASH });
    const event1 = await hashEvent(base1);

    const base2 = makeDonationEvent({
      sequence_no: 2,
      prev_hash: event1.event_hash,
      payload: {
        cluster: 'mainnet-beta',
        usdc_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        treasury_wallet_address: '8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG',
        vault_usdc_ata: '52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG',
        tx_signature: 'event2SignatureAbcdef1234567890abcdef1234567890',
        transaction_version: 0,
        instruction_index: 3,
        inner_index: null,
        slot: 123456790,
        block_time_utc: '2026-06-14T10:24:00Z',
        amount_usdc_minor: '50000000',
      },
    });
    const event2 = await hashEvent(base2);

    const base3 = makeDonationEvent({
      sequence_no: 3,
      prev_hash: event2.event_hash,
      payload: {
        cluster: 'mainnet-beta',
        usdc_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        treasury_wallet_address: '8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG',
        vault_usdc_ata: '52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG',
        tx_signature: 'event3SignatureXyz9876543210fedcba9876543210fedcba',
        transaction_version: 0,
        instruction_index: 3,
        inner_index: null,
        slot: 123456791,
        block_time_utc: '2026-06-14T10:25:00Z',
        amount_usdc_minor: '75000000',
      },
    });
    const event3 = await hashEvent(base3);

    const result = await verifyChain([event1, event2, event3]);
    expect(result.valid).toBe(true);
  });

  it('detects a broken chain link where prev_hash does not match previous event_hash', async () => {
    const base1 = makeDonationEvent({ sequence_no: 1, prev_hash: ZERO_HASH });
    const event1 = await hashEvent(base1);

    // Event 2 has a prev_hash that does NOT match event1's event_hash.
    const base2 = makeDonationEvent({
      sequence_no: 2,
      prev_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
    const event2 = await hashEvent(base2);

    const result = await verifyChain([event1, event2]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Chain broken at sequence_no 2');
    expect(result.error).toContain('prev_hash does not match previous event_hash');
  });

  it('detects an event whose event_hash does not match the computed hash', async () => {
    const base = makeDonationEvent({ prev_hash: ZERO_HASH });
    const correctHash = await computeEventHash(base);

    // Tamper with event_hash to a wrong value.
    const tamperedEvent: LedgerEvent = {
      ...base,
      event_hash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    };

    const result = await verifyChain([tamperedEvent]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Event 1 hash mismatch');
    expect(result.error).toContain(correctHash);
    expect(result.error).toContain(tamperedEvent.event_hash);
  });
});
