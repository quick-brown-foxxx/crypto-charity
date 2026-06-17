/**
 * Import raw key bytes as an HMAC-SHA256 CryptoKey.
 *
 * Accepts both Uint8Array and ArrayBuffer. For Uint8Array, slices the
 * underlying buffer to the exact byte range (Uint8Array.buffer may have
 * extra bytes at the start or end).
 */
export async function importHmacKey(rawKey: Uint8Array | ArrayBuffer): Promise<CryptoKey> {
  // .buffer.slice() returns ArrayBuffer | SharedArrayBuffer in TS types,
  // but Uint8Array is always backed by ArrayBuffer at runtime.
  const keyData: ArrayBuffer = rawKey instanceof Uint8Array
    ? rawKey.buffer.slice(rawKey.byteOffset, rawKey.byteOffset + rawKey.byteLength) as ArrayBuffer
    : rawKey;

  return crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false, // extractable
    ['sign'],
  );
}

/**
 * Derive a Telegram user reference by computing HMAC-SHA256 of
 * `"tg-user:" + telegramUserId` and returning the result as a lowercase
 * hex string (64 characters).
 */
export async function deriveTelegramUserRef(
  key: CryptoKey,
  telegramUserId: number | string,
): Promise<string> {
  const message = new TextEncoder().encode(`tg-user:${telegramUserId}`);
  const signature = await crypto.subtle.sign('HMAC', key, message);
  const bytes = new Uint8Array(signature);

  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}
