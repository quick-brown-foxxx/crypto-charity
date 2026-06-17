import { sql } from "drizzle-orm";
import {
  sqliteTable,
  check,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// ledger_events — canonical append-only donor ledger
// ---------------------------------------------------------------------------

export const ledgerEvents = sqliteTable(
  "ledger_events",
  (t) => ({
    sequence_no: t.integer("sequence_no").primaryKey({ autoIncrement: true }),
    event_type: t.text("event_type").notNull(),
    payload_json: t.text("payload_json").notNull(),
    prev_hash: t.text("prev_hash").notNull(),
    event_hash: t.text("event_hash").notNull().unique(),
    created_at_utc: t.text("created_at_utc").notNull(),
  }),
  (table) => [
    check(
      "ledger_events_event_type_check",
      sql`${table.event_type} IN ('donation_confirmed','disbursement_recorded','anchor_published','correction_recorded')`,
    ),
    check(
      "ledger_events_payload_json_check",
      sql`length(${table.payload_json}) > 0 AND length(${table.payload_json}) <= 16384`,
    ),
    check(
      "ledger_events_created_at_utc_check",
      sql`${table.created_at_utc} GLOB '????-??-??T??:??:??Z'`,
    ),
    index("idx_ledger_events_type_sequence").on(
      table.event_type,
      table.sequence_no,
    ),
  ],
);

// ---------------------------------------------------------------------------
// wallets — wallet metadata (public configuration, not private key material)
// ---------------------------------------------------------------------------

export const wallets = sqliteTable(
  "wallets",
  (t) => ({
    id: t.integer("id").primaryKey(),
    role: t.text("role").notNull(),
    cluster: t.text("cluster").notNull(),
    address: t.text("address").notNull().unique(),
    usdc_mint: t.text("usdc_mint"),
    usdc_ata: t.text("usdc_ata"),
    label: t.text("label").notNull(),
    active: t.integer("active").notNull().default(1),
    created_at_utc: t.text("created_at_utc").notNull(),
  }),
  (table) => [
    check(
      "wallets_role_check",
      sql`${table.role} IN ('treasury', 'anchor')`,
    ),
    check(
      "wallets_cluster_check",
      sql`${table.cluster} IN ('mainnet-beta', 'devnet', 'localnet')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// anchor_runs — mutable runner state for anchor attempts
// ---------------------------------------------------------------------------

export const anchorRuns = sqliteTable(
  "anchor_runs",
  (t) => ({
    id: t.integer("id").primaryKey(),
    anchor_date: t.text("anchor_date").notNull(),
    anchored_head_sequence_no: t.integer("anchored_head_sequence_no").notNull(),
    anchored_head_hash: t.text("anchored_head_hash").notNull(),
    status: t.text("status").notNull(),
    trigger_source: t.text("trigger_source"),
    tx_signature: t.text("tx_signature"),
    anchor_wallet_address: t.text("anchor_wallet_address").notNull(),
    memo_text: t.text("memo_text").notNull(),
    attempt_count: t.integer("attempt_count").notNull().default(0),
    last_error: t.text("last_error"),
    locked_until_utc: t.text("locked_until_utc"),
    last_anchor_wallet_sol_lamports: t.integer(
      "last_anchor_wallet_sol_lamports",
    ),
    created_at_utc: t.text("created_at_utc").notNull(),
    updated_at_utc: t.text("updated_at_utc").notNull(),
  }),
  (table) => [
    check(
      "anchor_runs_status_check",
      sql`${table.status} IN ('pending', 'sending', 'published', 'failed')`,
    ),
    check(
      "anchor_runs_trigger_source_check",
      sql`${table.trigger_source} IS NULL OR ${table.trigger_source} IN ('cron', 'operator-manual', 'reconciliation')`,
    ),
    uniqueIndex("idx_anchor_runs_date_head").on(
      table.anchor_date,
      table.anchored_head_hash,
    ),
  ],
);

// ---------------------------------------------------------------------------
// helius_inbox — durable inbox for ACK-fast webhook handling and reconciliation
// ---------------------------------------------------------------------------

export const heliusInbox = sqliteTable(
  "helius_inbox",
  (t) => ({
    signature: t.text("signature").notNull(),
    source: t.text("source").notNull(),
    raw_payload_json: t.text("raw_payload_json").notNull(),
    status: t.text("status").notNull(),
    reason: t.text("reason"),
    attempt_count: t.integer("attempt_count").notNull().default(0),
    last_error: t.text("last_error"),
    received_at_utc: t.text("received_at_utc").notNull(),
    updated_at_utc: t.text("updated_at_utc").notNull(),
  }),
  (table) => [
    primaryKey({ columns: [table.signature, table.source] }),
    check(
      "helius_inbox_source_check",
      sql`${table.source} IN ('webhook', 'reconciliation')`,
    ),
    check(
      "helius_inbox_raw_payload_json_check",
      sql`length(${table.raw_payload_json}) > 0 AND length(${table.raw_payload_json}) <= 65536`,
    ),
    check(
      "helius_inbox_status_check",
      sql`${table.status} IN ('received', 'processing', 'processed', 'ignored', 'failed', 'duplicate')`,
    ),
    index("idx_helius_inbox_status_received").on(
      table.status,
      table.received_at_utc,
    ),
  ],
);
