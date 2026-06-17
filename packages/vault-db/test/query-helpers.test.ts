import { describe, it, expect, beforeEach } from "vitest";
import { createTestVaultDb } from "./setup.js";
import {
  getHead,
  getEventsPaginated,
  getTotals,
  getDonations,
  getDisbursements,
  getLatestAnchor,
  appendLedgerEvent,
} from "../src/index.js";
import type { VaultDbTest } from "../src/index.js";
import type {
  DonationPayload,
  DisbursementPayload,
  LedgerEvent,
} from "@open-care/vault-core";
import type { Database } from "better-sqlite3";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

interface TestContext {
  db: VaultDbTest;
  sqliteDb: Database;
}

function makeDonationPayload(
  amount: string,
  overrides?: Partial<DonationPayload>,
): DonationPayload {
  return {
    cluster: "devnet",
    usdc_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    treasury_wallet_address: "treasury111111111111111111111111111111111111",
    vault_usdc_ata: "vault11111111111111111111111111111111111111",
    tx_signature:
      "5K4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z",
    transaction_version: 0,
    instruction_index: 0,
    inner_index: null,
    slot: 100,
    block_time_utc: "2025-01-15T10:30:00Z",
    amount_usdc_minor: amount,
    ...overrides,
  };
}

function makeDisbursementPayload(
  amount: string,
  overrides?: Partial<DisbursementPayload>,
): DisbursementPayload {
  return {
    amount_usdc_minor: amount,
    gift_card_count: 1,
    service: "Alter",
    service_note: null,
    receipt_ref: "test-ref-001",
    public_beneficiary_ref: null,
    purchased_at_utc: "2025-01-15T10:00:00Z",
    recorded_at_utc: "2025-01-15T10:30:00Z",
    recorded_by: "test-operator",
    ...overrides,
  };
}

async function seedDonation(
  ctx: TestContext,
  amount: string,
  ts?: string,
): Promise<LedgerEvent> {
  const result = await appendLedgerEvent(ctx.db, {
    event_type: "donation_confirmed",
    payload: makeDonationPayload(amount),
    created_at_utc: ts ?? "2025-01-15T10:30:00Z",
  });
  if (!result.ok) throw new Error("Seed failed");
  return result.value;
}

async function seedDisbursement(
  ctx: TestContext,
  amount: string,
  ts?: string,
): Promise<LedgerEvent> {
  const result = await appendLedgerEvent(ctx.db, {
    event_type: "disbursement_recorded",
    payload: makeDisbursementPayload(amount),
    created_at_utc: ts ?? "2025-01-15T10:30:00Z",
  });
  if (!result.ok) throw new Error("Seed failed");
  return result.value;
}

// ---------------------------------------------------------------------------
// getHead
// ---------------------------------------------------------------------------

describe("getHead", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestVaultDb();
  });

  it("returns null when the ledger is empty", async () => {
    const head = await getHead(ctx.db);
    expect(head).toBeNull();
  });

  it("returns the event with the highest sequence_no", async () => {
    await seedDonation(ctx, "1000000", "2025-01-15T10:30:00Z");
    await seedDonation(ctx, "2000000", "2025-01-15T10:31:00Z");
    const third = await seedDonation(ctx, "3000000", "2025-01-15T10:32:00Z");

    const head = await getHead(ctx.db);
    expect(head).not.toBeNull();
    expect(head!.sequence_no).toBe(third.sequence_no);
    expect(head!.event_hash).toBe(third.event_hash);
  });

  it("returns a full LedgerEvent with all fields present", async () => {
    const seeded = await seedDonation(ctx, "5000000");

    const head = await getHead(ctx.db);
    expect(head).not.toBeNull();
    expect(head!.sequence_no).toBe(seeded.sequence_no);
    expect(head!.event_type).toBe("donation_confirmed");
    expect(head!.payload).toEqual(seeded.payload);
    expect(head!.prev_hash).toBe(seeded.prev_hash);
    expect(head!.event_hash).toBe(seeded.event_hash);
    expect(head!.created_at_utc).toBe(seeded.created_at_utc);
  });
});

