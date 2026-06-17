import { describe, it, expect, beforeAll } from 'vitest';
import { importHmacKey, deriveTelegramUserRef } from '../src/index.js';

// Generate test keys once per test file
const rawKeyBytes1 = crypto.getRandomValues(new Uint8Array(32));
const rawKeyBytes2 = crypto.getRandomValues(new Uint8Array(32));
// Ensure keys are different
while (
  rawKeyBytes2.length === rawKeyBytes1.length &&
  rawKeyBytes2.every((b, i) => b === rawKeyBytes1[i])
) {
  crypto.getRandomValues(rawKeyBytes2);
}

describe('importHmacKey', () => {
  let hmacKey: CryptoKey;

  beforeAll(async () => {
    hmacKey = await importHmacKey(rawKeyBytes1);
  });

  it('returns a CryptoKey object', () => {
    expect(hmacKey).toBeDefined();
    expect(hmacKey.type).toBe('secret');
    expect(hmacKey.extractable).toBe(false);
  });

  it('returns a key with algorithm name HMAC', () => {
    expect(hmacKey.algorithm.name).toBe('HMAC');
  });

  it('returns a key with hash algorithm SHA-256', () => {
    const alg = hmacKey.algorithm as { name: string; hash: { name: string } };
    expect(alg.hash.name).toBe('SHA-256');
  });

  it('accepts a Uint8Array as raw key material', async () => {
    const key = await importHmacKey(rawKeyBytes1);
    expect(key.type).toBe('secret');
    expect(key.algorithm.name).toBe('HMAC');
  });

  it('accepts an ArrayBuffer as raw key material', async () => {
    const key = await importHmacKey(rawKeyBytes1.buffer);
    expect(key.type).toBe('secret');
    expect(key.algorithm.name).toBe('HMAC');
  });

  it('produces equivalent keys from Uint8Array and its underlying ArrayBuffer', async () => {
    const keyFromUint8 = await importHmacKey(rawKeyBytes1);
    const keyFromBuffer = await importHmacKey(rawKeyBytes1.buffer);

    const ref1 = await deriveTelegramUserRef(keyFromUint8, 12345);
    const ref2 = await deriveTelegramUserRef(keyFromBuffer, 12345);
    expect(ref1).toBe(ref2);
  });

  it('accepts keys of various lengths (HMAC accepts any length)', async () => {
    for (const len of [1, 16, 32, 64, 128]) {
      const rawKey = crypto.getRandomValues(new Uint8Array(len));
      const key = await importHmacKey(rawKey);
      expect(key.type).toBe('secret');
    }
  });
});

describe('deriveTelegramUserRef', () => {
  let hmacKey1: CryptoKey;
  let hmacKey2: CryptoKey;

  beforeAll(async () => {
    hmacKey1 = await importHmacKey(rawKeyBytes1);
    hmacKey2 = await importHmacKey(rawKeyBytes2);
  });

  it('returns a 64-character string', async () => {
    const ref = await deriveTelegramUserRef(hmacKey1, 123456789);
    expect(ref.length).toBe(64);
  });

  it('returns only lowercase hex characters [0-9a-f]', async () => {
    const ref = await deriveTelegramUserRef(hmacKey1, 123456789);
    expect(ref).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic: same key + same userId → same ref (tested 3 times)', async () => {
    const userId = 987654321;
    const ref1 = await deriveTelegramUserRef(hmacKey1, userId);
    const ref2 = await deriveTelegramUserRef(hmacKey1, userId);
    const ref3 = await deriveTelegramUserRef(hmacKey1, userId);
    expect(ref1).toBe(ref2);
    expect(ref2).toBe(ref3);
  });

  it('produces different refs for different keys with same userId', async () => {
    const userId = 555555;
    const ref1 = await deriveTelegramUserRef(hmacKey1, userId);
    const ref2 = await deriveTelegramUserRef(hmacKey2, userId);
    expect(ref1).not.toBe(ref2);
  });

  it('produces different refs for different userIds with same key', async () => {
    const ref1 = await deriveTelegramUserRef(hmacKey1, 111111);
    const ref2 = await deriveTelegramUserRef(hmacKey1, 222222);
    expect(ref1).not.toBe(ref2);
  });

  it('works with number userId', async () => {
    const ref = await deriveTelegramUserRef(hmacKey1, 123456789);
    expect(ref).toMatch(/^[0-9a-f]{64}$/);
  });

  it('works with string userId', async () => {
    const ref = await deriveTelegramUserRef(hmacKey1, '123456789');
    expect(ref).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces same ref for number and string representation of same userId', async () => {
    const refNum = await deriveTelegramUserRef(hmacKey1, 123456789);
    const refStr = await deriveTelegramUserRef(hmacKey1, '123456789');
    expect(refNum).toBe(refStr);
  });

  it('handles large userId values', async () => {
    const largeUserId = 999999999999;
    const ref = await deriveTelegramUserRef(hmacKey1, largeUserId);
    expect(ref).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles userId 0', async () => {
    const ref = await deriveTelegramUserRef(hmacKey1, 0);
    expect(ref).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles negative userId values', async () => {
    const ref = await deriveTelegramUserRef(hmacKey1, -12345);
    expect(ref).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cross-consistency: two keys imported from same raw bytes produce same refs', async () => {
    const keyA = await importHmacKey(rawKeyBytes1);
    const keyB = await importHmacKey(rawKeyBytes1);
    const refA = await deriveTelegramUserRef(keyA, 7777777);
    const refB = await deriveTelegramUserRef(keyB, 7777777);
    expect(refA).toBe(refB);
  });

  it('produces different refs for different userIds with same key (multiple pairs)', async () => {
    const pairs = [
      [1, 2],
      [100, 200],
      [999999, 888888],
      [123, '1234'],
    ] as const;
    for (const [id1, id2] of pairs) {
      const ref1 = await deriveTelegramUserRef(hmacKey1, id1);
      const ref2 = await deriveTelegramUserRef(hmacKey1, id2);
      expect(ref1).not.toBe(ref2);
    }
  });

  it('produces consistent output length regardless of userId size', async () => {
    const ids = [0, 1, 100, 999999999, 1234567890123];
    for (const id of ids) {
      const ref = await deriveTelegramUserRef(hmacKey1, id);
      expect(ref.length).toBe(64);
    }
  });
});
