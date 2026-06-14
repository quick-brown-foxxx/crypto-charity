# 03 — Data model

**Status:** Draft v0.3.1
**Date:** 2026-06-14
**Scope:** MVP v1. The D1 schemas, the hash chain mechanics, and what is deliberately not stored.

## How to read this

This doc describes **what the bytes look like**. It does not describe
the HTTP API that reads/writes them (see [`04-api.md`](04-api.md)) or
where the databases live (see [`05-hosting-and-deploy.md`](05-hosting-and-deploy.md)).
The rules the data model must satisfy live in
[`02-invariants.md`](02-invariants.md).

## Two databases, one chain

There are two Cloudflare D1 databases:

- **`vault-db`** — donor-facing, hash-chained, append-only. Contains
  the ledger.
- **`bot-db`** — bot-only, not chained, mutable. Contains the
  beneficiary identity mapping.

The donor-facing hash chain lives entirely in `vault-db`. The bot
mapping lives entirely in `bot-db`. The two databases are
**structurally isolated**: a Worker with only the `vault-db` binding
cannot query `bot-db` and vice versa. This enforces invariant I-4
**by platform, not by code review.**

## `vault-db` schema

### `chain_sequence`

The single linear hash chain. Every donor-visible event has exactly
one row here, in monotonic `sequence_no` order. The chain head is
`MAX(sequence_no)`'s `row_hash`.

```sql
CREATE TABLE chain_sequence (
    sequence_no      INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type       TEXT NOT NULL CHECK (event_type IN (
                         'donation',
                         'disbursement',
                         'anchor_publication'
                     )),
    target_table     TEXT NOT NULL,         -- e.g. 'donations'
    target_id        INTEGER NOT NULL,      -- PK in target_table
    head_hash        TEXT NOT NULL,         -- convenience: same as row_hash
    prev_hash        TEXT NOT NULL,         -- 64 hex chars; "0"*64 for sequence_no=1
    row_hash         TEXT NOT NULL UNIQUE,  -- 64 hex chars; SHA-256 of canonical_json(this row)
    created_at_utc   TEXT NOT NULL          -- ISO-8601
);

CREATE INDEX idx_chain_event_type ON chain_sequence(event_type, sequence_no);
```

The `target_table` / `target_id` pair is denormalized for fast
verification. The chain does not need a join to validate: each
`chain_sequence` row is self-contained.

**`target_id` is set at INSERT time, not post-INSERT.** The
insert order for any new event uses a **shared-autoincrement
trick** that avoids both the chicken-and-egg and any UPDATE
statements. This is the only canonical insert path; everything
else flows from it.

The trick: **SQLite's `AUTOINCREMENT` counter is shared across
all tables in a connection.** When we INSERT into
`chain_sequence` first, the counter advances by one. The
`last_insert_rowid()` call returns that value. When we then
INSERT into `donations` with `id = last_insert_rowid()` and
`sequence_no = last_insert_rowid()`, both `donations.id` and
`chain_sequence.sequence_no` are the same value (because the
counter advanced only once between the two INSERTs). The FK
from `donations.sequence_no` to `chain_sequence(sequence_no)`
is satisfied at INSERT time because the parent row exists in
the same transaction.

The full transaction:

```sql
BEGIN;
  INSERT INTO chain_sequence
    (event_type, target_table, target_id, head_hash, prev_hash, row_hash, created_at_utc)
  VALUES
    ('donation', 'donations', :target_id, :row_hash, :prev_hash, :row_hash, :now);
  -- :target_id is the new donations.id, which is the same as
  -- the chain_sequence.sequence_no we're about to consume.
  -- We don't know it yet, so we use last_insert_rowid() below.
  -- For SQLite to allocate the rowid correctly, the INSERT
  -- above must use AUTOINCREMENT on chain_sequence.sequence_no
  -- and we capture the result via last_insert_rowid().
  INSERT INTO donations
    (id, sequence_no, wallet_id, tx_signature, amount_usdc_minor,
     slot, block_time_utc, donor_note, observed_at_utc)
  VALUES
    (last_insert_rowid(), last_insert_rowid(), :wallet_id, :tx_sig,
     :amount, :slot, :block_time, :note, :now);
  -- Both donations.id and donations.sequence_no are now
  -- equal to chain_sequence.sequence_no. The FK is satisfied.
COMMIT;
```

