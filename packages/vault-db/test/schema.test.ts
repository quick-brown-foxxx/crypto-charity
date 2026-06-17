import { describe, it, expect, beforeAll } from "vitest";
import { createTestVaultDb, type TestVaultDb } from "./setup.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 64-char hex string of all zeros. */
const ZERO_HASH = "0".repeat(64);
/** 64-char hex string of all 'a's. */
const HASH_A = "a".repeat(64);
/** 64-char hex string of all 'b's. */
const HASH_B = "b".repeat(64);

/** Valid ISO-8601 UTC timestamp. */
const VALID_TS = "2025-06-17T12:00:00Z";

/** Create a fresh in-memory DB for constraint tests that need isolation. */
function freshDb(): TestVaultDb {
  return createTestVaultDb();
}

/**
 * Query PRAGMA table_info and return rows as an array of
 * { cid, name, type, notnull, dflt_value, pk }.
 */
function tableInfo(
  sqliteDb: ReturnType<typeof freshDb>["sqliteDb"],
  tableName: string,
): { cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number }[] {
  const stmt = sqliteDb.prepare(`PRAGMA table_info('${tableName}')`);
  return stmt.all() as {
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }[];
}

/**
 * Query PRAGMA index_list and return rows as an array of
 * { seq, name, unique, origin, partial }.
 */