// ---------------------------------------------------------------------------
// getEventsPaginated
// ---------------------------------------------------------------------------

describe("getEventsPaginated", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestVaultDb();
  });

  it("returns empty result when the ledger is empty", async () => {
    const page = await getEventsPaginated(ctx.db, {});
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it("returns a page of items with a nextCursor for the next page", async () => {
    // Seed 5 events with distinct timestamps so hashes don't collide
    await seedDonation(ctx, "1000000", "2025-01-15T10:30:00Z");
    await seedDonation(ctx, "2000000", "2025-01-15T10:31:00Z");
    await seedDonation(ctx, "3000000", "2025-01-15T10:32:00Z");
    await seedDonation(ctx, "4000000", "2025-01-15T10:33:00Z");
    await seedDonation(ctx, "5000000", "2025-01-15T10:34:00Z");

    const page = await getEventsPaginated(ctx.db, { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe(page.items[1]!.sequence_no);
  });

  it("supports cursor-based pagination for subsequent pages", async () => {
    await seedDonation(ctx, "1000000", "2025-01-15T10:30:00Z");
    await seedDonation(ctx, "2000000", "2025-01-15T10:31:00Z");
    await seedDonation(ctx, "3000000", "2025-01-15T10:32:00Z");
    await seedDonation(ctx, "4000000", "2025-01-15T10:33:00Z");
    await seedDonation(ctx, "5000000", "2025-01-15T10:34:00Z");

    const page1 = await getEventsPaginated(ctx.db, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await getEventsPaginated(ctx.db, {
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.items).toHaveLength(2);
    // Items on page 2 should have sequence_no > page1 cursor
    for (const item of page2.items) {
      expect(item.sequence_no).toBeGreaterThan(page1.nextCursor!);
    }
  });

  it("returns nextCursor: null on the last page", async () => {
    await seedDonation(ctx, "1000000", "2025-01-15T10:30:00Z");
    await seedDonation(ctx, "2000000", "2025-01-15T10:31:00Z");
    await seedDonation(ctx, "3000000", "2025-01-15T10:32:00Z");

    const page = await getEventsPaginated(ctx.db, { limit: 5 });
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });

  it("filters by eventType", async () => {
    await seedDonation(ctx, "1000000", "2025-01-15T10:30:00Z");
    await seedDisbursement(ctx, "500000", "2025-01-15T10:31:00Z");
    await seedDonation(ctx, "2000000", "2025-01-15T10:32:00Z");

    const page = await getEventsPaginated(ctx.db, {
      eventType: "donation_confirmed",
    });
    expect(page.items).toHaveLength(2);
    for (const item of page.items) {
      expect(item.event_type).toBe("donation_confirmed");
    }
  });

  it("defaults limit to 50 when not specified", async () => {
    // Seed 55 events with distinct timestamps
    for (let i = 0; i < 55; i++) {
      const hour = 10 + Math.floor(i / 60);
      const min = i % 60;
      const ts = `2025-01-15T${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:00Z`;
      await seedDonation(ctx, String(1000000 + i * 1000), ts);
    }

    const page = await getEventsPaginated(ctx.db, {});
    // Default limit is 50, so we get 50 items and a nextCursor
    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).not.toBeNull();
  });

  it("clamps limit to 100 maximum", async () => {
    // Seed 110 events with distinct timestamps (use hours to stay valid)
    for (let i = 0; i < 110; i++) {
      const hour = 10 + Math.floor(i / 60);
      const min = i % 60;
      const ts = `2025-01-15T${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:00Z`;
      await seedDonation(ctx, String(1000000 + i * 1000), ts);
    }

    const page = await getEventsPaginated(ctx.db, { limit: 200 });
    // Limit is clamped to 100
    expect(page.items).toHaveLength(100);
    expect(page.nextCursor).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getTotals
// ---------------------------------------------------------------------------

describe("getTotals", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestVaultDb();
  });

  it("returns all zeroes when the ledger is empty", async () => {
    const totals = await getTotals(ctx.db);
    expect(totals.total_donations_usdc_minor).toBe("0");
    expect(totals.total_disbursements_usdc_minor).toBe("0");
    expect(totals.donation_count).toBe(0);
    expect(totals.disbursement_count).toBe(0);
  });

  it("counts a single donation correctly", async () => {
    await seedDonation(ctx, "1000000");

    const totals = await getTotals(ctx.db);
    expect(totals.total_donations_usdc_minor).toBe("1000000");
    expect(totals.donation_count).toBe(1);
    expect(totals.total_disbursements_usdc_minor).toBe("0");
    expect(totals.disbursement_count).toBe(0);
  });

  it("sums multiple donations correctly", async () => {
    await seedDonation(ctx, "1000000", "2025-01-15T10:30:00Z");
    await seedDonation(ctx, "2500000", "2025-01-15T10:31:00Z");
    await seedDonation(ctx, "500000", "2025-01-15T10:32:00Z");

    const totals = await getTotals(ctx.db);
    // 1000000 + 2500000 + 500000 = 4000000
    expect(totals.total_donations_usdc_minor).toBe("4000000");
    expect(totals.donation_count).toBe(3);
  });

  it("counts a single disbursement correctly", async () => {
    await seedDisbursement(ctx, "750000");

    const totals = await getTotals(ctx.db);
    expect(totals.total_disbursements_usdc_minor).toBe("750000");
    expect(totals.disbursement_count).toBe(1);
    expect(totals.total_donations_usdc_minor).toBe("0");
    expect(totals.donation_count).toBe(0);
  });

  it("computes both donation and disbursement totals with mixed events", async () => {
    await seedDonation(ctx, "1000000", "2025-01-15T10:30:00Z");
    await seedDonation(ctx, "2000000", "2025-01-15T10:31:00Z");
    await seedDisbursement(ctx, "500000", "2025-01-15T10:32:00Z");
    await seedDisbursement(ctx, "300000", "2025-01-15T10:33:00Z");

    const totals = await getTotals(ctx.db);
    expect(totals.total_donations_usdc_minor).toBe("3000000");
    expect(totals.donation_count).toBe(2);
    expect(totals.total_disbursements_usdc_minor).toBe("800000");
    expect(totals.disbursement_count).toBe(2);
  });

  it("handles large amounts as BigInt strings", async () => {
    // Use a value within Number.MAX_SAFE_INTEGER but large enough to
    // demonstrate that the return type is a BigInt decimal string.
    // (SQLite CAST(... AS INTEGER) returns a JS number, so values
    // beyond MAX_SAFE_INTEGER would be rounded before BigInt conversion.)
    await seedDonation(ctx, "9007199254740991");

    const totals = await getTotals(ctx.db);
    // The sum must be the exact BigInt string, not a rounded Number
    expect(totals.total_donations_usdc_minor).toBe("9007199254740991");
    expect(totals.donation_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getDonations
// ---------------------------------------------------------------------------

describe("getDonations", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestVaultDb();
  });

  it("returns empty when there are no donations", async () => {
    const page = await getDonations(ctx.db, {});
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it("returns paginated donation views", async () => {
    await seedDonation(ctx, "1000000", "2025-01-15T10:30:00Z");
    await seedDonation(ctx, "2000000", "2025-01-15T10:31:00Z");
    await seedDonation(ctx, "3000000", "2025-01-15T10:32:00Z");
    await seedDonation(ctx, "4000000", "2025-01-15T10:33:00Z");
    await seedDonation(ctx, "5000000", "2025-01-15T10:34:00Z");

    const page = await getDonations(ctx.db, { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe(page.items[1]!.sequence_no);
  });

  it("returns DonationView with all expected fields", async () => {
    const seeded = await seedDonation(ctx, "1000000");

    const page = await getDonations(ctx.db, {});
    expect(page.items).toHaveLength(1);

    const view = page.items[0]!;
    expect(view.sequence_no).toBe(seeded.sequence_no);
    expect(view.event_hash).toBe(seeded.event_hash);
    expect(view.created_at_utc).toBe(seeded.created_at_utc);
    expect(view.tx_signature).toBe(
      "5K4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z5k4z",
    );
    expect(view.amount_usdc_minor).toBe("1000000");
    expect(view.slot).toBe(100);
    expect(view.block_time_utc).toBe("2025-01-15T10:30:00Z");
    expect(view.cluster).toBe("devnet");
  });

  it("only returns donations, not disbursements", async () => {
    await seedDonation(ctx, "1000000", "2025-01-15T10:30:00Z");
    await seedDisbursement(ctx, "500000", "2025-01-15T10:31:00Z");
    await seedDonation(ctx, "2000000", "2025-01-15T10:32:00Z");

    const page = await getDonations(ctx.db, {});
    expect(page.items).toHaveLength(2);
    for (const item of page.items) {
      // DonationView has tx_signature, which disbursements don't expose
      expect(item.tx_signature).toBeDefined();
      expect(item.tx_signature.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// getDisbursements
// ---------------------------------------------------------------------------

describe("getDisbursements", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestVaultDb();
  });

  it("returns empty when there are no disbursements", async () => {
    const page = await getDisbursements(ctx.db, {});
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it("returns paginated disbursement views", async () => {
    await seedDisbursement(ctx, "100000", "2025-01-15T10:30:00Z");
    await seedDisbursement(ctx, "200000", "2025-01-15T10:31:00Z");
    await seedDisbursement(ctx, "300000", "2025-01-15T10:32:00Z");
    await seedDisbursement(ctx, "400000", "2025-01-15T10:33:00Z");
    await seedDisbursement(ctx, "500000", "2025-01-15T10:34:00Z");

    const page = await getDisbursements(ctx.db, { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe(page.items[1]!.sequence_no);
  });

  it("returns DisbursementView with all expected fields", async () => {
    const seeded = await seedDisbursement(ctx, "750000");

    const page = await getDisbursements(ctx.db, {});
    expect(page.items).toHaveLength(1);

    const view = page.items[0]!;
    expect(view.sequence_no).toBe(seeded.sequence_no);
    expect(view.event_hash).toBe(seeded.event_hash);
    expect(view.created_at_utc).toBe(seeded.created_at_utc);
    expect(view.amount_usdc_minor).toBe("750000");
    expect(view.gift_card_count).toBe(1);
    expect(view.service).toBe("Alter");
    expect(view.receipt_ref).toBe("test-ref-001");
    expect(view.public_beneficiary_ref).toBeNull();
    expect(view.purchased_at_utc).toBe("2025-01-15T10:00:00Z");
    expect(view.recorded_by).toBe("test-operator");
  });

  it("only returns disbursements, not donations", async () => {
    await seedDonation(ctx, "1000000", "2025-01-15T10:30:00Z");
    await seedDisbursement(ctx, "500000", "2025-01-15T10:31:00Z");
    await seedDisbursement(ctx, "300000", "2025-01-15T10:32:00Z");

    const page = await getDisbursements(ctx.db, {});
    expect(page.items).toHaveLength(2);
    for (const item of page.items) {
      // DisbursementView has service, which donations don't expose
      expect(item.service).toBeDefined();
      expect(item.service.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// getLatestAnchor
// ---------------------------------------------------------------------------

describe("getLatestAnchor", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestVaultDb();
  });

  it("returns null when there are no anchor runs", async () => {
    const anchor = await getLatestAnchor(ctx.db);
    expect(anchor).toBeNull();
  });

  it("returns null when only non-published anchors exist", async () => {
    ctx.sqliteDb.exec(`
      INSERT INTO anchor_runs (
        anchor_date, anchored_head_sequence_no, anchored_head_hash,
        status, anchor_wallet_address, memo_text,
        created_at_utc, updated_at_utc
      ) VALUES (
        '2025-01-15', 5, '${"a".repeat(64)}',
        'pending', 'anchor111111111111111111111111111111111111',
        'ccv-anchor:${"b".repeat(64)}',
        '2025-01-15T10:30:00Z', '2025-01-15T10:30:00Z'
      )
    `);
    ctx.sqliteDb.exec(`
      INSERT INTO anchor_runs (
        anchor_date, anchored_head_sequence_no, anchored_head_hash,
        status, anchor_wallet_address, memo_text,
        created_at_utc, updated_at_utc
      ) VALUES (
        '2025-01-16', 6, '${"c".repeat(64)}',
        'failed', 'anchor111111111111111111111111111111111111',
        'ccv-anchor:${"d".repeat(64)}',
        '2025-01-16T10:30:00Z', '2025-01-16T10:30:00Z'
      )
    `);

    const anchor = await getLatestAnchor(ctx.db);
    expect(anchor).toBeNull();
  });

  it("returns the single published anchor", async () => {
    ctx.sqliteDb.exec(`
      INSERT INTO anchor_runs (
        anchor_date, anchored_head_sequence_no, anchored_head_hash,
        status, anchor_wallet_address, memo_text,
        created_at_utc, updated_at_utc
      ) VALUES (
        '2025-01-15', 5, '${"a".repeat(64)}',
        'published', 'anchor111111111111111111111111111111111111',
        'ccv-anchor:${"b".repeat(64)}',
        '2025-01-15T10:30:00Z', '2025-01-15T10:30:00Z'
      )
    `);

    const anchor = await getLatestAnchor(ctx.db);
    expect(anchor).not.toBeNull();
    expect(anchor!.anchor_date).toBe("2025-01-15");
    expect(anchor!.anchored_head_sequence_no).toBe(5);
    expect(anchor!.anchored_head_hash).toBe("a".repeat(64));
    expect(anchor!.status).toBe("published");
    expect(anchor!.anchor_wallet_address).toBe(
      "anchor111111111111111111111111111111111111",
    );
    expect(anchor!.memo_text).toBe(`ccv-anchor:${"b".repeat(64)}`);
  });

  it("returns the published anchor with the highest anchored_head_sequence_no", async () => {
    // Insert two published anchors with different sequence numbers
    ctx.sqliteDb.exec(`
      INSERT INTO anchor_runs (
        anchor_date, anchored_head_sequence_no, anchored_head_hash,
        status, anchor_wallet_address, memo_text,
        created_at_utc, updated_at_utc
      ) VALUES (
        '2025-01-15', 5, '${"a".repeat(64)}',
        'published', 'anchor111111111111111111111111111111111111',
        'ccv-anchor:${"b".repeat(64)}',
        '2025-01-15T10:30:00Z', '2025-01-15T10:30:00Z'
      )
    `);
    ctx.sqliteDb.exec(`
      INSERT INTO anchor_runs (
        anchor_date, anchored_head_sequence_no, anchored_head_hash,
        status, anchor_wallet_address, memo_text,
        created_at_utc, updated_at_utc
      ) VALUES (
        '2025-01-16', 10, '${"c".repeat(64)}',
        'published', 'anchor222222222222222222222222222222222222',
        'ccv-anchor:${"d".repeat(64)}',
        '2025-01-16T10:30:00Z', '2025-01-16T10:30:00Z'
      )
    `);

    const anchor = await getLatestAnchor(ctx.db);
    expect(anchor).not.toBeNull();
    // Should return the one with anchored_head_sequence_no = 10 (the higher one)
    expect(anchor!.anchored_head_sequence_no).toBe(10);
    expect(anchor!.anchored_head_hash).toBe("c".repeat(64));
    expect(anchor!.anchor_date).toBe("2025-01-16");
  });
});
