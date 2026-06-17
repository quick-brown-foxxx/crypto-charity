import { describe, it, expect, beforeAll } from 'vitest';
import {
  importAesGcmKey,
  encryptChatId,
  decryptChatId,
  parseEnvelope,
} from '../src/index.js';
// ParseError and DecryptError types are used implicitly via result.error.type checks

// Generate a 32-byte AES-256 key
const rawAesKey = crypto.getRandomValues(new Uint8Array(32));
const wrongRawKey = crypto.getRandomValues(new Uint8Array(32));
while (
  wrongRawKey.length === rawAesKey.length &&
  wrongRawKey.every((b, i) => b === rawAesKey[i])
) {
  crypto.getRandomValues(wrongRawKey);
}

describe('parseEnvelope', () => {
  let aesKey: CryptoKey;

  beforeAll(async () => {
    aesKey = await importAesGcmKey(rawAesKey);
  });

  describe('valid envelopes', () => {
    it('parses a valid envelope and returns ok with correct keyVersion', async () => {
      const envelope = await encryptChatId(aesKey, 5, 'opaque', 'chat123');
      const result = parseEnvelope(envelope);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.keyVersion).toBe(5);
      }
    });

    it('parsed nonce is exactly 12 bytes', async () => {
      const envelope = await encryptChatId(aesKey, 1, 'opaque', 'chat123');
      const result = parseEnvelope(envelope);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.nonce).toBeInstanceOf(Uint8Array);
        expect(result.value.nonce.length).toBe(12);
      }
    });

    it('parsed ciphertext is a non-empty Uint8Array', async () => {
      const envelope = await encryptChatId(aesKey, 1, 'opaque', 'chat123');
      const result = parseEnvelope(envelope);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.ciphertext).toBeInstanceOf(Uint8Array);
        expect(result.value.ciphertext.length).toBeGreaterThan(0);
      }
    });

    it('parses envelopes with various keyVersions', async () => {
      for (const kv of [1, 2, 10, 100, 999]) {
        const envelope = await encryptChatId(aesKey, kv, 'opaque', 'chat');
        const result = parseEnvelope(envelope);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.keyVersion).toBe(kv);
        }
      }
    });
  });

  describe('invalid format strings', () => {
    it('returns error for empty string', () => {
      const result = parseEnvelope('');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invalid_format');
      }
    });

    it('returns error for completely random string', () => {
      const result = parseEnvelope('not-an-envelope-at-all');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invalid_format');
      }
    });

    it('returns error for wrong prefix (aesgcm:v2)', () => {
      const result = parseEnvelope('aesgcm:v2:1:abc123:def456');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invalid_format');
      }
    });

    it('returns error for missing parts (only 3 colon-separated parts)', () => {
      const result = parseEnvelope('aesgcm:v1:1');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invalid_format');
      }
    });

    it('returns error for missing ciphertext part', () => {
      const result = parseEnvelope('aesgcm:v1:1:abc123');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invalid_format');
      }
    });

    it('returns error for non-integer keyVersion', () => {
      const result = parseEnvelope('aesgcm:v1:abc:nonce123:ct123');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invalid_key_version');
      }
    });

    it('returns error for keyVersion < 1', () => {
      const result = parseEnvelope('aesgcm:v1:0:nonce1234:ct1234');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invalid_key_version');
      }
    });

    it('returns error for negative keyVersion', () => {
      const result = parseEnvelope('aesgcm:v1:-5:nonce1234:ct1234');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invalid_key_version');
      }
    });

    it('returns error for invalid base64url in nonce part', () => {
      // '!' is not valid in base64url or standard base64 — atob will throw
      const result = parseEnvelope('aesgcm:v1:1:abc!def:validct1234');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invalid_base64url');
      }
    });

    it('returns error for invalid base64url in ciphertext part', () => {
      // '@' is not valid in base64url or standard base64 — atob will throw
      const result = parseEnvelope('aesgcm:v1:1:validnonce:abc@def');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invalid_base64url');
      }
    });

    it('returns error for nonce that is not 12 bytes after decoding', () => {
      // 16 bytes → 22 base64url chars (ceil(16*8/6) = 22)
      // 22 'A's decodes to 16 zero bytes (plus some padding bits)
      const badNonce16 = 'AAAAAAAAAAAAAAAAAAAAAA'; // 22 A's
      const result = parseEnvelope(`aesgcm:v1:1:${badNonce16}:validct1234`);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invalid_format');
      }
    });

    it('returns error for envelope with extra colons', () => {
      const result = parseEnvelope('aesgcm:v1:1:nonce:ct:extra');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invalid_format');
      }
    });
  });
});

