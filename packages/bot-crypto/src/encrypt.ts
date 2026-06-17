import { base64urlEncode } from './base64url.js';

/**
 * Import raw key bytes as an AES-GCM 256-bit CryptoKey.
 *
 * Accepts both Uint8Array and ArrayBuffer. For Uint8Array, slices the
 * underlying buffer to the exact byte range.
 */
export async function importAesGcmKey(rawKey: Uint8Array | ArrayBuffer): Promise<CryptoKey> {
  // .buffer.slice() returns ArrayBuffer | SharedArrayBuffer in TS types,
  // but Uint8Array is always backed by ArrayBuffer at runtime.
  const keyData: ArrayBuffer = rawKey instanceof Uint8Array
    ? rawKey.buffer.slice(rawKey.byteOffset, rawKey.byteOffset + rawKey.byteLength) as ArrayBuffer
    : rawKey;

  return crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM', length: 256 },
    false, // extractable
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt a Telegram chat ID using AES-GCM.
 *
 * Returns an envelope string:
 *   `aesgcm:v1:<keyVersion>:<base64url(nonce)>:<base64url(ciphertext+tag)>`
 *
 * @param key - AES-GCM CryptoKey (from importAesGcmKey)
 * @param keyVersion - Integer version identifier for key rotation
 * @param opaqueId - Opaque identifier bound into the AAD
 * @param chatId - The chat ID to encrypt
 */
export async function encryptChatId(
  key: CryptoKey,
  keyVersion: number,
  opaqueId: string,
  chatId: number | string,
): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(String(chatId));
  const aad = new TextEncoder().encode(`ccv:tg-chat-route:${opaqueId}:${keyVersion}`);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad },
    key,
    plaintext,
  );

  const ciphertext = new Uint8Array(encrypted);
  const nonceB64 = base64urlEncode(nonce);
  const cipherB64 = base64urlEncode(ciphertext);

  return `aesgcm:v1:${keyVersion}:${nonceB64}:${cipherB64}`;
}