There is **no UPDATE** anywhere in this transaction. The
shared-autoincrement trick keeps both `target_id` (in
`chain_sequence.target_id`) and the chain row's `id` (in
`donations.id`) consistent at INSERT time. Append-only is
preserved.

**Tradeoff note:** the trick depends on SQLite's shared-
autoincrement-counter behavior, which is documented but not
universally known. The alternative — explicit transaction with
two UPDATEs to finalize `target_id` and recompute `row_hash` —
is more conventional but violates the spirit of "no UPDATE
after commit" (and requires careful in-transaction reasoning
about observer visibility). The shared-autoincrement trick is
the chosen design for v1. A unit test
(`tests/test_invariants.py::test_shared_autoincrement_trick`)
verifies the behavior on the actual D1 runtime.

**On the `prev_hash` and `row_hash` for the first event:** when
`chain_sequence` is empty, `prev_hash = "0" * 64`. `row_hash =
SHA-256(canonical_json({ sequence_no, event_type,
target_table, target_id, head_hash = same as row_hash,
prev_hash, created_at_utc }))`.

### `donations`

```sql
CREATE TABLE donations (
    id                   INTEGER PRIMARY KEY,
    sequence_no          INTEGER NOT NULL UNIQUE REFERENCES chain_sequence(sequence_no),
    wallet_id            INTEGER NOT NULL REFERENCES wallets(id),
    tx_signature         TEXT NOT NULL UNIQUE,         -- base58 Solana tx sig
    amount_usdc_minor    TEXT NOT NULL,                -- integer string, e.g. "100000000" = 100.000000 USDC
    slot                 INTEGER NOT NULL,             -- Solana slot of confirmation
    block_time_utc       TEXT NOT NULL,                -- ISO-8601
    donor_note           TEXT,                         -- optional, set by donor via SPL memo (≤ 64 bytes)
    observed_at_utc      TEXT NOT NULL                 -- when ingest Worker saw it
);
```

**Unit for `amount_usdc_minor`:** integer string of the **smallest
unit** (USDC has 6 decimals on Solana). `"100.000000"` USDC is stored
as `"100000000"`. This matches the SPL Token program layout and
avoids floating-point ambiguity. All API request/response bodies
that take an amount also use the integer minor unit string. The
public site's display layer formats it back to decimal for humans.

