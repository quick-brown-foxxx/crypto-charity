import { describe, it, expect, beforeEach } from "vitest";
import { createTestVaultDb } from "./setup.js";
import { appendLedgerEvent, getEventsPaginated } from "../src/index.js";
import {
  ZERO_HASH,
  computeEventHash,
  verifyChain,
} from "@open-care/vault-core";
import type { DonationPayload, LedgerEventBase } from "@open-care/vault-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDonationPayload(
  overrides?: Partial<DonationPayload>,
): DonationPayload {
  return {
    cluster: "devnet",
    usdc_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    treasury_wallet_address:
      "treasury1111111111111111111111111111111111", // 44 chars
    vault_usdc_ata:
      "vault11111111111111111111111111111111111111", // 44 chars
    tx_signature:
      "5K4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z",
    transaction_version: 0,
    instruction_index: 0,
    inner_index: null,
    slot: 100,
    block_time_utc: "2025-01-15T10:30:00Z",
    amount_usdc_minor: "1000000", // 1 USDC
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("appendLedgerEvent", () => {
  let vault: ReturnType<typeof createTestVaultDb>;

  beforeEach(() => {
    vault = createTestVaultDb();
  });

  // ------------------------------------------------------------------
  // 1. First event (empty ledger)
  // ------------------------------------------------------------------

  it("appends the first event to an empty ledger", async () => {
    const { db } = vault;
    const payload = makeDonationPayload();

    const result = await appendLedgerEvent(db, {
      event_type: "donation_confirmed",
      payload,
      created_at_utc: "2025-01-15T10:30:00Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(result.value.sequence_no).toBe(1);
    expect(result.value.prev_hash).toBe(ZERO_HASH);
    expect(result.value.event_hash).toHaveLength(64);
    expect(result.value.event_hash).toMatch(/^[0-9a-f]{64}$/);

    // Verify event_hash matches computeEventHash for the same base
    const base: LedgerEventBase = {
      sequence_no: result.value.sequence_no,
      event_type: result.value.event_type,
      payload: result.value.payload,
      prev_hash: result.value.prev_hash,
      created_at_utc: result.value.created_at_utc,
    };
    const computed = await computeEventHash(base);
    expect(result.value.event_hash).toBe(computed);
  });

  // ------------------------------------------------------------------
  // 2. Chain building (multiple events)
  // ------------------------------------------------------------------

  it("builds a valid hash chain across multiple events", async () => {
    const { db } = vault;

    const p1 = makeDonationPayload({
      tx_signature: "sig1111111111111111111111111111111111111111111111111111",
      amount_usdc_minor: "1000000",
    });
    const p2 = makeDonationPayload({
      tx_signature: "sig2222222222222222222222222222222222222222222222222222",
      amount_usdc_minor: "2000000",
    });
    const p3 = makeDonationPayload({
      tx_signature: "sig3333333333333333333333333333333333333333333333333333",
      amount_usdc_minor: "3000000",
    });

    const r1 = await appendLedgerEvent(db, {
      event_type: "donation_confirmed",
      payload: p1,
      created_at_utc: "2025-01-15T10:30:01Z",
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error("expected ok");
    expect(r1.value.sequence_no).toBe(1);

    const r2 = await appendLedgerEvent(db, {
      event_type: "donation_confirmed",
      payload: p2,
      created_at_utc: "2025-01-15T10:30:02Z",
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) throw new Error("expected ok");
    expect(r2.value.sequence_no).toBe(2);
    expect(r2.value.prev_hash).toBe(r1.value.event_hash);

    const r3 = await appendLedgerEvent(db, {
      event_type: "donation_confirmed",
      payload: p3,
      created_at_utc: "2025-01-15T10:30:03Z",
    });
    expect(r3.ok).toBe(true);
    if (!r3.ok) throw new Error("expected ok");
    expect(r3.value.sequence_no).toBe(3);
    expect(r3.value.prev_hash).toBe(r2.value.event_hash);

    // Read all events back and verify the chain
    const page = await getEventsPaginated(db, { limit: 100 });
    expect(page.items).toHaveLength(3);
    const chainResult = await verifyChain(page.items);
    expect(chainResult.valid).toBe(true);
  });

  // ------------------------------------------------------------------
  // 3. Hash is deterministic for same preimage
  // ------------------------------------------------------------------

  it("produces a deterministic hash for the same preimage", async () => {
    const { db } = vault;
    const payload = makeDonationPayload();

    const result = await appendLedgerEvent(db, {
      event_type: "donation_confirmed",
      payload,
      created_at_utc: "2025-01-15T10:30:00Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    // Compute hash manually for the same base
    const base: LedgerEventBase = {
      sequence_no: 1,
      event_type: "donation_confirmed",
      payload,
      prev_hash: ZERO_HASH,
      created_at_utc: "2025-01-15T10:30:00Z",
    };
    const manualHash = await computeEventHash(base);

    expect(result.value.event_hash).toBe(manualHash);
  });

  // ------------------------------------------------------------------
  // 4. Different sequence_no produces different hash
  // ------------------------------------------------------------------

  it("produces different hashes when sequence_no differs", async () => {
    const { db } = vault;
    const payload = makeDonationPayload();

    const r1 = await appendLedgerEvent(db, {
      event_type: "donation_confirmed",
      payload,
      created_at_utc: "2025-01-15T10:30:00Z",
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error("expected ok");

    // Second event with same payload — sequence_no will be 2, prev_hash
    // will be r1.event_hash, so the preimage differs.
    const r2 = await appendLedgerEvent(db, {
      event_type: "donation_confirmed",
      payload,
      created_at_utc: "2025-01-15T10:30:00Z",
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) throw new Error("expected ok");

    expect(r2.value.sequence_no).toBe(2);
    expect(r1.value.event_hash).not.toBe(r2.value.event_hash);
  });

  // ------------------------------------------------------------------
  // 5. Invalid event_type
  // ------------------------------------------------------------------

  it("rejects an unknown event_type", async () => {
    const { db } = vault;

    const result = await appendLedgerEvent(db, {
      // @ts-expect-error — intentionally passing an invalid event_type for testing
      event_type: "invalid",
      payload: makeDonationPayload(),
      created_at_utc: "2025-01-15T10:30:00Z",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error.code).toBe("INVALID_INPUT");
    expect(result.error.message).toBe("Unknown event_type: invalid");
  });

  // ------------------------------------------------------------------
  // 6. Invalid payload (fails Zod schema)
  // ------------------------------------------------------------------

  it("rejects a payload that fails Zod validation", async () => {
    const { db } = vault;

    const result = await appendLedgerEvent(db, {
      event_type: "donation_confirmed",
      payload: makeDonationPayload({ amount_usdc_minor: "0" }),
      created_at_utc: "2025-01-15T10:30:00Z",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error.code).toBe("INVALID_INPUT");
    expect(result.error.message).toBe("Payload validation failed");
    expect(result.error.zodError).toBeDefined();
  });

  // ------------------------------------------------------------------
  // 7. Invalid timestamp
  // ------------------------------------------------------------------

  it("rejects an invalid created_at_utc timestamp", async () => {
    const { db } = vault;

    const result = await appendLedgerEvent(db, {
      event_type: "donation_confirmed",
      payload: makeDonationPayload(),
      created_at_utc: "not-a-timestamp",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error.code).toBe("INVALID_INPUT");
    expect(result.error.message).toBe("Invalid created_at_utc timestamp");
  });

  // ------------------------------------------------------------------
  // 8. Payload too large
  // ------------------------------------------------------------------

  it("rejects a payload whose canonical JSON exceeds 16384 bytes", async () => {
    const { db } = vault;

    // The Zod schema for donation_confirmed strips unknown keys, so
    // validation passes.  But canonicalJson serializes the *original*
    // input object, which includes the extra long field, pushing the
    // serialized length past the 16384-byte limit.
    const payload = {
      ...makeDonationPayload(),
      // ~20000 chars of 'x' guarantees the canonical JSON exceeds 16384 bytes
      extra_long_field: "x".repeat(20000),
    };

    const result = await appendLedgerEvent(db, {
      event_type: "donation_confirmed",
      // @ts-expect-error — extra_long_field is not part of DonationPayload, used to exceed size limit
      payload: payload,
      created_at_utc: "2025-01-15T10:30:00Z",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error.code).toBe("INVALID_INPUT");
    expect(result.error.message).toContain("16384");
  });

  // ------------------------------------------------------------------
  // 9. Hash collision retry
  // ------------------------------------------------------------------

  it("retries with a bumped timestamp on hash collision", async () => {
    const { db, sqliteDb } = vault;

    // Step 1 — append event A
    const payloadA = makeDonationPayload({
      tx_signature: "sigAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    });
    const rA = await appendLedgerEvent(db, {
      event_type: "donation_confirmed",
      payload: payloadA,
      created_at_utc: "2025-01-15T10:30:00Z",
    });
    expect(rA.ok).toBe(true);
    if (!rA.ok) throw new Error("expected ok");

    // Step 2 — compute what event B's hash *would* be if appended next
    const payloadB = makeDonationPayload({
      tx_signature: "sigBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    });
    const timestampB = "2025-01-15T10:30:02Z";

    const baseB: LedgerEventBase = {
      sequence_no: 2,
      event_type: "donation_confirmed",
      payload: payloadB,
      prev_hash: rA.value.event_hash,
      created_at_utc: timestampB,
    };
    const hashB = await computeEventHash(baseB);

    // Step 3 — manually insert a row that occupies hashB so the real
    // insert hits a UNIQUE constraint.  Use sequence_no = 0 so the
    // head query still returns event A (sequence_no = 1).
    sqliteDb
      .prepare(
        `INSERT INTO ledger_events
           (sequence_no, event_type, payload_json, prev_hash, event_hash, created_at_utc)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        0,
        "donation_confirmed",
        "{}",
        ZERO_HASH,
        hashB,
        "2025-01-15T10:30:00Z",
      );

    // Step 4 — try to append event B; it should collide, retry, and
    // succeed with a bumped created_at_utc.
    const rB = await appendLedgerEvent(db, {
      event_type: "donation_confirmed",
      payload: payloadB,
      created_at_utc: timestampB,
    });

    expect(rB.ok).toBe(true);
    if (!rB.ok) throw new Error("expected ok");

    // The returned created_at_utc must differ from the input because
    // the retry loop bumped it.
    expect(rB.value.created_at_utc).not.toBe(timestampB);
    // It should be exactly 1 second later (first retry, attempt 0 → +1s)
    expect(rB.value.created_at_utc).toBe("2025-01-15T10:30:03Z");
    // The event_hash must differ from hashB (preimage changed)
    expect(rB.value.event_hash).not.toBe(hashB);
    // Sequence number should still be 2 (head was event A)
    expect(rB.value.sequence_no).toBe(2);
  });

  // ------------------------------------------------------------------
  // 10. Returned event is complete
  // ------------------------------------------------------------------

  it("returns a complete LedgerEvent with all fields", async () => {
    const { db } = vault;
    const payload = makeDonationPayload();

    const result = await appendLedgerEvent(db, {
      event_type: "donation_confirmed",
      payload,
      created_at_utc: "2025-01-15T10:30:00Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    const event = result.value;

    // All fields present
    expect(event.sequence_no).toBe(1);
    expect(event.event_type).toBe("donation_confirmed");
    expect(event.prev_hash).toBe(ZERO_HASH);
    expect(event.event_hash).toHaveLength(64);
    expect(event.created_at_utc).toBe("2025-01-15T10:30:00Z");

    // Payload is the original typed object, not a JSON string
    expect(typeof event.payload).toBe("object");
    expect(event.payload.cluster).toBe("devnet");
    expect(event.payload.amount_usdc_minor).toBe("1000000");
    expect(event.payload.tx_signature).toBe(payload.tx_signature);
    expect(event.payload.slot).toBe(100);
  });
});
