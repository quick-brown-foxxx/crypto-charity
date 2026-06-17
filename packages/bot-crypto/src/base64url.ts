/**
 * Encode a Uint8Array to a base64url string (no padding, URL-safe alphabet).
 *
 * Uses `btoa` with binary string conversion — works in both Node.js and
 * Cloudflare Workers without Node.js `Buffer`.
 */
export function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode a base64url string (no padding, URL-safe alphabet) to a Uint8Array.
 *
 * Restores standard base64 alphabet, adds padding, then uses `atob` with
 * binary string conversion.
 */
export function base64urlDecode(str: string): Uint8Array {
  // Restore standard base64 alphabet
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding to make length a multiple of 4
  const mod = base64.length % 4;
  if (mod === 2) {
    base64 += '==';
  } else if (mod === 3) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
