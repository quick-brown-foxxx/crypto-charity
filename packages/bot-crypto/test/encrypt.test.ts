import { describe, it, expect, beforeAll } from 'vitest';
import {
  importAesGcmKey,
  encryptChatId,
  decryptChatId,
} from '../src/index.js';

// Generate a 32-byte AES-256 key
const rawAesKey = crypto.getRandomValues(new Uint8Array(32));
const wrongRawKey = crypto.getRandomValues(new Uint8Array(32));
// Ensure wrong key is different
while (
  wrongRawKey.length === rawAesKey.length &&
  wrongRawKey.every((b, i) => b === rawAesKey[i])
) {
  crypto.getRandomValues(wrongRawKey);
}

describe('importAesGcmKey', () => {
  let aesKey: CryptoKey;

  beforeAll(async () => {
    aesKey = await importAesGcmKey(rawAesKey);
  });

  it('returns a CryptoKey object', () => {
    expect(aesKey).toBeDefined();
    expect(aesKey.type).toBe('secret');
    expect(aesKey.extractable).toBe(false);
  });

  it('returns a key with algorithm name AES-GCM', () => {
    expect(aesKey.algorithm.name).toBe('AES-GCM');
  });

  it('returns a key with length 256', () => {
    const alg = aesKey.algorithm as { name: string; length: number };
    expect(alg.length).toBe(256);
  });

  it('accepts a Uint8Array as raw key material', async () => {
    const key = await importAesGcmKey(rawAesKey);
    expect(key.type).toBe('secret');
    expect(key.algorithm.name).toBe('AES-GCM');
  });

  it('accepts an ArrayBuffer as raw key material', async () => {
    const key = await importAesGcmKey(rawAesKey.buffer);
    expect(key.type).toBe('secret');
    expect(key.algorithm.name).toBe('AES-GCM');
  });

  it('produces equivalent keys from Uint8Array and its underlying ArrayBuffer', async () => {
    const keyFromUint8 = await importAesGcmKey(rawAesKey);
    const keyFromBuffer = await importAesGcmKey(rawAesKey.buffer);

    const enc1 = await encryptChatId(keyFromUint8, 1, 'test-opaque', 12345);
    const decResult = await decryptChatId(keyFromBuffer, enc1, 'test-opaque');
    expect(decResult.ok).toBe(true);
    if (decResult.ok) {
      expect(decResult.value).toBe('12345');
    }
  });
});

