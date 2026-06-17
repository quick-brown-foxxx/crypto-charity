import { desc, eq, gt, and, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  parseLedgerEvent,
  DonationPayloadSchema,
  DisbursementPayloadSchema,
} from "@open-care/vault-core";
import type {
  LedgerEvent,
  DonationPayload,
  DisbursementPayload,
} from "@open-care/vault-core";
import { ledgerEvents, anchorRuns } from "../schema/vault-db.js";
import type { VaultDb, VaultDbTest } from "../client/vault.js";
import type {
  PaginationOptions,
  PaginatedResult,
  Totals,
  DonationView,
  DisbursementView,
} from "./types.js";

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Parse a raw ledger_events row into a fully-typed {@link LedgerEvent}.
 * Throws if the payload fails validation (indicates database corruption).
 */
function rowToLedgerEvent(
  row: typeof ledgerEvents.$inferSelect,
): LedgerEvent {
  const rawPayload = JSON.parse(row.payload_json) as unknown;
  const result = parseLedgerEvent({
    sequence_no: row.sequence_no,
    event_type: row.event_type,
    payload: rawPayload,
    prev_hash: row.prev_hash,
    created_at_utc: row.created_at_utc,
  });
  if (!result.ok) {
    throw new Error(
      `Corrupt ledger event at sequence_no ${row.sequence_no}: invalid payload`,
    );
  }
  return { ...result.value, event_hash: row.event_hash };
}

/**
 * Validate a raw JSON payload against a Zod schema, throwing on failure.
 * Returns the narrowed payload type.
 */
function validatePayload<T>(
  sequenceNo: number,
  rawPayload: unknown,
  schema: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: unknown } },
  label: string,
): T {
  const result = schema.safeParse(rawPayload);
  if (!result.success) {
    throw new Error(`Corrupt ${label} payload at sequence_no ${sequenceNo}`);
  }
  // safeParse guarantees data is defined when success is true
  return result.data as T;
}

// ---------------------------------------------------------------------------
// Public query helpers
// ---------------------------------------------------------------------------

/**
 * Returns the latest ledger event (highest `sequence_no`), or `null` if the
 * ledger is empty.
 */
export async function getHead(
  db: VaultDb | VaultDbTest,
): Promise<LedgerEvent | null> {
  const rows = await db
    .select()
    .from(ledgerEvents)
    .orderBy(desc(ledgerEvents.sequence_no))
    .limit(1)
    .all();

  const row = rows[0];
  if (!row) return null;
  return rowToLedgerEvent(row);
}

/**
 * Cursor-based paginated list of all ledger events.
 *
 * @param options.cursor - Return events with `sequence_no` greater than this
 *   value (exclusive). Omit to start from the beginning.
 * @param options.limit  - Page size (default 50, max 100).
 * @param options.eventType - Optional filter to a single event type.
 */
export async function getEventsPaginated(
  db: VaultDb | VaultDbTest,
  options: PaginationOptions,
): Promise<PaginatedResult<LedgerEvent>> {
  const limit = Math.min(options.limit ?? 50, 100);

  const conditions: SQL[] = [];
  if (options.cursor !== undefined) {
    conditions.push(gt(ledgerEvents.sequence_no, options.cursor));
  }
  if (options.eventType !== undefined) {
    conditions.push(eq(ledgerEvents.event_type, options.eventType));
  }

  // Build query with conditions applied
  let base = db.select().from(ledgerEvents);
  if (conditions.length > 0) {
    base = base.where(and(...conditions)) as typeof base;
  }

  const rows = await base
    .orderBy(ledgerEvents.sequence_no)
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const pageItems = hasMore ? rows.slice(0, limit) : rows;
  const lastItem = pageItems[pageItems.length - 1];
  const nextCursor: number | null =
    hasMore && lastItem ? lastItem.sequence_no : null;

  return {
    items: pageItems.map(rowToLedgerEvent),
    nextCursor,
  };
}

/**
 * Aggregate totals from donation and disbursement events.
 *
 * Uses raw SQL with SQLite JSON functions so aggregation happens server-side.
 * Sums are returned as decimal strings (via `BigInt` → `.toString()`).
 */
export async function getTotals(
  db: VaultDb | VaultDbTest,
): Promise<Totals> {
  // Raw SQL avoids the VaultDb | VaultDbTest union-type issues with the
  // query builder's .get() return type.  db.all() accepts SQLWrapper and
  // returns unknown[]; we cast the row shape explicitly.
  interface AggRow {
    total: number;
    count: number;
  }

  const donationRows = await db.all<AggRow>(
    sql`SELECT COALESCE(SUM(CAST(json_extract(payload_json, '$.amount_usdc_minor') AS INTEGER)), 0) AS total, COUNT(*) AS count FROM ledger_events WHERE event_type = 'donation_confirmed'`,
  );

  const disbursementRows = await db.all<AggRow>(
    sql`SELECT COALESCE(SUM(CAST(json_extract(payload_json, '$.amount_usdc_minor') AS INTEGER)), 0) AS total, COUNT(*) AS count FROM ledger_events WHERE event_type = 'disbursement_recorded'`,
  );

  const dRow = donationRows[0];
  const bRow = disbursementRows[0];

  return {
    total_donations_usdc_minor: BigInt(dRow?.total ?? 0).toString(),
    total_disbursements_usdc_minor: BigInt(bRow?.total ?? 0).toString(),
    donation_count: dRow?.count ?? 0,
    disbursement_count: bRow?.count ?? 0,
  };
}