describe('decryptChatId', () => {
  let aesKey: CryptoKey;
  let wrongKey: CryptoKey;

  beforeAll(async () => {
    aesKey = await importAesGcmKey(rawAesKey);
    wrongKey = await importAesGcmKey(wrongRawKey);
  });

  describe('successful decryption', () => {
    it('decrypts a valid envelope with correct opaqueId and returns ok', async () => {
      const envelope = await encryptChatId(aesKey, 1, 'my-opaque', 'chat123');
      const result = await decryptChatId(aesKey, envelope, 'my-opaque');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('chat123');
      }
    });

    it('decrypts envelopes with various keyVersions', async () => {
      for (const kv of [1, 2, 10, 100]) {
        const envelope = await encryptChatId(aesKey, kv, 'opaque', 'chat456');
        const result = await decryptChatId(aesKey, envelope, 'opaque');
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toBe('chat456');
        }
      }
    });

    it('decrypts envelopes with various opaqueIds', async () => {
      const opaqueIds = ['simple', 'with-dashes', 'under_scores', 'mixed-123'];
      for (const oid of opaqueIds) {
        const envelope = await encryptChatId(aesKey, 1, oid, 'chat789');
        const result = await decryptChatId(aesKey, envelope, oid);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toBe('chat789');
        }
      }
    });

    it('decrypts large chatId values', async () => {
      const chatId = '-1001234567890';
      const envelope = await encryptChatId(aesKey, 1, 'opaque', chatId);
      const result = await decryptChatId(aesKey, envelope, 'opaque');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(chatId);
      }
    });
  });

  describe('decryption failures', () => {
    it('returns parse_error for invalid envelope format', async () => {
      const result = await decryptChatId(aesKey, 'not-valid', 'opaque');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('parse_error');
        expect(result.error.cause).toBeDefined();
      }
    });

    it('returns parse_error for empty envelope', async () => {
      const result = await decryptChatId(aesKey, '', 'opaque');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('parse_error');
      }
    });

    it('returns decrypt_failed for wrong opaqueId', async () => {
      const envelope = await encryptChatId(aesKey, 1, 'correct-opaque', 'chat');
      const result = await decryptChatId(aesKey, envelope, 'wrong-opaque');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('decrypt_failed');
        expect(result.error.message).toBeDefined();
        expect(typeof result.error.message).toBe('string');
      }
    });

    it('returns decrypt_failed for wrong key', async () => {
      const envelope = await encryptChatId(aesKey, 1, 'opaque', 'chat');
      const result = await decryptChatId(wrongKey, envelope, 'opaque');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('decrypt_failed');
      }
    });

    it('returns decrypt_failed for tampered ciphertext', async () => {
      const envelope = await encryptChatId(aesKey, 1, 'opaque', 'chat123');
      const parts = envelope.split(':');
      const ctChars = parts[4]!.split('');
      // Flip the first character — always affects decoded data
      // (last character may encode padding bits that are discarded)
      ctChars[0] = ctChars[0] === 'A' ? 'B' : 'A';
      parts[4] = ctChars.join('');
      const tampered = parts.join(':');

      const result = await decryptChatId(aesKey, tampered, 'opaque');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('decrypt_failed');
      }
    });

    it('returns decrypt_failed for tampered nonce', async () => {
      const envelope = await encryptChatId(aesKey, 1, 'opaque', 'chat123');
      const parts = envelope.split(':');
      const nonceChars = parts[3]!.split('');
      const lastIdx = nonceChars.length - 1;
      nonceChars[lastIdx] = nonceChars[lastIdx] === 'A' ? 'B' : 'A';
      parts[3] = nonceChars.join('');
      const tampered = parts.join(':');

      const result = await decryptChatId(aesKey, tampered, 'opaque');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('decrypt_failed');
      }
    });
  });

  describe('error type structures', () => {
    it('ParseError has correct structure for invalid_format', async () => {
      const result = await decryptChatId(aesKey, 'garbage', 'opaque');
      expect(result.ok).toBe(false);
      if (!result.ok && result.error.type === 'parse_error') {
        const cause = result.error.cause;
        expect(cause.type).toBe('invalid_format');
        expect(typeof cause.message).toBe('string');
        expect(cause.message.length).toBeGreaterThan(0);
      }
    });

    it('ParseError has correct structure for invalid_key_version', async () => {
      const result = await decryptChatId(aesKey, 'aesgcm:v1:0:abc123:def456', 'opaque');
      expect(result.ok).toBe(false);
      if (!result.ok && result.error.type === 'parse_error') {
        const cause = result.error.cause;
        expect(cause.type).toBe('invalid_key_version');
        expect(typeof cause.message).toBe('string');
      }
    });

    it('ParseError has correct structure for invalid_base64url', async () => {
      const result = await decryptChatId(
        aesKey,
        'aesgcm:v1:1:invalid!!!:ct1234',
        'opaque',
      );
      expect(result.ok).toBe(false);
      if (!result.ok && result.error.type === 'parse_error') {
        const cause = result.error.cause;
        expect(cause.type).toBe('invalid_base64url');
        expect(typeof cause.message).toBe('string');
      }
    });

    it('DecryptError decrypt_failed has message string', async () => {
      const envelope = await encryptChatId(aesKey, 1, 'opaque', 'chat');
      const result = await decryptChatId(wrongKey, envelope, 'opaque');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('decrypt_failed');
        expect(typeof result.error.message).toBe('string');
        expect(result.error.message).not.toBe('');
      }
    });
  });
});
