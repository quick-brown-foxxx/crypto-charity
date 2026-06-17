import { canonicalJson } from './canonical-json.js';
import type { LedgerEvent, LedgerEventBase } from './events.js';

/** The hash value representing a null/zero predecessor (64 hex zeros). */
export const ZERO_HASH = '0'.repeat(64);

/**
 * Computes the SHA-256 event hash for a ledger event.
 *
 * The preimage includes only: sequence_no, event_type, payload, prev_hash,
 * and created_at_utc. The event_hash field itself is NOT part of the preimage.
 *
 * @returns 64 lowercase hex characters
 */
export async function computeEventHash(event: LedgerEventBase): Promise<string> {
  const preimage = {
    sequence_no: event.sequence_no,
    event_type: event.event_type,
    payload: event.payload,
    prev_hash: event.prev_hash,
    created_at_utc: event.created_at_utc,
  };

  const canonical = canonicalJson(preimage);
  const utf8Bytes = new TextEncoder().encode(canonical);
  const hashBuffer = await crypto.subtle.digest('SHA-256', utf8Bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));

  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verifies the integrity of a hash chain of ledger events.
 *
 * Checks:
 * 1. The chain is non-empty.
 * 2. The first event's prev_hash is ZERO_HASH (64 zeros).
 * 3. Every event's event_hash matches computeEventHash(event).
 * 4. Each subsequent event's prev_hash matches the previous event's event_hash.
 *
 * @returns `{ valid: true }` if the chain is valid, or
 *          `{ valid: false, error: "..." }` describing the first failure.
 */
export async function verifyChain(
  events: LedgerEvent[],
): Promise<{ valid: boolean; error?: string }> {
  if (events.length === 0) {
    return { valid: false, error: 'Chain is empty' };
  }

  // Check first event's prev_hash — must be 64 zeros.
  // With noUncheckedIndexedAccess, events[0] is LedgerEvent | undefined.
  // The length check above guarantees it exists, but we still guard to satisfy the compiler.
  const first = events[0];
  if (!first) {
    return { valid: false, error: 'Chain is empty' };
  }
  if (first.prev_hash !== ZERO_HASH) {
    return { valid: false, error: 'First event prev_hash must be 64 zeros' };
  }

  let previousEvent: LedgerEvent | null = null;

  for (const event of events) {
    // Verify event_hash matches computed hash.
    const computed = await computeEventHash(event);
    if (computed !== event.event_hash) {
      return {
        valid: false,
        error: `Event ${event.sequence_no} hash mismatch: expected ${computed}, got ${event.event_hash}`,
      };
    }

    // Verify chain link: prev_hash must match previous event's event_hash.
    if (previousEvent !== null) {
      if (event.prev_hash !== previousEvent.event_hash) {
        return {
          valid: false,
          error: `Chain broken at sequence_no ${event.sequence_no}: prev_hash does not match previous event_hash`,
        };
      }
    }

    previousEvent = event;
  }

  return { valid: true };
}
