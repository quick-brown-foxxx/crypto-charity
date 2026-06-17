/**
 * Anchor memo construction and parsing.
 *
 * The anchor memo is a Solana transaction memo string that records a
 * cryptographic commitment to the current ledger state. It is written
 * by the anchor cron Worker and verified by the read API to prove that
 * the published ledger has not been tampered with.
 *
 * Format: `ccv-anchor:<64-lowercase-hex-chars>`
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Prefix that identifies an anchor memo. */
const MEMO_PREFIX = "ccv-anchor:";

/** Expected length of the hex-encoded hash (SHA-256 = 32 bytes = 64 hex). */
const HASH_HEX_LENGTH = 64;

/** Regex for a valid 64-char lowercase hex string. */
const HEX64_RE = /^[0-9a-f]{64}$/;

/** Regex for a complete anchor memo string. */
const ANCHOR_MEMO_RE = /^ccv-anchor:([0-9a-f]{64})$/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build an anchor memo string from a 64-character lowercase hex hash.
 *
 * The hash is typically a SHA-256 digest of the serialised ledger head.
 *
 * @param headHash - 64 lowercase hex characters.
 * @returns The full memo string, e.g. `"ccv-anchor:ab12cd34...64hex"`.
 * @throws {Error} If `headHash` is not exactly 64 lowercase hex chars.
 *   This is a programming error (caller must provide a valid hash),
 *   not an expected runtime failure, so we throw rather than returning
 *   a Result.
 */
export function buildAnchorMemo(headHash: string): string {
  if (!HEX64_RE.test(headHash)) {
    throw new Error(
      `buildAnchorMemo: headHash must be ${HASH_HEX_LENGTH} lowercase hex chars, got "${headHash}"`,
    );
  }

  return MEMO_PREFIX + headHash;
}

/**
 * Parse an anchor memo string and extract the 64-character hex hash.
 *
 * @param memo - A raw Solana transaction memo string.
 * @returns The extracted hex hash if the memo matches the anchor format,
 *   or `null` if it does not.
 */
export function parseAnchorMemo(memo: string): string | null {
  const match = ANCHOR_MEMO_RE.exec(memo);
  if (match === null) return null;
  const hash = match[1];
  return hash ?? null;
}
