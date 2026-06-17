import { importHmacKey, importAesGcmKey } from '@open-care/bot-crypto';
import type { Env } from './env.js';

/**
 * Decode a hex string into a Uint8Array.
 *
 * Each pair of hex characters represents one byte.
 * The input must have an even number of characters.
 */
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`Hex string must have even length, got ${hex.length}`);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const pair = hex.substring(i, i + 2);
    bytes[i / 2] = parseInt(pair, 16);
  }
  return bytes;
}

/**
 * Import the HMAC-SHA256 key from the hex-encoded environment secret.
 *
 * `TG_ID_HMAC_KEY` is a hex string representing the raw key bytes.
 * This function decodes the hex, then imports the bytes as a CryptoKey
 * suitable for `deriveTelegramUserRef`.
 *
 * @param env - The Worker environment bindings
 * @returns A non-extractable HMAC-SHA256 CryptoKey for signing.
 */
export async function setupHmacKey(env: Env): Promise<CryptoKey> {
  const rawBytes = hexToBytes(env.TG_ID_HMAC_KEY);
  return importHmacKey(rawBytes);
}

/**
 * Import the AES-GCM-256 key from the hex-encoded environment secret.
 *
 * `TG_CHAT_ENC_KEY` is a hex string representing the raw key bytes.
 * This function decodes the hex, then imports the bytes as a CryptoKey
 * suitable for `encryptChatId` and `decryptChatId`.
 *
 * @param env - The Worker environment bindings
 * @returns A non-extractable AES-GCM-256 CryptoKey for encrypt/decrypt.
 */
export async function setupAesGcmKey(env: Env): Promise<CryptoKey> {
  const rawBytes = hexToBytes(env.TG_CHAT_ENC_KEY);
  return importAesGcmKey(rawBytes);
}