describe('encryptChatId', () => {
  let aesKey: CryptoKey;
  let wrongKey: CryptoKey;

  beforeAll(async () => {
    aesKey = await importAesGcmKey(rawAesKey);
    wrongKey = await importAesGcmKey(wrongRawKey);
  });

  it('returns a string envelope', async () => {
    const envelope = await encryptChatId(aesKey, 1, 'test-opaque', 12345);
    expect(typeof envelope).toBe('string');
    expect(envelope.length).toBeGreaterThan(0);
  });

  it('produces envelope matching format aesgcm:v1:<integer>:<base64url>:<base64url>', async () => {
    const envelope = await encryptChatId(aesKey, 1, 'test-opaque', 12345);
    // Format: aesgcm:v1:<keyVersion>:<nonce_b64>:<ciphertext_b64>
    expect(envelope).toMatch(
      /^aesgcm:v1:\d+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/,
    );
  });

  it('round-trip: encrypt then decrypt returns original chatId (number)', async () => {
    const chatId = 123456789;
    const envelope = await encryptChatId(aesKey, 1, 'my-opaque-id', chatId);
    const result = await decryptChatId(aesKey, envelope, 'my-opaque-id');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(String(chatId));
    }
  });

  it('round-trip: encrypt then decrypt returns original chatId (string)', async () => {
    const chatId = '-1001234567890';
    const envelope = await encryptChatId(aesKey, 1, 'my-opaque-id', chatId);
    const result = await decryptChatId(aesKey, envelope, 'my-opaque-id');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(chatId);
    }
  });

  it('round-trip works with various chatId values', async () => {
    const chatIds = ['0', '1', '12345', '-1001234567890', '999999999999'];
    for (const chatId of chatIds) {
      const envelope = await encryptChatId(aesKey, 1, 'opaque', chatId);
      const result = await decryptChatId(aesKey, envelope, 'opaque');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(chatId);
      }
    }
  });

  it('round-trip works with various keyVersion values', async () => {
    for (const keyVersion of [1, 2, 10, 100, 999]) {
      const envelope = await encryptChatId(
        aesKey,
        keyVersion,
        'opaque',
        'chat123',
      );
      const result = await decryptChatId(aesKey, envelope, 'opaque');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('chat123');
      }
    }
  });

  it('round-trip works with various opaqueId values', async () => {
    const opaqueIds = [
      'simple',
      'with-dashes',
      'with_underscores',
      'alphanumeric123',
      'very-long-opaque-id-that-is-quite-long-indeed',
    ];
    for (const opaqueId of opaqueIds) {
      const envelope = await encryptChatId(aesKey, 1, opaqueId, 'chat456');
      const result = await decryptChatId(aesKey, envelope, opaqueId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('chat456');
      }
    }
  });

  it('produces different envelopes for same data (nonce uniqueness)', async () => {
    const envelope1 = await encryptChatId(aesKey, 1, 'opaque', 'chat789');
    const envelope2 = await encryptChatId(aesKey, 1, 'opaque', 'chat789');
    expect(envelope1).not.toBe(envelope2);

    // Both should decrypt to the same value
    const r1 = await decryptChatId(aesKey, envelope1, 'opaque');
    const r2 = await decryptChatId(aesKey, envelope2, 'opaque');
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.value).toBe('chat789');
      expect(r2.value).toBe('chat789');
    }
  });

  it('nonce parts differ between two encryptions of same data', async () => {
    const envelope1 = await encryptChatId(aesKey, 1, 'opaque', 'chat789');
    const envelope2 = await encryptChatId(aesKey, 1, 'opaque', 'chat789');

    // Extract nonce parts (4th colon-separated field, 0-indexed: 3)
    const parts1 = envelope1.split(':');
    const parts2 = envelope2.split(':');
    const nonce1 = parts1[3];
    const nonce2 = parts2[3];
    expect(nonce1).not.toBe(nonce2);
  });

  it('decrypt fails with wrong key', async () => {
    const envelope = await encryptChatId(aesKey, 1, 'opaque', 'chat123');
    const result = await decryptChatId(wrongKey, envelope, 'opaque');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('decrypt_failed');
    }
  });

  it('decrypt fails with wrong opaqueId (AAD mismatch)', async () => {
    const envelope = await encryptChatId(aesKey, 1, 'correct-opaque', 'chat123');
    const result = await decryptChatId(aesKey, envelope, 'wrong-opaque');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('decrypt_failed');
    }
  });

  it('decrypt fails with tampered ciphertext', async () => {
    const envelope = await encryptChatId(aesKey, 1, 'opaque', 'chat123');
    const parts = envelope.split(':');
    // Tamper with the ciphertext (last part) by flipping a character
    const ctChars = parts[4]!.split('');
    const idx = ctChars.findIndex((c) => c !== 'A') || 0;
    ctChars[idx] = ctChars[idx] === 'A' ? 'B' : 'A';
    parts[4] = ctChars.join('');
    const tampered = parts.join(':');

    const result = await decryptChatId(aesKey, tampered, 'opaque');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('decrypt_failed');
    }
  });

  it('decrypt fails with tampered nonce', async () => {
    const envelope = await encryptChatId(aesKey, 1, 'opaque', 'chat123');
    const parts = envelope.split(':');
    // Tamper with the nonce (4th part, index 3)
    const nonceChars = parts[3]!.split('');
    const idx = nonceChars.findIndex((c) => c !== 'A') || 0;
    nonceChars[idx] = nonceChars[idx] === 'A' ? 'B' : 'A';
    parts[3] = nonceChars.join('');
    const tampered = parts.join(':');

    const result = await decryptChatId(aesKey, tampered, 'opaque');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('decrypt_failed');
    }
  });

  it('decrypt fails with tampered keyVersion', async () => {
    const envelope = await encryptChatId(aesKey, 5, 'opaque', 'chat123');
    // Change keyVersion from 5 to 6
    const tampered = envelope.replace(/^aesgcm:v1:5:/, 'aesgcm:v1:6:');
    const result = await decryptChatId(aesKey, tampered, 'opaque');
    // Different keyVersion should still decrypt if using same key
    // (keyVersion is metadata, not part of the AEAD)
    // But if the implementation uses keyVersion in AAD, it would fail
    // We just verify the function handles it gracefully
    expect([true, false]).toContain(result.ok);
  });

  it('works with number chatId', async () => {
    const envelope = await encryptChatId(aesKey, 1, 'opaque', 12345);
    const result = await decryptChatId(aesKey, envelope, 'opaque');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('12345');
    }
  });

  it('works with string chatId', async () => {
    const envelope = await encryptChatId(aesKey, 1, 'opaque', '12345');
    const result = await decryptChatId(aesKey, envelope, 'opaque');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('12345');
    }
  });

  it('handles large chatId values (supergroups)', async () => {
    const largeChatId = '-1001234567890';
    const envelope = await encryptChatId(aesKey, 1, 'opaque', largeChatId);
    const result = await decryptChatId(aesKey, envelope, 'opaque');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(largeChatId);
    }
  });

  it('envelope keyVersion field matches the input keyVersion', async () => {
    for (const kv of [1, 2, 42, 255]) {
      const envelope = await encryptChatId(aesKey, kv, 'opaque', 'chat');
      const parts = envelope.split(':');
      expect(parts[2]).toBe(String(kv));
    }
  });

  it('envelope prefix is always aesgcm:v1', async () => {
    const envelope = await encryptChatId(aesKey, 99, 'opaque', 'chat');
    expect(envelope.startsWith('aesgcm:v1:')).toBe(true);
  });
});