/**
 * Paginated donation views (flattened for public API consumption).
 *
 * Each row's payload is validated against {@link DonationPayloadSchema}.
 * Throws on validation failure (indicates database corruption).
 */
export async function getDonations(
  db: VaultDb | VaultDbTest,
  options: PaginationOptions,
): Promise<PaginatedResult<DonationView>> {
  const limit = Math.min(options.limit ?? 50, 100);

  const conditions: SQL[] = [
    eq(ledgerEvents.event_type, "donation_confirmed"),
  ];
  if (options.cursor !== undefined) {
    conditions.push(gt(ledgerEvents.sequence_no, options.cursor));
  }

  let base = db.select().from(ledgerEvents);
  if (conditions.length > 0) {
    base = base.where(and(...conditions)) as typeof base;
  }

  const rows = await base
    .orderBy(ledgerEvents.sequence_no)
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const pageItems = hasMore ? rows.slice(0, limit) : rows;
  const lastItem = pageItems[pageItems.length - 1];
  const nextCursor: number | null =
    hasMore && lastItem ? lastItem.sequence_no : null;

  const items: DonationView[] = [];
  for (const row of pageItems) {
    const rawPayload = JSON.parse(row.payload_json) as unknown;
    const p = validatePayload<DonationPayload>(
      row.sequence_no,
      rawPayload,
      DonationPayloadSchema,
      "donation",
    );
    items.push({
      sequence_no: row.sequence_no,
      event_hash: row.event_hash,
      created_at_utc: row.created_at_utc,
      tx_signature: p.tx_signature,
      amount_usdc_minor: p.amount_usdc_minor,
      slot: p.slot,
      block_time_utc: p.block_time_utc,
      cluster: p.cluster,
    });
  }

  return { items, nextCursor };
}

/**
 * Paginated disbursement views (flattened for public API consumption).
 *
 * Each row's payload is validated against {@link DisbursementPayloadSchema}.
 * Throws on validation failure (indicates database corruption).
 */
export async function getDisbursements(
  db: VaultDb | VaultDbTest,
  options: PaginationOptions,
): Promise<PaginatedResult<DisbursementView>> {
  const limit = Math.min(options.limit ?? 50, 100);

  const conditions: SQL[] = [
    eq(ledgerEvents.event_type, "disbursement_recorded"),
  ];
  if (options.cursor !== undefined) {
    conditions.push(gt(ledgerEvents.sequence_no, options.cursor));
  }

  let base = db.select().from(ledgerEvents);
  if (conditions.length > 0) {
    base = base.where(and(...conditions)) as typeof base;
  }

  const rows = await base
    .orderBy(ledgerEvents.sequence_no)
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const pageItems = hasMore ? rows.slice(0, limit) : rows;
  const lastItem = pageItems[pageItems.length - 1];
  const nextCursor: number | null =
    hasMore && lastItem ? lastItem.sequence_no : null;

  const items: DisbursementView[] = [];
  for (const row of pageItems) {
    const rawPayload = JSON.parse(row.payload_json) as unknown;
    const p = validatePayload<DisbursementPayload>(
      row.sequence_no,
      rawPayload,
      DisbursementPayloadSchema,
      "disbursement",
    );
    items.push({
      sequence_no: row.sequence_no,
      event_hash: row.event_hash,
      created_at_utc: row.created_at_utc,
      amount_usdc_minor: p.amount_usdc_minor,
      gift_card_count: p.gift_card_count,
      service: p.service,
      receipt_ref: p.receipt_ref,
      public_beneficiary_ref: p.public_beneficiary_ref,
      purchased_at_utc: p.purchased_at_utc,
      recorded_by: p.recorded_by,
    });
  }

  return { items, nextCursor };
}

/**
 * Returns the latest published anchor run, or `null` if none exist.
 *
 * Ordered by `anchored_head_sequence_no` descending so the run that
 * anchored the highest sequence number is returned.
 */
export async function getLatestAnchor(
  db: VaultDb | VaultDbTest,
): Promise<typeof anchorRuns.$inferSelect | null> {
  const rows = await db
    .select()
    .from(anchorRuns)
    .where(eq(anchorRuns.status, "published"))
    .orderBy(desc(anchorRuns.anchored_head_sequence_no))
    .limit(1)
    .all();

  const row = rows[0];
  return row ?? null;
}