function indexList(
  sqliteDb: ReturnType<typeof freshDb>["sqliteDb"],
  tableName: string,
): { seq: number; name: string; unique: number; origin: string; partial: number }[] {
  const stmt = sqliteDb.prepare(`PRAGMA index_list('${tableName}')`);
  return stmt.all() as {
    seq: number;
    name: string;
    unique: number;
    origin: string;
    partial: number;
  }[];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("vault-db schema", () => {
  let testDb: TestVaultDb;

  beforeAll(() => {
    testDb = createTestVaultDb();
  });

  // =========================================================================
  // ledger_events
  // =========================================================================

  describe("ledger_events", () => {
    it("table exists and has correct columns", () => {
      const cols = tableInfo(testDb.sqliteDb, "ledger_events");
      const names = cols.map((c) => c.name);
      expect(names).toEqual([
        "sequence_no",
        "event_type",
        "payload_json",
        "prev_hash",
        "event_hash",
        "created_at_utc",
      ]);

      // Verify types
      const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
      expect(byName.sequence_no.type).toBe("INTEGER");
      expect(byName.event_type.type).toBe("TEXT");
      expect(byName.payload_json.type).toBe("TEXT");
      expect(byName.prev_hash.type).toBe("TEXT");
      expect(byName.event_hash.type).toBe("TEXT");
      expect(byName.created_at_utc.type).toBe("TEXT");
    });

    it("sequence_no is INTEGER PRIMARY KEY AUTOINCREMENT", () => {
      const cols = tableInfo(testDb.sqliteDb, "ledger_events");
      const seqCol = cols.find((c) => c.name === "sequence_no");
      expect(seqCol).toBeDefined();
      expect(seqCol!.pk).toBe(1);
      expect(seqCol!.type).toBe("INTEGER");

      // Verify auto-increment behavior by inserting two rows
      const db = freshDb();
      db.sqliteDb.exec(`
        INSERT INTO ledger_events (event_type, payload_json, prev_hash, event_hash, created_at_utc)
        VALUES ('donation_confirmed', '{"amount":1}', '${ZERO_HASH}', '${HASH_A}', '${VALID_TS}')
      `);
      db.sqliteDb.exec(`
        INSERT INTO ledger_events (event_type, payload_json, prev_hash, event_hash, created_at_utc)
        VALUES ('donation_confirmed', '{"amount":2}', '${HASH_A}', '${HASH_B}', '${VALID_TS}')
      `);
      const rows = db.sqliteDb
        .prepare("SELECT sequence_no FROM ledger_events ORDER BY sequence_no")
        .all() as { sequence_no: number }[];
      expect(rows).toHaveLength(2);
      expect(rows[0].sequence_no).toBe(1);
      expect(rows[1].sequence_no).toBe(2);
    });

    it("event_type is TEXT NOT NULL", () => {
      const cols = tableInfo(testDb.sqliteDb, "ledger_events");
      const col = cols.find((c) => c.name === "event_type");
      expect(col).toBeDefined();
      expect(col!.type).toBe("TEXT");
      expect(col!.notnull).toBe(1);
    });

    it("payload_json is TEXT NOT NULL", () => {
      const cols = tableInfo(testDb.sqliteDb, "ledger_events");
      const col = cols.find((c) => c.name === "payload_json");
      expect(col).toBeDefined();
      expect(col!.type).toBe("TEXT");
      expect(col!.notnull).toBe(1);
    });

    it("prev_hash is TEXT NOT NULL", () => {
      const cols = tableInfo(testDb.sqliteDb, "ledger_events");
      const col = cols.find((c) => c.name === "prev_hash");
      expect(col).toBeDefined();
      expect(col!.type).toBe("TEXT");
      expect(col!.notnull).toBe(1);
    });

    it("event_hash is TEXT NOT NULL UNIQUE", () => {
      const cols = tableInfo(testDb.sqliteDb, "ledger_events");
      const col = cols.find((c) => c.name === "event_hash");
      expect(col).toBeDefined();
      expect(col!.type).toBe("TEXT");
      expect(col!.notnull).toBe(1);
    });

    it("created_at_utc is TEXT NOT NULL", () => {
      const cols = tableInfo(testDb.sqliteDb, "ledger_events");
      const col = cols.find((c) => c.name === "created_at_utc");
      expect(col).toBeDefined();
      expect(col!.type).toBe("TEXT");
      expect(col!.notnull).toBe(1);
    });

    it("CHECK constraint rejects invalid event_type", () => {
      const db = freshDb();
      expect(() => {
        db.sqliteDb.exec(`
          INSERT INTO ledger_events (event_type, payload_json, prev_hash, event_hash, created_at_utc)
          VALUES ('invalid_type', '{}', '${ZERO_HASH}', '${HASH_A}', '${VALID_TS}')
        `);
      }).toThrow();
    });

    it("CHECK constraint rejects empty payload_json", () => {
      const db = freshDb();
      expect(() => {
        db.sqliteDb.exec(`
          INSERT INTO ledger_events (event_type, payload_json, prev_hash, event_hash, created_at_utc)
          VALUES ('donation_confirmed', '', '${ZERO_HASH}', '${HASH_A}', '${VALID_TS}')
        `);
      }).toThrow();
    });

    it("CHECK constraint rejects payload_json > 16384 bytes", () => {
      const db = freshDb();
      const tooLarge = "x".repeat(16385);
      expect(() => {
        db.sqliteDb.exec(`
          INSERT INTO ledger_events (event_type, payload_json, prev_hash, event_hash, created_at_utc)
          VALUES ('donation_confirmed', '${tooLarge}', '${ZERO_HASH}', '${HASH_A}', '${VALID_TS}')
        `);
      }).toThrow();
    });

    it("CHECK constraint accepts payload_json exactly 16384 bytes", () => {
      const db = freshDb();
      const exactMax = "x".repeat(16384);
      expect(() => {
        db.sqliteDb.exec(`
          INSERT INTO ledger_events (event_type, payload_json, prev_hash, event_hash, created_at_utc)
          VALUES ('donation_confirmed', '${exactMax}', '${ZERO_HASH}', '${HASH_A}', '${VALID_TS}')
        `);
      }).not.toThrow();
    });

    it("CHECK constraint rejects invalid timestamp format", () => {
      const db = freshDb();
      // Missing 'Z' suffix
      expect(() => {
        db.sqliteDb.exec(`
          INSERT INTO ledger_events (event_type, payload_json, prev_hash, event_hash, created_at_utc)
          VALUES ('donation_confirmed', '{}', '${ZERO_HASH}', '${HASH_A}', '2025-01-01T00:00:00')
        `);
      }).toThrow();

      // Wrong format entirely
      expect(() => {
        db.sqliteDb.exec(`
          INSERT INTO ledger_events (event_type, payload_json, prev_hash, event_hash, created_at_utc)
          VALUES ('donation_confirmed', '{}', '${ZERO_HASH}', '${HASH_B}', 'not-a-date')
        `);
      }).toThrow();
    });

    it("UNIQUE constraint on event_hash rejects duplicates", () => {
      const db = freshDb();
      // Insert first row
      db.sqliteDb.exec(`
        INSERT INTO ledger_events (event_type, payload_json, prev_hash, event_hash, created_at_utc)
        VALUES ('donation_confirmed', '{}', '${ZERO_HASH}', '${HASH_A}', '${VALID_TS}')
      `);
      // Try to insert duplicate event_hash
      expect(() => {
        db.sqliteDb.exec(`
          INSERT INTO ledger_events (event_type, payload_json, prev_hash, event_hash, created_at_utc)
          VALUES ('anchor_published', '{}', '${HASH_A}', '${HASH_A}', '${VALID_TS}')
        `);
      }).toThrow();
    });

    it("index idx_ledger_events_type_sequence exists", () => {
      const indexes = indexList(testDb.sqliteDb, "ledger_events");
      const idx = indexes.find((i) => i.name === "idx_ledger_events_type_sequence");
      expect(idx).toBeDefined();
      expect(idx!.unique).toBe(0);
      expect(idx!.origin).toBe("c");
    });
  });

  // =========================================================================
  // wallets
  // =========================================================================

  describe("wallets", () => {
    it("table exists and has correct columns", () => {
      const cols = tableInfo(testDb.sqliteDb, "wallets");
      const names = cols.map((c) => c.name);
      expect(names).toEqual([
        "id",
        "role",
        "cluster",
        "address",
        "usdc_mint",
        "usdc_ata",
        "label",
        "active",
        "created_at_utc",
      ]);

      const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
      expect(byName.id.type).toBe("INTEGER");
      expect(byName.role.type).toBe("TEXT");
      expect(byName.cluster.type).toBe("TEXT");
      expect(byName.address.type).toBe("TEXT");
      expect(byName.usdc_mint.type).toBe("TEXT");
      expect(byName.usdc_ata.type).toBe("TEXT");
      expect(byName.label.type).toBe("TEXT");
      expect(byName.active.type).toBe("INTEGER");
      expect(byName.created_at_utc.type).toBe("TEXT");
    });

    it("address is UNIQUE", () => {
      const db = freshDb();
      db.sqliteDb.exec(`
        INSERT INTO wallets (role, cluster, address, label, created_at_utc)
        VALUES ('treasury', 'mainnet-beta', 'addr1', 'Treasury', '${VALID_TS}')
      `);
      expect(() => {
        db.sqliteDb.exec(`
          INSERT INTO wallets (role, cluster, address, label, created_at_utc)
          VALUES ('anchor', 'mainnet-beta', 'addr1', 'Anchor', '${VALID_TS}')
        `);
      }).toThrow();
    });

    it("active defaults to 1", () => {
      const cols = tableInfo(testDb.sqliteDb, "wallets");
      const col = cols.find((c) => c.name === "active");
      expect(col).toBeDefined();
      expect(col!.dflt_value).toBe("1");
      expect(col!.notnull).toBe(1);

      // Verify default is applied on insert
      const db = freshDb();
      db.sqliteDb.exec(`
        INSERT INTO wallets (role, cluster, address, label, created_at_utc)
        VALUES ('treasury', 'mainnet-beta', 'addr-default-test', 'Test', '${VALID_TS}')
      `);
      const row = db.sqliteDb
        .prepare("SELECT active FROM wallets WHERE address = 'addr-default-test'")
        .get() as { active: number };
      expect(row.active).toBe(1);
    });

    it("CHECK constraint rejects invalid role", () => {
      const db = freshDb();
      expect(() => {
        db.sqliteDb.exec(`
          INSERT INTO wallets (role, cluster, address, label, created_at_utc)
          VALUES ('invalid_role', 'mainnet-beta', 'addr2', 'Bad', '${VALID_TS}')
        `);
      }).toThrow();
    });

    it("CHECK constraint rejects invalid cluster", () => {
      const db = freshDb();
      expect(() => {
        db.sqliteDb.exec(`
          INSERT INTO wallets (role, cluster, address, label, created_at_utc)
          VALUES ('treasury', 'invalid_cluster', 'addr3', 'Bad', '${VALID_TS}')
        `);
      }).toThrow();
    });
  });

  // =========================================================================
  // anchor_runs
  // =========================================================================

  describe("anchor_runs", () => {
    it("table exists and has correct columns", () => {
      const cols = tableInfo(testDb.sqliteDb, "anchor_runs");
      const names = cols.map((c) => c.name);
      expect(names).toEqual([
        "id",
        "anchor_date",
        "anchored_head_sequence_no",
        "anchored_head_hash",
        "status",
        "trigger_source",
        "tx_signature",
        "anchor_wallet_address",
        "memo_text",
        "attempt_count",
        "last_error",
        "locked_until_utc",
        "last_anchor_wallet_sol_lamports",
        "created_at_utc",
        "updated_at_utc",
      ]);

      const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
      expect(byName.id.type).toBe("INTEGER");
      expect(byName.anchor_date.type).toBe("TEXT");
      expect(byName.anchored_head_sequence_no.type).toBe("INTEGER");
      expect(byName.anchored_head_hash.type).toBe("TEXT");
      expect(byName.status.type).toBe("TEXT");
      expect(byName.trigger_source.type).toBe("TEXT");
      expect(byName.tx_signature.type).toBe("TEXT");
      expect(byName.anchor_wallet_address.type).toBe("TEXT");
      expect(byName.memo_text.type).toBe("TEXT");
      expect(byName.attempt_count.type).toBe("INTEGER");
      expect(byName.last_error.type).toBe("TEXT");
      expect(byName.locked_until_utc.type).toBe("TEXT");
      expect(byName.last_anchor_wallet_sol_lamports.type).toBe("INTEGER");
      expect(byName.created_at_utc.type).toBe("TEXT");
      expect(byName.updated_at_utc.type).toBe("TEXT");
    });

    it("attempt_count defaults to 0", () => {
      const cols = tableInfo(testDb.sqliteDb, "anchor_runs");
      const col = cols.find((c) => c.name === "attempt_count");
      expect(col).toBeDefined();
      expect(col!.dflt_value).toBe("0");
      expect(col!.notnull).toBe(1);

      // Verify default is applied on insert
      const db = freshDb();
      db.sqliteDb.exec(`
        INSERT INTO anchor_runs (anchor_date, anchored_head_sequence_no, anchored_head_hash, status, anchor_wallet_address, memo_text, created_at_utc, updated_at_utc)
        VALUES ('2025-06-17', 1, '${HASH_A}', 'pending', 'anchorAddr', 'memo', '${VALID_TS}', '${VALID_TS}')
      `);
      const row = db.sqliteDb
        .prepare("SELECT attempt_count FROM anchor_runs WHERE anchored_head_hash = ?")
        .get(HASH_A) as { attempt_count: number };
      expect(row.attempt_count).toBe(0);
    });

    it("CHECK constraint rejects invalid status", () => {
      const db = freshDb();
      expect(() => {
        db.sqliteDb.exec(`
          INSERT INTO anchor_runs (anchor_date, anchored_head_sequence_no, anchored_head_hash, status, anchor_wallet_address, memo_text, created_at_utc, updated_at_utc)
          VALUES ('2025-06-17', 1, '${HASH_A}', 'invalid_status', 'anchorAddr', 'memo', '${VALID_TS}', '${VALID_TS}')
        `);
      }).toThrow();
    });

    it("CHECK constraint allows null trigger_source", () => {
      const db = freshDb();
      expect(() => {
        db.sqliteDb.exec(`
          INSERT INTO anchor_runs (anchor_date, anchored_head_sequence_no, anchored_head_hash, status, trigger_source, anchor_wallet_address, memo_text, created_at_utc, updated_at_utc)
          VALUES ('2025-06-17', 1, '${HASH_A}', 'pending', NULL, 'anchorAddr', 'memo', '${VALID_TS}', '${VALID_TS}')
        `);
      }).not.toThrow();
    });

    it("CHECK constraint rejects invalid trigger_source", () => {
      const db = freshDb();
      expect(() => {
        db.sqliteDb.exec(`
          INSERT INTO anchor_runs (anchor_date, anchored_head_sequence_no, anchored_head_hash, status, trigger_source, anchor_wallet_address, memo_text, created_at_utc, updated_at_utc)
          VALUES ('2025-06-17', 1, '${HASH_A}', 'pending', 'invalid_source', 'anchorAddr', 'memo', '${VALID_TS}', '${VALID_TS}')
        `);
      }).toThrow();
    });

    it("UNIQUE INDEX idx_anchor_runs_date_head enforces uniqueness", () => {
      const db = freshDb();
      db.sqliteDb.exec(`
        INSERT INTO anchor_runs (anchor_date, anchored_head_sequence_no, anchored_head_hash, status, anchor_wallet_address, memo_text, created_at_utc, updated_at_utc)
        VALUES ('2025-06-17', 1, '${HASH_A}', 'pending', 'anchorAddr', 'memo', '${VALID_TS}', '${VALID_TS}')
      `);
      // Same anchor_date + anchored_head_hash should fail
      expect(() => {
        db.sqliteDb.exec(`
          INSERT INTO anchor_runs (anchor_date, anchored_head_sequence_no, anchored_head_hash, status, anchor_wallet_address, memo_text, created_at_utc, updated_at_utc)
          VALUES ('2025-06-17', 2, '${HASH_A}', 'published', 'anchorAddr2', 'memo2', '${VALID_TS}', '${VALID_TS}')
        `);
      }).toThrow();

      // Different anchor_date with same hash should succeed
      expect(() => {
        db.sqliteDb.exec(`
          INSERT INTO anchor_runs (anchor_date, anchored_head_sequence_no, anchored_head_hash, status, anchor_wallet_address, memo_text, created_at_utc, updated_at_utc)
          VALUES ('2025-06-18', 1, '${HASH_A}', 'pending', 'anchorAddr', 'memo', '${VALID_TS}', '${VALID_TS}')
        `);
      }).not.toThrow();
    });
  });

  // =========================================================================
  // helius_inbox
  // =========================================================================

  describe("helius_inbox", () => {
    it("table exists and has correct columns", () => {
      const cols = tableInfo(testDb.sqliteDb, "helius_inbox");
      const names = cols.map((c) => c.name);
      expect(names).toEqual([
        "signature",
        "source",
        "raw_payload_json",
        "status",
        "reason",
        "attempt_count",
        "last_error",
        "received_at_utc",
        "updated_at_utc",
      ]);

      const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
      expect(byName.signature.type).toBe("TEXT");
      expect(byName.source.type).toBe("TEXT");
      expect(byName.raw_payload_json.type).toBe("TEXT");
      expect(byName.status.type).toBe("TEXT");
      expect(byName.reason.type).toBe("TEXT");
      expect(byName.attempt_count.type).toBe("INTEGER");
      expect(byName.last_error.type).toBe("TEXT");
      expect(byName.received_at_utc.type).toBe("TEXT");
      expect(byName.updated_at_utc.type).toBe("TEXT");
    });

    it("composite PRIMARY KEY on (signature, source)", () => {
      const cols = tableInfo(testDb.sqliteDb, "helius_inbox");
      const sigCol = cols.find((c) => c.name === "signature");
      const srcCol = cols.find((c) => c.name === "source");
      expect(sigCol).toBeDefined();
      expect(srcCol).toBeDefined();
      // Composite PK: both columns have pk > 0
      expect(sigCol!.pk).toBeGreaterThan(0);
      expect(srcCol!.pk).toBeGreaterThan(0);

      // Verify uniqueness enforcement
      const db = freshDb();
      db.sqliteDb.exec(`
        INSERT INTO helius_inbox (signature, source, raw_payload_json, status, received_at_utc, updated_at_utc)
        VALUES ('sig1', 'webhook', '{}', 'received', '${VALID_TS}', '${VALID_TS}')
      `);
      // Same signature + source should fail
      expect(() => {
        db.sqliteDb.exec(`
          INSERT INTO helius_inbox (signature, source, raw_payload_json, status, received_at_utc, updated_at_utc)
          VALUES ('sig1', 'webhook', '{}', 'received', '${VALID_TS}', '${VALID_TS}')
        `);
      }).toThrow();

      // Same signature, different source should succeed
      expect(() => {
        db.sqliteDb.exec(`
          INSERT INTO helius_inbox (signature, source, raw_payload_json, status, received_at_utc, updated_at_utc)
          VALUES ('sig1', 'reconciliation', '{}', 'received', '${VALID_TS}', '${VALID_TS}')
        `);
      }).not.toThrow();
    });

    it("attempt_count defaults to 0", () => {
      const cols = tableInfo(testDb.sqliteDb, "helius_inbox");
      const col = cols.find((c) => c.name === "attempt_count");
      expect(col).toBeDefined();
      expect(col!.dflt_value).toBe("0");
      expect(col!.notnull).toBe(1);

      // Verify default is applied on insert
      const db = freshDb();
      db.sqliteDb.exec(`
        INSERT INTO helius_inbox (signature, source, raw_payload_json, status, received_at_utc, updated_at_utc)
        VALUES ('sig-default-test', 'webhook', '{}', 'received', '${VALID_TS}', '${VALID_TS}')
      `);
      const row = db.sqliteDb
        .prepare("SELECT attempt_count FROM helius_inbox WHERE signature = 'sig-default-test'")
        .get() as { attempt_count: number };
      expect(row.attempt_count).toBe(0);
    });

    it("CHECK constraint rejects invalid source", () => {
      const db = freshDb();
      expect(() => {
        db.sqliteDb.exec(`
          INSERT INTO helius_inbox (signature, source, raw_payload_json, status, received_at_utc, updated_at_utc)
          VALUES ('sig2', 'invalid_source', '{}', 'received', '${VALID_TS}', '${VALID_TS}')
        `);
      }).toThrow();
    });

    it("CHECK constraint rejects invalid status", () => {
      const db = freshDb();
      expect(() => {
        db.sqliteDb.exec(`
          INSERT INTO helius_inbox (signature, source, raw_payload_json, status, received_at_utc, updated_at_utc)
          VALUES ('sig3', 'webhook', '{}', 'invalid_status', '${VALID_TS}', '${VALID_TS}')
        `);
      }).toThrow();
    });

    it("CHECK constraint rejects empty raw_payload_json", () => {
      const db = freshDb();
      expect(() => {
        db.sqliteDb.exec(`
          INSERT INTO helius_inbox (signature, source, raw_payload_json, status, received_at_utc, updated_at_utc)
          VALUES ('sig4', 'webhook', '', 'received', '${VALID_TS}', '${VALID_TS}')
        `);
      }).toThrow();
    });

    it("CHECK constraint rejects raw_payload_json > 65536 bytes", () => {
      const db = freshDb();
      const tooLarge = "x".repeat(65537);
      expect(() => {
        db.sqliteDb.exec(`
          INSERT INTO helius_inbox (signature, source, raw_payload_json, status, received_at_utc, updated_at_utc)
          VALUES ('sig5', 'webhook', '${tooLarge}', 'received', '${VALID_TS}', '${VALID_TS}')
        `);
      }).toThrow();
    });

    it("CHECK constraint accepts raw_payload_json exactly 65536 bytes", () => {
      const db = freshDb();
      const exactMax = "x".repeat(65536);
      expect(() => {
        db.sqliteDb.exec(`
          INSERT INTO helius_inbox (signature, source, raw_payload_json, status, received_at_utc, updated_at_utc)
          VALUES ('sig-exact-max', 'webhook', '${exactMax}', 'received', '${VALID_TS}', '${VALID_TS}')
        `);
      }).not.toThrow();
    });

    it("index idx_helius_inbox_status_received exists", () => {
      const indexes = indexList(testDb.sqliteDb, "helius_inbox");
      const idx = indexes.find((i) => i.name === "idx_helius_inbox_status_received");
      expect(idx).toBeDefined();
      expect(idx!.unique).toBe(0);
      expect(idx!.origin).toBe("c");
    });
  });
});
