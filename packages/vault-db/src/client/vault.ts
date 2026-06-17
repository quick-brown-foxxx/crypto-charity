/// <reference types="@cloudflare/workers-types" />

import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { drizzle as drizzleBsql } from "drizzle-orm/better-sqlite3";
import type { Database } from "better-sqlite3";
import * as schema from "../schema/vault-db.js";

/** Drizzle instance backed by a Cloudflare D1 binding. */
export type VaultDb = ReturnType<typeof drizzleD1<typeof schema>>;

/** Drizzle instance backed by better-sqlite3 (for testing). */
export type VaultDbTest = ReturnType<typeof drizzleBsql<typeof schema>>;

/** Create a Drizzle instance from a Cloudflare D1 binding. */
export function createVaultDb(d1Binding: D1Database): VaultDb {
  return drizzleD1(d1Binding, { schema });
}

/** Create a Drizzle instance from a better-sqlite3 database (for testing). */
export function createVaultDbTest(sqliteDb: Database): VaultDbTest {
  return drizzleBsql(sqliteDb, { schema });
}
