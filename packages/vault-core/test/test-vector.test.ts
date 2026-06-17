import { describe, it, expect } from 'vitest';
import { canonicalJson } from '../src/canonical-json.js';
import { computeEventHash } from '../src/hash-chain.js';
import type { LedgerEventBase } from '../src/events.js';

describe('Normative Test Vector', () => {
  const input: LedgerEventBase = {
    sequence_no: 1,
    event_type: 'donation_confirmed',
    payload: {
      amount_usdc_minor: '100000000',
      block_time_utc: '2026-06-14T10:23:00Z',
      cluster: 'mainnet-beta',
      inner_index: null,
      instruction_index: 3,
      slot: 123456789,
      transaction_version: 0,
      treasury_wallet_address: '8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG',
      tx_signature: '5xAbC1234mockTestVectorDonationConfirmedExample',
      usdc_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      vault_usdc_ata: '52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG',
    },
    prev_hash: '0000000000000000000000000000000000000000000000000000000000000000',
    created_at_utc: '2026-06-14T10:23:01Z',
  };

  const expectedCanonical =
    '{"created_at_utc":"2026-06-14T10:23:01Z",' +
    '"event_type":"donation_confirmed",' +
    '"payload":{' +
    '"amount_usdc_minor":"100000000",' +
    '"block_time_utc":"2026-06-14T10:23:00Z",' +
    '"cluster":"mainnet-beta",' +
    '"inner_index":null,' +
    '"instruction_index":3,' +
    '"slot":123456789,' +
    '"transaction_version":0,' +
    '"treasury_wallet_address":"8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG",' +
    '"tx_signature":"5xAbC1234mockTestVectorDonationConfirmedExample",' +
    '"usdc_mint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",' +
    '"vault_usdc_ata":"52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG"' +
    '},' +
    '"prev_hash":"0000000000000000000000000000000000000000000000000000000000000000",' +
    '"sequence_no":1}';

  const expectedHash = 'fda2610fb171efe75bf16a821f8b87764801bab1e2f4e69bdd98ccb53bf1df41';

  it('produces the normative canonical JSON bytes', () => {
    const canonical = canonicalJson(input);
    expect(canonical).toBe(expectedCanonical);
  });

  it('produces the normative event_hash', async () => {
    const hash = await computeEventHash(input);
    expect(hash).toBe(expectedHash);
  });

  it('event_hash is 64 lowercase hex chars', async () => {
    const hash = await computeEventHash(input);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
