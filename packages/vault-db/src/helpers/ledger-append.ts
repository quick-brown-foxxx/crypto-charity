import { desc } from "drizzle-orm";
import {
  computeEventHash,
  ZERO_HASH,
  canonicalJson,
  isValidTimestamp,
  PayloadSchemas,
  ok,
  err,
} from "@open-care/vault-core";
import type {
  LedgerEvent,
  LedgerEventBase,
  Result,
} from "@open-care/vault-core";
import { ledgerEvents } from "../schema/vault-db.js";
import type { VaultDb, VaultDbTest } from "../client/vault.js";
import type { AppendLedgerEventInput, LedgerAppendError } from "./types.js";

const MAX_RETRIES = 3;
const MAX_PAYLOAD_LENGTH = 16384;

/**
 * Bump an ISO-8601 timestamp by a number of seconds.
 *
 * The input must be second-precision with a `Z` suffix (e.g.
 * `"2025-01-15T10:30:00Z"`).  Returns a new ISO-8601 string at the same
 * precision (milliseconds stripped).
 */
function bumpTimestamp(iso: string, seconds: number): string {
  const date = new Date(iso);
  date.setSeconds(date.getSeconds() + seconds);
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Append a new event to the hash-chained ledger.
 *
 * Validates input, reads the current chain head, computes the content-hash,
 * and inserts the row.  Retries with a bumped `created_at_utc` on `UNIQUE`
 * constraint conflicts (hash collisions) up to {@link MAX_RETRIES} times.
 *
 * @returns A {@link Result} with the fully-hashed {@link LedgerEvent} on
 *          success, or a structured {@link LedgerAppendError} on failure.
 */
export async function appendLedgerEvent(
  db: VaultDb | VaultDbTest,
  input: AppendLedgerEventInput,
): Promise<Result<LedgerEvent, LedgerAppendError>> {
  // ------------------------------------------------------------------
  // 1. Validate input
  // ------------------------------------------------------------------

  // Check event_type is recognised (defensive — the type system guarantees
  // this at compile time, but runtime data may be malformed).
  const payloadSchema = PayloadSchemas[input.event_type];
  if (!payloadSchema) {
    return err({
      code: "INVALID_INPUT",
      message: `Unknown event_type: ${input.event_type}`,
    });
  }

  // Parse payload against the type-specific Zod schema.
  const parseResult = payloadSchema.safeParse(input.payload);
  if (!parseResult.success) {
    return err({
      code: "INVALID_INPUT",
      message: "Payload validation failed",
      zodError: parseResult.error,
    });
  }

  // Validate the timestamp format.
  if (!isValidTimestamp(input.created_at_utc)) {
    return err({
      code: "INVALID_INPUT",
      message: "Invalid created_at_utc timestamp",
    });
  }

  // ------------------------------------------------------------------
  // 2. Serialize payload and enforce length limit
  // ------------------------------------------------------------------

  const payload_json = canonicalJson(input.payload);
  if (payload_json.length > MAX_PAYLOAD_LENGTH) {
    return err({
      code: "INVALID_INPUT",
      message: `Payload JSON exceeds ${MAX_PAYLOAD_LENGTH} bytes`,
    });
  }

  // ------------------------------------------------------------------
  // 3. Read current chain head
  // ------------------------------------------------------------------

  // Narrow the union type — both VaultDb (D1) and VaultDbTest
  // (better-sqlite3) share the same Drizzle query builder API, but
  // TypeScript may reject method calls on the union due to
  // driver-specific generic return types.
  const d = db as VaultDb;

  const head = await d
    .select()
    .from(ledgerEvents)
    .orderBy(desc(ledgerEvents.sequence_no))
    .limit(1)
    .get();

  let prev_hash: string;
  let next_sequence_no: number;

  if (head) {
    prev_hash = head.event_hash;
    next_sequence_no = head.sequence_no + 1;
  } else {
    prev_hash = ZERO_HASH;
    next_sequence_no = 1;
  }

  // ------------------------------------------------------------------
  // 4. Build the base event (without event_hash)
  // ------------------------------------------------------------------

  const base: LedgerEventBase = {
    sequence_no: next_sequence_no,
    event_type: input.event_type,
    payload: input.payload,
    prev_hash,
    created_at_utc: input.created_at_utc,
  };

  // ------------------------------------------------------------------
  // 5. Compute initial content-hash
  // ------------------------------------------------------------------

  let event_hash = await computeEventHash(base);

  // ------------------------------------------------------------------
  // 6-7. Insert with retry on UNIQUE constraint conflict
  // ------------------------------------------------------------------

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await d.insert(ledgerEvents).values({
        event_type: input.event_type,
        payload_json,
        prev_hash,
        event_hash,
        created_at_utc: base.created_at_utc,
      });
      break; // success — exit the retry loop
    } catch (error) {
      const msg = String(error);
      if (msg.includes("UNIQUE constraint failed") && attempt < MAX_RETRIES) {
        // Bump timestamp by 1 second per attempt and recompute the hash.
        // The changed created_at_utc alters the preimage, producing a
        // different event_hash that should not collide.
        const bumped = bumpTimestamp(input.created_at_utc, attempt + 1);
        base.created_at_utc = bumped;
        event_hash = await computeEventHash(base);
        continue;
      }
      if (msg.includes("UNIQUE constraint failed")) {
        return err({
          code: "HASH_COLLISION",
          message: "Failed after max retries",
        });
      }
      return err({
        code: "DB_ERROR",
        message: msg,
        cause: error,
      });
    }
  }

  // ------------------------------------------------------------------
  // 8. Return the fully-hashed ledger event
  // ------------------------------------------------------------------

  return ok({
    sequence_no: next_sequence_no,
    event_type: input.event_type,
    payload: input.payload,
    prev_hash,
    event_hash,
    created_at_utc: base.created_at_utc,
  });
}
