import { describe, it, expect } from 'vitest';
import {
  HeliusWebhookEventSchema,
  HeliusWebhookEnvelopeSchema,
} from '../../src/schemas/helius-webhook.js';

describe('HeliusWebhookEventSchema', () => {
  const validEvent = {
    signature: '5xAbC1234mockTestVectorDonationConfirmedExample',
    type: 'TRANSFER',
    timestamp: 1718400000,
    tokenTransfers: [
      {
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        fromUserAccount: 'Sender111111111111111111111111111111111',
        toUserAccount: 'Vault11111111111111111111111111111111111',
        tokenAmount: 1000000,
        tokenStandard: 'Fungible',
      },
    ],
    nativeTransfers: [
      {
        fromUserAccount: 'FeePayer1111111111111111111111111111111',
        toUserAccount: 'Validator111111111111111111111111111111',
        amount: 5000,
      },
    ],
    accountData: [
      {
        account: 'Sender111111111111111111111111111111111',
        nativeBalanceChange: -15000,
        tokenBalanceChanges: [],
      },
    ],
    transactionError: null,
    instructions: [
      {
        programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        accounts: [
          'Sender111111111111111111111111111111111',
          'Vault11111111111111111111111111111111111',
          'Owner1111111111111111111111111111111111',
        ],
        data: 'base64data',
      },
    ],
    events: {
      nft: null,
      swap: null,
    },
  };

  it('accepts a valid Helius webhook event', () => {
    const result = HeliusWebhookEventSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
  });

  it('rejects an event missing signature', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { signature, ...noSig } = validEvent;
    const result = HeliusWebhookEventSchema.safeParse(noSig);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('signature');
    }
  });

  it('rejects an event with null signature', () => {
    const result = HeliusWebhookEventSchema.safeParse({ ...validEvent, signature: null });
    expect(result.success).toBe(false);
  });

  it('rejects an event with non-string signature', () => {
    const result = HeliusWebhookEventSchema.safeParse({ ...validEvent, signature: 12345 });
    expect(result.success).toBe(false);
  });

  it('accepts an event missing type (optional field)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { type, ...noType } = validEvent;
    const result = HeliusWebhookEventSchema.safeParse(noType);
    expect(result.success).toBe(true);
  });

  it('accepts an event missing timestamp (optional field)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { timestamp, ...noTs } = validEvent;
    const result = HeliusWebhookEventSchema.safeParse(noTs);
    expect(result.success).toBe(true);
  });

  it('accepts an event with extra unknown fields (passthrough)', () => {
    const result = HeliusWebhookEventSchema.safeParse({
      ...validEvent,
      newHeliusField: 'some-future-data',
      anotherField: { nested: true },
    });
    expect(result.success).toBe(true);
  });

  it('accepts an event with empty tokenTransfers array', () => {
    const result = HeliusWebhookEventSchema.safeParse({
      ...validEvent,
      tokenTransfers: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an event with null transactionError', () => {
    const result = HeliusWebhookEventSchema.safeParse({
      ...validEvent,
      transactionError: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an event with a string transactionError', () => {
    const result = HeliusWebhookEventSchema.safeParse({
      ...validEvent,
      transactionError: 'insufficient funds',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an event with non-array tokenTransfers', () => {
    const result = HeliusWebhookEventSchema.safeParse({
      ...validEvent,
      tokenTransfers: 'not-an-array',
    });
    expect(result.success).toBe(false);
  });
});

describe('HeliusWebhookEnvelopeSchema', () => {
  const validEvent = {
    signature: 'sig-1',
    type: 'TRANSFER',
    timestamp: 1718400000,
    tokenTransfers: [],
    nativeTransfers: [],
    accountData: [],
    transactionError: null,
    instructions: [],
    events: {},
  };

  it('accepts a valid array of events', () => {
    const result = HeliusWebhookEnvelopeSchema.safeParse([validEvent, validEvent]);
    expect(result.success).toBe(true);
  });

  it('accepts an empty array', () => {
    const result = HeliusWebhookEnvelopeSchema.safeParse([]);
    expect(result.success).toBe(true);
  });

  it('rejects a non-array value', () => {
    const result = HeliusWebhookEnvelopeSchema.safeParse({ not: 'an array' });
    expect(result.success).toBe(false);
  });

  it('rejects an array containing null', () => {
    const result = HeliusWebhookEnvelopeSchema.safeParse([null]);
    expect(result.success).toBe(false);
  });

  it('rejects an array containing a non-object', () => {
    const result = HeliusWebhookEnvelopeSchema.safeParse(['string-instead-of-object']);
    expect(result.success).toBe(false);
  });

  it('rejects an array with a mix of valid and invalid events', () => {
    const result = HeliusWebhookEnvelopeSchema.safeParse([
      validEvent,
      { notAnEvent: true }, // missing required fields
    ]);
    expect(result.success).toBe(false);
  });

  it('accepts a single valid event array', () => {
    const result = HeliusWebhookEnvelopeSchema.safeParse([validEvent]);
    expect(result.success).toBe(true);
  });
});
