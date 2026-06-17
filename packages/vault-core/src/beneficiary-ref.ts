/**
 * Beneficiary reference generation and validation.
 *
 * A beneficiary reference is a system-assigned opaque identifier used
 * to route donations when the donor does not know (or does not want to
 * disclose) the beneficiary's public handle. It is embedded in the
 * Solana transaction memo field.
 *
 * Format: `benpub_` + 16 base32 characters (80 bits of entropy).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** RFC 4648 base32 alphabet (uppercase, no padding). */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Number of random bytes to read (80 bits = 10 bytes = 16 base32 chars). */
const RANDOM_BYTE_COUNT = 10;

/** Number of 5-bit chunks extracted from the random bytes. */
const CHUNK_COUNT = 16;

/** Bits per base32 character. */
const BITS_PER_CHUNK = 5;

/** Bits per byte. */
const BITS_PER_BYTE = 8;

/** Prefix for all system-generated beneficiary references. */
const PREFIX = "benpub_";

/** Regex matching a valid beneficiary reference (prefix + 16 base32 chars). */
const BENPUB_RE = /^benpub_[A-Z2-7]{16}$/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically random beneficiary reference.
 *
 * Reads 80 bits from `crypto.getRandomValues()`, encodes them as 16
 * RFC 4648 base32 characters, and prepends the `benpub_` prefix.
 *
 * @returns A string like `"benpub_7G9Q2KX4N5P8R2T6"`.
 */
export function generateBeneficiaryRef(): string {
  const bytes = new Uint8Array(RANDOM_BYTE_COUNT);
  crypto.getRandomValues(bytes);

  const chars: string[] = [];

  // Treat the 10 bytes as a continuous big-endian bit stream.
  // We maintain an accumulator that holds leftover bits from previous
  // bytes and shift in new bytes as needed.
  let accumulator = 0;
  let bitsAvailable = 0;
  let byteIndex = 0;

  for (let i = 0; i < CHUNK_COUNT; i++) {
    // Top up the accumulator until we have at least 5 bits.
    while (bitsAvailable < BITS_PER_CHUNK && byteIndex < RANDOM_BYTE_COUNT) {
      const b = bytes[byteIndex];
      if (b === undefined) break; // safety guard for noUncheckedIndexedAccess
      accumulator = (accumulator << BITS_PER_BYTE) | b;
      bitsAvailable += BITS_PER_BYTE;
      byteIndex++;
    }

    // Extract the top 5 bits.
    bitsAvailable -= BITS_PER_CHUNK;
    const value = (accumulator >> bitsAvailable) & 0x1f;
    const ch = BASE32_ALPHABET[value];
    if (ch === undefined) break; // safety guard
    chars.push(ch);
  }

  return PREFIX + chars.join("");
}

/**
 * Validate that a string is a well-formed beneficiary reference.
 *
 * Checks:
 * - Starts with `benpub_`.
 * - Followed by exactly 16 characters from the RFC 4648 base32
 *   alphabet (`A-Z`, `2-7` — excludes `0`, `1`, `8`, `9`).
 *
 * @returns `true` if the reference matches the expected format.
 */
export function isValidBeneficiaryRef(ref: string): boolean {
  return BENPUB_RE.test(ref);
}
