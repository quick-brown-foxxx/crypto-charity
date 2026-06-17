import DatabaseConstructor from "better-sqlite3";
import type { Database } from "better-sqlite3";
import { createVaultDbTest, type VaultDbTest } from "../src/client/vault.js";

// ---------------------------------------------------------------------------
// DDL from apps/ingest/migrations/0001_initial_schema.sql (vault-db schema)
// Embedded here so tests are self-contained and don't depend on file layout.
// ---------------------------------------------------------------------------

const VAULT_DB_DDL = `
CREATE TABLE ledger_events (
    sequence_no      INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type       TEXT NOT NULL CHECK (event_type IN (
                         'donation_confirmed',
                         'disbursement_recorded',
                         'anchor_published',
                         'correction_recorded'
                     )),
    payload_json     TEXT NOT NULL
                     CHECK (length(payload_json) > 0
                            AND length(payload_json) <= 16384),
    prev_hash        TEXT NOT NULL,
    event_hash       TEXT NOT NULL UNIQUE,
    created_at_utc   TEXT NOT NULL
                     CHECK (created_at_utc GLOB '????-??-??T??:??:??Z')
);

CREATE INDEX idx_ledger_events_type_sequence
    ON ledger_events(event_type, sequence_no);

CREATE TABLE wallets (
    id                   INTEGER PRIMARY KEY,
    role                 TEXT NOT NULL CHECK (role IN ('treasury', 'anchor')),
    cluster              TEXT NOT NULL CHECK (cluster IN ('mainnet-beta', 'devnet', 'localnet')),
    address              TEXT NOT NULL UNIQUE,
    usdc_mint            TEXT,
    usdc_ata             TEXT,
    label                TEXT NOT NULL,
    active               INTEGER NOT NULL DEFAULT 1,
    created_at_utc       TEXT NOT NULL
);

CREATE TABLE anchor_runs (
    id                          INTEGER PRIMARY KEY,
    anchor_date                 TEXT NOT NULL,
    anchored_head_sequence_no   INTEGER NOT NULL,
    anchored_head_hash          TEXT NOT NULL,
    status                      TEXT NOT NULL
                                CHECK (status IN ('pending', 'sending', 'published', 'failed')),
    trigger_source              TEXT
                                CHECK (trigger_source IS NULL
                                       OR trigger_source IN ('cron', 'operator-manual', 'reconciliation')),
    tx_signature                TEXT,
    anchor_wallet_address       TEXT NOT NULL,
    memo_text                   TEXT NOT NULL,
    attempt_count               INTEGER NOT NULL DEFAULT 0,
    last_error                  TEXT,
    locked_until_utc            TEXT,
    last_anchor_wallet_sol_lamports INTEGER,
    created_at_utc              TEXT NOT NULL,
    updated_at_utc              TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_anchor_runs_date_head
    ON anchor_runs(anchor_date, anchored_head_hash);

CREATE TABLE helius_inbox (
    signature           TEXT NOT NULL,
    source              TEXT NOT NULL CHECK (source IN ('webhook', 'reconciliation')),
    raw_payload_json    TEXT NOT NULL
                        CHECK (length(raw_payload_json) > 0
                               AND length(raw_payload_json) <= 65536),
    status              TEXT NOT NULL CHECK (status IN ('received', 'processing', 'processed', 'ignored', 'failed', 'duplicate')),
    reason              TEXT,
    attempt_count       INTEGER NOT NULL DEFAULT 0,
    last_error          TEXT,
    received_at_utc     TEXT NOT NULL,
    updated_at_utc      TEXT NOT NULL,
    PRIMARY KEY (signature, source)
);

CREATE INDEX idx_helius_inbox_status_received
    ON helius_inbox(status, received_at_utc);
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TestVaultDb {
  db: VaultDbTest;
  sqliteDb: Database;
}

/** Create an in-memory SQLite database with the vault-db DDL applied. */
export function createTestVaultDb(): TestVaultDb {
  const sqliteDb = new DatabaseConstructor(":memory:");
  sqliteDb.pragma("journal_mode = WAL");
  sqliteDb.exec(VAULT_DB_DDL);

  const db = createVaultDbTest(sqliteDb);
  return { db, sqliteDb };
}
