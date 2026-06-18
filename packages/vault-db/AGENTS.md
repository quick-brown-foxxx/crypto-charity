# @open-care/vault-db — Agent Notes

## Role

**Shared database layer for the crypto-charity monorepo.** Provides Drizzle ORM
schemas, typed client factories, and query helpers for both D1 databases
(`vault-db` and `bot-db`). This is the single source of truth for database
structure and the canonical way to read/write the vault ledger and bot data.

Depends on `@open-care/vault-core` for domain types, hash computation, canonical
JSON, and validation.

## What lives here

### Schemas (`src/schema/`)

**vault-db** (4 tables):

| Table | Purpose | Key columns |
| --- | --- | --- |
| `ledger_events` | Append-only hash-chained donor ledger | `sequence_no` (PK), `event_type`, `payload_json`, `prev_hash`, `event_hash` (UNIQUE), `created_at_utc` |
| `wallets` | Wallet metadata (no secret keys) | `role` (treasury/anchor), `cluster`, `address` (UNIQUE), `usdc_mint`, `usdc_ata` |
| `anchor_runs` | Mutable runner state for anchor attempts | `anchor_date`, `anchored_head_sequence_no`, `anchored_head_hash`, `status` (pending/sending/published/failed), `locked_until_utc`, `last_anchor_wallet_sol_lamports` |
| `helius_inbox` | Durable inbox for ACK-fast webhook handling | `(signature, source)` composite PK, `status` (received/processing/processed/ignored/failed/duplicate) |

**bot-db** (2 tables):

| Table | Purpose | Key columns |
| --- | --- | --- |
| `handles` | Telegram user handles | `opaque_id` (PK), `handle` (UNIQUE), `telegram_user_ref` (UNIQUE, HMAC-SHA256), `telegram_chat_id_enc` (AES-GCM), `telegram_chat_key_version` |
| `conversations` | Gift-card delivery code request lifecycle | `opaque_id` (FK→handles), `kind` (card_request/operator_reply/system), `status` (pending/in_flight/delivered/failed), `public_beneficiary_ref`, `delivery_code_hash`, `delivery_code_last4`, `encrypted_code_ttl_blob` |

### Client factories (`src/client/`)

- `createVaultDb(d1Binding)` → typed Drizzle D1 instance with vault schema
- `createBotDb(d1Binding)` → typed Drizzle D1 instance with bot schema
- `createVaultDbTest(sqliteDb)` → better-sqlite3-backed instance for Vitest (test-only)

### Query helpers (`src/helpers/`)

| Helper | Purpose |
| --- | --- |
| `appendLedgerEvent` | Hash-chained append with Zod validation, canonical JSON, hash computation, retry on collision (3 attempts). Returns `Result<LedgerEvent, LedgerAppendError>`. |
| `getHead` | Latest ledger event (highest `sequence_no`) or null |
| `getEventsPaginated` | Cursor-based paginated ledger events (parsed, typed) |
| `getRawEventsPaginated` | Cursor-based paginated ledger events (raw `payload_json` string, byte-for-byte — used for bivalent correction API) |
| `getTotals` | Aggregate donation/disbursement sums and counts via SQLite JSON functions |
| `getDonations` | Paginated flattened donation views for public API |
| `getDisbursements` | Paginated flattened disbursement views for public API |
| `getLatestAnchor` | Latest published anchor run (by highest `anchored_head_sequence_no`) |

### Types (`src/helpers/types.ts`)

Public API types: `AppendLedgerEventInput`, `LedgerAppendError`, `PaginationOptions`,
`PaginatedResult<T>`, `Totals`, `DonationView`, `DisbursementView`, `RawLedgerEventRow`.

### Subpath exports

- `@open-care/vault-db` — full public API
- `@open-care/vault-db/schema/vault-db` — raw vault-db table definitions only
- `@open-care/vault-db/schema/bot-db` — raw bot-db table definitions only

## Connections

### Consumed by

| App | Database | How it uses vault-db |
| --- | --- | --- |
| `apps/ingest` | `vault-db` | Writes donation events to `ledger_events` and `helius_inbox` via webhook ingestion |
| `apps/api-read` | `vault-db` | Reads public API data: totals, donations, disbursements, ledger events, verify, health |
| `apps/api-write` | `vault-db` | Writes disbursement and correction events to `ledger_events` |
| `apps/anchor-cron` | `vault-db` | Writes anchor events to `ledger_events`, manages `anchor_runs` state |
| `apps/tg-bot` | `bot-db` | Reads/writes `handles` and `conversations` for Telegram user registration and gift-card delivery |

Note: `apps/operator` does **not** directly depend on `vault-db` — it has no D1
binding and reaches the database indirectly through service bindings to
`vault-api-write`, `vault-anchor-cron`, `tg-bot`, and `vault-api-read`.

### Depends on

- `@open-care/vault-core` — types, `computeEventHash`, `ZERO_HASH`, `canonicalJson`, `PayloadSchemas`, `ok`/`err`, `parseLedgerEvent`, `DonationPayloadSchema`, `DisbursementPayloadSchema`
- `drizzle-orm`, `@libsql/client` (external)

## Key invariants

- `appendLedgerEvent` is the **only** way to write to `ledger_events`. Never INSERT directly.
- Hash chain integrity is enforced at write time: `prev_hash` must match the current head's `event_hash`.
- `event_hash` has a UNIQUE constraint — retry on collision (bump `created_at_utc` by 1s).
- `helius_inbox` uses `INSERT OR IGNORE` for idempotent webhook ACK.
- `anchor_runs` uses a lock protocol (`locked_until_utc`) to prevent concurrent anchor attempts.
- All query helpers parse and validate `payload_json` against vault-core Zod schemas before returning.
- `getRawEventsPaginated` returns raw `payload_json` strings — used for bivalent correction API where original bytes must be preserved.
