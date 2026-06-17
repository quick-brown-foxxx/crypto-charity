import { sqliteTable, text, integer, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Telegram user handles registered with the bot.
 *
 * COLLATE NOCASE on `handle` is enforced by the migration DDL;
 * Drizzle does not have a direct collation API for SQLite columns.
 */
const handlesColumns = {
  opaque_id: text("opaque_id").primaryKey(),
  handle: text("handle").notNull().unique(),
  telegram_user_ref: text("telegram_user_ref").notNull().unique(),
  telegram_chat_id_enc: text("telegram_chat_id_enc").notNull(),
  telegram_chat_key_version: integer("telegram_chat_key_version").notNull(),
  first_seen_utc: text("first_seen_utc").notNull(),
  last_seen_utc: text("last_seen_utc").notNull(),
  is_active: integer("is_active").notNull().default(1),
};

export const handles = sqliteTable("handles", handlesColumns, (table) => [
  check("handle_length", sql`length(${table.handle}) BETWEEN 3 AND 32`),
  check("handle_glob", sql`${table.handle} GLOB '[A-Za-z0-9_][A-Za-z0-9_][A-Za-z0-9_]*'`),
  check("handle_no_benpub", sql`lower(substr(${table.handle}, 1, 7)) <> 'benpub_'`),
  check("chat_key_version_min", sql`${table.telegram_chat_key_version} >= 1`),
  check("is_active_bool", sql`${table.is_active} IN (0, 1)`),
]);

/**
 * Conversations between a user and the operator, tracking gift-card
 * delivery code requests and their lifecycle.
 */
const conversationsColumns = {
  id: integer("id").primaryKey(),
  opaque_id: text("opaque_id")
    .notNull()
    .references(() => handles.opaque_id),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  public_beneficiary_ref: text("public_beneficiary_ref"),
  delivery_code_hash: text("delivery_code_hash"),
  delivery_code_last4: text("delivery_code_last4"),
  encrypted_code_ttl_blob: text("encrypted_code_ttl_blob"),
  encrypted_code_expires_at_utc: text("encrypted_code_expires_at_utc"),
  created_at_utc: text("created_at_utc").notNull(),
  updated_at_utc: text("updated_at_utc").notNull(),
};

export const conversations = sqliteTable(
  "conversations",
  conversationsColumns,
  (table) => [
    check(
      "kind_values",
      sql`${table.kind} IN ('card_request', 'operator_reply', 'system')`,
    ),
    check(
      "status_values",
      sql`${table.status} IN ('pending', 'in_flight', 'delivered', 'failed')`,
    ),
    check(
      "beneficiary_ref_format",
      sql`${table.public_beneficiary_ref} IS NULL OR ${table.public_beneficiary_ref} GLOB 'benpub_[A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9]'`,
    ),
    check(
      "expires_at_format",
      sql`${table.encrypted_code_expires_at_utc} IS NULL OR ${table.encrypted_code_expires_at_utc} GLOB '????-??-??T??:??:??Z'`,
    ),
  ],
);