**Why not a `donor_wallet_address` column?** We do not store who
donated. The vault's own address is public; inflows are visible on
chain; we just record that an inflow happened. Donor deanonymization
via on-chain analytics is a known limit, documented in
[`../concepts/2026-06-14-crypto-charity-vault.md#what-this-is-not-honest-limits`](../concepts/2026-06-14-crypto-charity-vault.md#what-this-is-not-honest-limits).

### `disbursements`

```sql
CREATE TABLE disbursements (
    id                   INTEGER PRIMARY KEY,
    sequence_no          INTEGER NOT NULL UNIQUE REFERENCES chain_sequence(sequence_no),
    wallet_id            INTEGER NOT NULL REFERENCES wallets(id),
    amount_usdc_minor    TEXT NOT NULL,                -- integer string, smallest unit
    gift_card_count      INTEGER NOT NULL CHECK (gift_card_count > 0),
    service              TEXT NOT NULL CHECK (service IN ('Alter', 'Yasno', 'Zigmund', 'Other')),
    service_note         TEXT,                         -- required only if service='Other'; max 64 chars
    receipt_ref          TEXT NOT NULL,                -- human-readable ref; regex ^[A-Za-z0-9-]{4,64}$
    receipt_blob_key     TEXT,                         -- R2 key; NULL in MVP (see 09-decisions.md)
    beneficiary_handle   TEXT NOT NULL,                -- the beneficiary's self-chosen handle
    purchased_at_utc     TEXT NOT NULL,                -- when the operator bought the cards
    recorded_at_utc      TEXT NOT NULL,                -- when the operator recorded this
    recorded_by          TEXT NOT NULL                 -- operator identifier; "operator" at MVP
);
```

### `anchor_publications`

```sql
CREATE TABLE anchor_publications (
    id                   INTEGER PRIMARY KEY,
    sequence_no          INTEGER NOT NULL UNIQUE REFERENCES chain_sequence(sequence_no),
    head_hash            TEXT NOT NULL,               -- the head hash at the moment of publishing
    tx_signature         TEXT,                        -- base58 Solana tx sig; NULL if send failed
    published_at_utc     TEXT NOT NULL,               -- ISO-8601
    source               TEXT NOT NULL CHECK (source IN ('cron-trigger', 'github-actions', 'operator-manual')),
    send_status          TEXT NOT NULL CHECK (send_status IN ('pending', 'sent', 'failed')),
    send_error           TEXT                         -- error message if send_status='failed'
);

-- Atomic idempotency: at most one row per UTC day, enforced at the DB level.
-- This replaces the v1 read-then-write idempotency check, which had a race.
CREATE UNIQUE INDEX idx_anchor_unique_per_day
    ON anchor_publications (date(published_at_utc));
```

The unique index is the single point of truth for "did we already
publish today?" — both crons can race; the DB decides. The losing
INSERT fails with a constraint violation, which the anchor job
catches and treats as "already done, exiting ok."

### `shares_optional`

**Removed in v0.3.** The table was YAGNI for v1: nothing reads
it publicly, nothing in the operator workflow needs it, and
the PII-scan complexity (the `contains_pii_flag` column) is
deferred to whatever Phase 2 needs it. Re-add when Phase 2
actually wants a curated public view of beneficiary quotes.

### `wallets`

```sql
CREATE TABLE wallets (
    id                   INTEGER PRIMARY KEY,
    address              TEXT NOT NULL UNIQUE,        -- base58 Solana address
    label                TEXT NOT NULL,               -- human-readable
    created_at_utc       TEXT NOT NULL
);
```

MVP has exactly one row. The table exists to support multi-wallet
later without schema change. Wallet creation is **bootstrapping**,
not an operator API action — the row is created by a migration,
not by `POST /api/disbursements` or any write endpoint.

## What is NOT in `vault-db` schema (by design)

Verified by `tests/test_invariants.py::test_schema_introspect` —
the test introspects the schema and fails on any column matching
a deny-list pattern.

- **No `telegram_user_id`.** Ever. Not in any table, not in any
  index, not in any view.
- **No `telegram_id`, `phone`, `email`, `real_name`.** Same.
- **No `donor_wallet_address`.** We never link a donation to a
  non-vault address.
- **No `UPDATE`/`DELETE` migrations.** Verified by
  `test_no_update_or_delete_in_migrations`.

## `bot-db` schema

`bot-db` is **not** part of the donor chain. It is the bot's
working memory. It is not append-only (we do need to update
`handles.last_seen_utc`, etc.). This is fine because `bot-db` is
**never read by the donor-facing surface**.

### `handles`

The single bot-side table. Combines beneficiary identity
(opaque_id, handle, telegram_user_id) with active-state tracking.
This is the only place `telegram_user_id` lives in our
infrastructure.

```sql
CREATE TABLE handles (
    id                   INTEGER PRIMARY KEY,
    opaque_id            TEXT NOT NULL UNIQUE,         -- 128-bit hex, server-generated
    handle               TEXT NOT NULL UNIQUE COLLATE NOCASE,  -- beneficiary-chosen
    telegram_user_id     INTEGER NOT NULL UNIQUE,      -- 64-bit int from Telegram
    first_seen_utc       TEXT NOT NULL,
    last_seen_utc        TEXT NOT NULL,
    is_active            INTEGER NOT NULL DEFAULT 1
);
```

`last_seen_utc` is updated on every interaction. This is allowed
in `bot-db` because the bot database is not the donor chain. The
`is_active` flag lets an operator deactivate a handle (e.g., on
request from the beneficiary, or on abuse signal) without losing
history. The `telegram_user_id` is the **only** mapping to a
real Telegram account in our infrastructure — the
`vault-db` Workers do not have the `bot-db` binding, so the
defense is structural (by platform), not just by code review.

### `conversations`

```sql
CREATE TABLE conversations (
    id                   INTEGER PRIMARY KEY,
    opaque_id            TEXT NOT NULL REFERENCES handles(opaque_id),
    kind                 TEXT NOT NULL CHECK (kind IN ('card_request', 'operator_reply', 'system')),
    status               TEXT NOT NULL CHECK (status IN ('pending', 'in_flight', 'done', 'failed')),
    payload              TEXT,                         -- e.g. the gift card code, when delivered
    created_at_utc       TEXT NOT NULL,
    updated_at_utc       TEXT NOT NULL
);
```

In-flight gift card requests and their resolutions.

## Hash chain mechanics

### Canonical JSON

The `row_hash` is `SHA-256(canonical_json(row))`. The canonical
encoder is deterministic:

- Object keys sorted lexicographically.
- Numbers: integer minor-unit strings only. No floats.
- Strings: UTF-8, no escaping beyond JSON's requirements.
- No whitespace.
- `null` for nullable fields (never absent).
- Arrays preserve order.

A reference implementation lives in `packages/vault-core/src/canonical.ts`
(TS) and `tools/anchor-job/src/vault_core/canonical.py` (Python).
**Cross-language parity is tested in CI**: a 200-event fixture
produces the same head hash in both languages.

### `row_hash` and `prev_hash`

For `chain_sequence` row at `sequence_no = N` (where `N > 1`):

```
prev_hash = chain_sequence[N-1].row_hash
row_hash  = SHA-256(canonical_json({
    sequence_no, event_type, target_table, target_id,
    head_hash, prev_hash, created_at_utc
}))
```

For `sequence_no = 1`:

```
prev_hash = "0" * 64
```

The `head_hash` column is a convenience duplicate of `row_hash` so
the anchor worker doesn't have to choose which field to publish.
Both names exist; they hold the same value.

### `verify_chain()`

```python
def verify_chain() -> Result[str, VerifyError]:
    """Return the head hash, or an error describing the first break."""
    rows = db.query(
        "SELECT sequence_no, prev_hash, row_hash "
        "FROM chain_sequence ORDER BY sequence_no ASC"
    )
    expected_prev = "0" * 64
    for row in rows:
        if row.prev_hash != expected_prev:
            return Err(BrokenLink(row.sequence_no, expected_prev, row.prev_hash))
        if row.row_hash != sha256(canonical_json(row)):
            return Err(HashMismatch(row.sequence_no, ...))
        expected_prev = row.row_hash
    if not rows:
        return Err(EmptyChain())
    return Ok(rows[-1].row_hash)
```

This is the function that gets called by:
- The read API `/api/verify` endpoint (on demand, read-only).
- The anchor worker (to compute the head hash to publish).
- The CI invariant test (against a seeded DB).

It does not validate that `chain_sequence` rows point to real
target rows. That validation is a separate function,
`verify_chain_referential()`, which is called once at startup of
the read API and on every CI test run. A referential break is an
invariant violation and is reported loudly.

### Donation ingest transaction

The `apps/ingest` Worker performs the shared-autoincrement
trick described in
["`target_id` is set at INSERT time" above](#target_id-is-set-at-insert-time-not-post-insert).
D1 supports multi-statement transactions. The canonical
INSERT sequence is:

```sql
BEGIN;
  INSERT INTO chain_sequence
    (event_type, target_table, target_id, head_hash, prev_hash, row_hash, created_at_utc)
  VALUES
    ('donation', 'donations', :target_id, :row_hash, :prev_hash, :row_hash, :now);
  -- :target_id is bound by the application layer; it equals
  -- the next value SQLite will assign to chain_sequence.sequence_no
  -- (because target_id = donations.id = chain_sequence.sequence_no
  -- by the shared-autoincrement trick).
  INSERT INTO donations
    (id, sequence_no, wallet_id, tx_signature, amount_usdc_minor,
     slot, block_time_utc, donor_note, observed_at_utc)
  VALUES
    (last_insert_rowid(), last_insert_rowid(), :wallet_id, :tx_sig,
     :amount, :slot, :block_time, :note, :now);
COMMIT;
```

`prev_hash` and `row_hash` are computed by the application
layer (in `packages/vault-core`); they are passed as bound
parameters. The values are:

- `prev_hash = (SELECT row_hash FROM chain_sequence ORDER BY
  sequence_no DESC LIMIT 1)` — or `"0" * 64` if the chain is
  empty.
- `row_hash = SHA-256(canonical_json({ sequence_no,
  event_type, target_table, target_id, head_hash = same as
  row_hash, prev_hash, created_at_utc }))` where
  `sequence_no` is the new value allocated by SQLite
  (captured via `last_insert_rowid()`).

**In-process cache purge on commit:** after `COMMIT`, the
Worker calls `caches.default.delete(<cache_key>)` for each
public read API path affected by the new event.

Same pattern for `disbursements` and `anchor_publications`.
The anchor transaction additionally includes the partial
unique index on `date(published_at_utc)`; a second INSERT in
the same UTC day fails the constraint and the anchor job
catches `SQLITE_CONSTRAINT_UNIQUE` and exits ok (see
[`01-architecture.md`](01-architecture.md) §"Daily anchor" for
the full flow).

## Indexes (donor-facing query performance)

```sql
CREATE INDEX idx_donations_block_time      ON donations(block_time_utc DESC);
CREATE INDEX idx_disbursements_purchased_at ON disbursements(purchased_at_utc DESC);
CREATE INDEX idx_donations_sequence_no      ON donations(sequence_no DESC);
CREATE INDEX idx_disbursements_sequence_no  ON disbursements(sequence_no DESC);
```

Read paths are date-ordered. Most pages load the first 50; the
`before_id` cursor paginates. For v1 we don't expect >10k rows;
when we cross that, the indexes above keep it sub-100ms.

## Indexes (anchor)

The partial unique index on `date(published_at_utc)` already in the
`anchor_publications` table definition above is the main one. It
also serves queries like "did we publish today?" with a single
index seek.

## Migrations

D1 ships with `wrangler d1 migrations`. Migrations are plain SQL
files in `migrations/NNNN_name.sql`. v1 contains exactly one
migration: `0001_init.sql` with the schema above. **The
migration contains only `CREATE TABLE` and `CREATE INDEX`.** No
bootstrap INSERTs — the first real event (the first donation
ingest) will naturally create `chain_sequence.sequence_no = 1`
with `prev_hash = "0" * 64`.

The migration runner in CI:

1. Applies the migration to a fresh local D1.
2. Asserts `chain_sequence` is empty (`SELECT COUNT(*) = 0`) —
   this is the genesis state, with no events yet.
3. Runs all invariant tests.
4. On success, the deploy job applies the migration to the remote
   D1.

No migration in v1 contains `UPDATE` or `DELETE`. The
`test_no_update_or_delete_in_migrations` invariant test enforces
this in CI.

## What's deliberately not modeled

- **No "users" or "accounts" table.** There are no user accounts
  in the system. The operator authenticates with a bearer token;
  donors do not authenticate at all.
- **No "audit_log" table.** The chain is the audit log.
- **No "sessions" or "tokens" table.** The bot uses Telegram
  message metadata for session state; the operator token is
  validated on every request.
- **No "settings" or "config" table.** Configuration is in code
  (for the app) or in Workers Secrets (for runtime values).
- **No "soft_delete" anywhere.** Append-only means append-only.
