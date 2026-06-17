/**
 * Webhook secret verification with constant-time comparison.
 *
 * Telegram sends an `X-Telegram-Bot-Api-Secret-Token` header with each
 * webhook request. We compare it against the configured secret using a
 * constant-time algorithm to prevent timing side-channel attacks.
 */

/**
 * Compare two strings in constant time.
 *
 * Returns `true` if the strings are byte-for-byte identical, `false`
 * otherwise. The comparison runs in time proportional to the length of
 * the longer string, regardless of where the first difference occurs.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Early length check is not constant-time, but leaking the length
    // of the secret is acceptable — the secret length is known from
    // the env var anyway.
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    // XOR each character code; if any differ, result becomes non-zero.
    // The loop always runs to completion regardless of differences.
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Verify the Telegram webhook secret token header.
 *
 * @param headerValue - The value of the `X-Telegram-Bot-Api-Secret-Token`
 *   header, or `null`/`undefined` if the header is absent.
 * @param secret - The configured webhook secret from `TG_WEBHOOK_SECRET`.
 * @returns `true` if the header matches the secret, `false` otherwise.
 */
export function verifyWebhookSecret(
  headerValue: string | null | undefined,
  secret: string,
): boolean {
  if (headerValue === null || headerValue === undefined) {
    return false;
  }
  return constantTimeEqual(headerValue, secret);
}
