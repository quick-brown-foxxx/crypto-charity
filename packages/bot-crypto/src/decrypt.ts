import { Result, ok, err } from '@open-care/vault-core';
import { base64urlDecode } from './base64url.js';

/** Errors that can occur during envelope parsing. */
export type ParseError =
  | { type: 'invalid_format'; message: string }
  | { type: 'invalid_key_version'; message: string }
  | { type: 'invalid_base64url'; message: string };

/** Errors that can occur during decryption. */
export type DecryptError =
  | { type: 'parse_error'; cause: ParseError }
  | { type: 'decrypt_failed'; message: string };

/**
 * Parse an AES-GCM envelope string into its components.
 *
 * Expected format: `aesgcm:v1:<keyVersion>:<nonceB64>:<cipherB64>`
 *
 * Returns structured data on success, or a descriptive ParseError on failure.
 */
export function parseEnvelope(
  envelope: string,
): Result<{ keyVersion: number; nonce: Uint8Array; ciphertext: Uint8Array }, ParseError> {
  const parts = envelope.split(':');
  if (parts.length !== 5) {
    return err({
      type: 'invalid_format',
      message: `Expected 5 colon-separated parts, got ${parts.length}`,
    });
  }

  const prefix = parts[0];
  const version = parts[1];
  const keyVerStr = parts[2];
  const nonceB64 = parts[3];
  const cipherB64 = parts[4];

  // Satisfy noUncheckedIndexedAccess — verify each part is defined
  if (
    prefix === undefined ||
    version === undefined ||
    keyVerStr === undefined ||
    nonceB64 === undefined ||
    cipherB64 === undefined
  ) {
    return err({ type: 'invalid_format', message: 'Missing envelope parts' });
  }

  if (prefix !== 'aesgcm' || version !== 'v1') {
    return err({
      type: 'invalid_format',
      message: `Expected prefix 'aesgcm:v1', got '${prefix}:${version}'`,
    });
  }

  const keyVersion = parseInt(keyVerStr, 10);
  if (!Number.isInteger(keyVersion) || keyVersion < 1) {
    return err({
      type: 'invalid_key_version',
      message: `Key version must be an integer >= 1, got '${keyVerStr}'`,
    });
  }

  let nonce: Uint8Array;
  let ciphertext: Uint8Array;
  try {
    nonce = base64urlDecode(nonceB64);
    ciphertext = base64urlDecode(cipherB64);
  } catch {
    return err({
      type: 'invalid_base64url',
      message: 'Failed to decode base64url nonce or ciphertext',
    });
  }

  if (nonce.length !== 12) {
    return err({
      type: 'invalid_format',
      message: `Nonce must be 12 bytes, got ${nonce.length}`,
    });
  }

  return ok({ keyVersion, nonce, ciphertext });
}

/**
 * Decrypt a chat ID from an AES-GCM envelope.
 *
 * @param key - AES-GCM CryptoKey (from importAesGcmKey)
 * @param envelope - The envelope string produced by encryptChatId
 * @param opaqueId - Opaque identifier bound into the AAD (must match encryption)
 * @returns The decrypted chat ID string on success, or a DecryptError
 */
export async function decryptChatId(
  key: CryptoKey,
  envelope: string,
  opaqueId: string,
): Promise<Result<string, DecryptError>> {
  const parsed = parseEnvelope(envelope);
  if (!parsed.ok) {
    return err({ type: 'parse_error', cause: parsed.error });
  }

  const { keyVersion, nonce, ciphertext } = parsed.value;
  const aad = new TextEncoder().encode(`ccv:tg-chat-route:${opaqueId}:${keyVersion}`);

  try {
    // Uint8Array.buffer is typed as ArrayBufferLike in TS; extract the
    // underlying ArrayBuffer (always ArrayBuffer at runtime, never Shared).
    const nonceBuf: ArrayBuffer = nonce.buffer.slice(
      nonce.byteOffset,
      nonce.byteOffset + nonce.byteLength,
    ) as ArrayBuffer;
    const cipherBuf: ArrayBuffer = ciphertext.buffer.slice(
      ciphertext.byteOffset,
      ciphertext.byteOffset + ciphertext.byteLength,
    ) as ArrayBuffer;

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonceBuf, additionalData: aad },
      key,
      cipherBuf,
    );
    return ok(new TextDecoder().decode(decrypted));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Decryption failed';
    return err({ type: 'decrypt_failed', message });
  }
}
