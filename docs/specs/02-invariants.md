# 02 — Invariants

**Status:** Draft v0.3.1
**Date:** 2026-06-14
**Scope:** MVP v1. The trust model of the project is encoded here.

## Why this doc exists

The product's value is **trust**. Donors trust a transparent ledger;
beneficiaries trust that the operator cannot deanonymize them. Both
trust stories collapse if a small set of rules is violated.

This doc enumerates the **invariants** — the rules that MUST NOT break,
under any circumstance, in v1. Each invariant is:

- Stated in one sentence
- Enforced by something testable (code, schema, CI check, ops
  discipline)
- Verified by something testable (a test in
  [`08-testing-strategy.md`](08-testing-strategy.md))
- Cross-referenced from any code, schema, or doc that depends on it

These are the constraints a future engineer (or agent) can grep for.
If a change would violate an invariant, **the change is wrong**, not
the invariant. Invariants can only be amended by changing *this* doc
with explicit justification, never silently.

A grep-able mirror of these invariants lives in
[`../INVARIANTS.md`](../INVARIANTS.md). Anything that belongs here but
is not in the mirror is a doc bug.

## The invariants

### I-1: Append-only ledger

The donor-facing ledger tables (`donations`, `disbursements`,
`anchor_publications`, `chain_sequence`) are **append-only.**
Once a row has been INSERTed and committed, no `UPDATE` or
`DELETE` is ever issued against it, in any code path, in any
environment, in any test.

**No exception for the chain sequence either.** The shared-
autoincrement trick used to keep `donations.id`,
`donations.sequence_no`, and `chain_sequence.sequence_no`
consistent uses INSERTs only (see
[`03-data-model.md`](03-data-model.md) §"`target_id` is set at
INSERT time"). There is no UPDATE anywhere in the canonical
insert path.

- **Enforced by:**
  - Migrations contain only `CREATE TABLE`, `CREATE INDEX`, and
    DDL. No `INSERT`s in migrations (no bootstrap row; the
    first real event creates `chain_sequence.sequence_no = 1`).
  - A Python invariant test (`tests/test_invariants.py::test_no_update_or_delete_in_migrations`)
    fails CI if any migration contains `UPDATE`/`DELETE` outside
    an explicit allowlist (empty at v1).
  - A Python invariant test (`tests/test_invariants.py::test_no_runtime_update_in_donor_tables`)
    uses static analysis to assert that no `db.prepare("UPDATE …")`
    call is reachable against `donations`, `disbursements`,
    `anchor_publications`, or `chain_sequence`. (The `UPDATE
    anchor_publications SET send_status` flow for the anchor
    is on columns that are NOT in the chain and is covered by
    a separate allowlist — see `01-architecture.md` §"Daily
    anchor" for the rationale.)
  - The handle management table lives in a *separate* D1 database
    (`bot-db`), so updates to `handles.last_seen_utc` don't
    affect the donor chain.
- **Test:** `tests/test_invariants.py::test_no_update_or_delete_in_migrations`,
  `test_no_runtime_update_in_donor_tables`, and an integration test
  that inserts N events and asserts the chain head is what
  `verify_chain()` returns.

### I-2: Linear hash chain with a single global head

Every donor-visible event is a row in a single monotonic
`chain_sequence` table. The chain has exactly one head (the most
recent row's `row_hash`). The `head_hash` is unambiguous and is
re-derivable from the public DB by any third party.

- **Enforced by:**
  - Schema: `chain_sequence` has a `sequence_no INTEGER PRIMARY KEY
    AUTOINCREMENT` and a `UNIQUE` constraint. Every other donor-table
    row references a `sequence_no`.
  - `row_hash = SHA-256(canonical_json(row))` (deterministic encoder,
    sorted keys, fixed number representation).
  - `prev_hash` for sequence_no 1 is `"0" * 64`; thereafter, the
    previous row's `row_hash`.
  - `verify_chain()` walks `chain_sequence` in `sequence_no` order and
    returns the head's `row_hash`. (Referential integrity — that
    every `chain_sequence.target_id` actually points to an existing
    row in `chain_sequence.target_table` — is checked by a
    separate function `verify_chain_referential()`, called at
    API-read startup and on every CI test run, not by `verify_chain()`
    itself. See
    [`03-data-model.md`](03-data-model.md).)
- **Test:** `tests/test_chain.py::test_chain_round_trip` (200 events
  of mixed types) and `test_modify_breaks_chain`.

### I-3: At most one anchor transaction per UTC day

A second anchor attempt for the same UTC day MUST be a no-op at the
DB level, not at the application level. This is the property that
protects the "we anchor daily" trust story even under cron races.

- **Enforced by:**
  - A partial unique index on
    `anchor_publications(date(published_at_utc))` — second INSERT in
    the same UTC day fails with a constraint violation, which the
    anchor job treats as "already done, exiting ok."
- **Test:** `tests/test_anchor.py::test_unique_per_day` (two parallel
  inserts, one fails).

### I-4: No real beneficiary identity in the main vault

The `vault-db` schema contains no column for a Telegram user id,
real name, phone, email, or any other personally identifying
information. The mapping `telegram_user_id ↔ handle ↔ opaque_id` lives
only in `bot-db`, which is bound to the bot Worker only.

- **Enforced by:**
  - Schema: no such columns exist (verified by introspection test).
  - `bot-db` is a separate Cloudflare D1 database. The `vault-api-read`
    and `vault-api-write` Workers do not have its binding.
  - The bot Worker does not have the `vault-db` binding (it calls
    vault's HTTP API for what it needs).
  - A CI test (`tests/test_invariants.py::test_binding_allowlist`)
    asserts that `wrangler.toml` files only contain the bindings
    from an explicit allowlist.
- **Test:** `tests/test_invariants.py::test_schema_introspect` and
  `test_binding_allowlist`.

### I-5: Operator-only writes to the donor ledger

Public read endpoints are open. The only write endpoints are
operator-authenticated. The anchor job is the only other writer
(its own auth, scoped to the anchor Worker).

- **Enforced by:**
  - Workers: `vault-api-write` requires `Authorization: Bearer
    <OPERATOR_TOKEN>`; the read API has no write routes.
  - The anchor Worker's binding is write-only by convention
    (it only INSERTs into `anchor_publications` and `chain_sequence`).
  - The ingestion Worker's binding is also write-only by convention.
- **Test:** `tests/test_api_write.py::test_auth_required` (no header
  → 401, bad token → 401) and
  `test_chain_cannot_be_written_by_read_worker`.

### I-6: The wallet private key is never in code, repo, logs, or build artifacts

The Solana keypair for the treasury wallet is held only in:

- A GitHub Actions encrypted secret (`WALLET_SECRET`) used by the
  Python anchor job in CI
- A Workers Secret bound to the `vault-anchor-cron` Worker

The key MUST NOT appear in any other location. If it does, that
location is compromised and the key MUST be rotated.

- **Enforced by:**
  - Pre-commit hook greps for base58 88-char strings and 64-byte
    JSON arrays in `*.ts`, `*.js`, `*.py` files.
  - CI runs the same grep on every push.
  - Workers log scrubbing: the anchor Worker never logs the secret
    and Cloudflare Workers automatically masks `env.*` access in
    `console.log` calls.
  - The Python anchor uses `::add-mask::` in the GitHub Actions
    workflow to prevent accidental echo.
- **Test:** `tests/test_invariants.py::test_no_keypair_materials_in_code`.

### I-7: The on-chain anchor contains only the ledger hash digest

The Solana memo field in the daily anchor transaction contains
exactly `bytes.fromhex(head_hash)` — 32 bytes, the SHA-256 of the
head. No amounts, no timestamps, no PII, no metadata. This is what
keeps the on-chain footprint deanonymization-safe.

- **Enforced by:**
  - The anchor tx builder is a pure function: it takes the head
    hash string and produces a `VersionedTransaction` whose memo
    instruction's data is exactly the 32-byte digest.
  - The builder is shared between the TypeScript Cron Worker and
    the Python CI job, with a cross-language parity test.
- **Test:** `tests/test_anchor.py::test_memo_bytes_match_head_hash`
  (run in both TS and Python).

### I-8: Public read endpoints are cache-friendly with bounded staleness

The donor-facing JSON endpoints are served from Cloudflare's edge
cache with a TTL of 60 seconds. Writes purge the cache. The total
staleness a donor can ever see is bounded by (write_time →
purge_propagation_time), which is seconds, plus the 60s TTL.

- **Enforced by:**
  - Cloudflare edge cache with TTL 60s. Writes call
    `caches.default.delete(<cache_key>)` in-process in the
    `vault-api-write` and `vault-ingest` Workers (no separate
    Worker, no API token needed).
  - The `X-Cache-Status` header is set on every response for
    transparency.
- **Test:** `tests/test_api_read.py::test_cache_headers`,
  `test_purge_on_write` (manual smoke in pre-deploy).

### I-9: Operator is structurally blind to beneficiary real identity

The operator (a) cannot read the bot's D1 binding and (b) does not
have admin access to the Telegram account the bot operates on.
This is a structural property of the deployment, not a code
property.

- **Enforced by:**
  - Cloudflare account topology: the bot's Workers are deployed
    under a Cloudflare account section the operator does not have
    API access to. (For v1 single-operator, this is a separate
    Cloudflare account entirely.)
  - The Telegram bot account is on a phone/account the operator
    does not have admin access to.
  - A runbook item in
    [`07-observability-and-ops.md`](07-observability-and-ops.md)
    describes the recovery procedure if either of these is
    compromised.
- **Test:** Not testable in code. The test is "the operator
  account cannot log in to the bot's Cloudflare resources." A
  periodic manual audit (quarterly) verifies this.

## What is NOT an invariant

These are tempting to elevate to invariant status but aren't, with
reasoning:

- **"The ledger is correct (receipts are real)."** The hash chain
  proves the operator didn't tamper with what was published. The
  receipt itself is the trust anchor for the off-chain truth. This
  is operational, not cryptographic, and is documented in
  [`../concepts/2026-06-14-crypto-charity-vault.md#what-this-is-not-honest-limits`](../concepts/2026-06-14-crypto-charity-vault.md#what-this-is-not-honest-limits).
- **"Beneficiaries are protected from state adversaries."** Out of
  scope at MVP.
- **"The operator can't lose the key."** Catastrophic but *visible*
  failure (`anchor_stale` banner). Documented in
  [`07-observability-and-ops.md`](07-observability-and-ops.md).
- **"Donors are anonymous."** Out of scope; the wallet is public.

## Invariant cross-reference

| Invariant | Where enforced (code/schema)              | Where tested                                  | Doc reference                                        |
| --------- | ----------------------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| I-1       | Migrations, ORM helpers, `bot-db` separation | `test_no_update_or_delete_in_migrations`     | `03-data-model.md`, `08-testing-strategy.md`         |
| I-2       | `chain_sequence` schema, `verify_chain()`   | `test_chain_round_trip`, `test_modify_breaks_chain` | `03-data-model.md`                                   |
| I-3       | Partial unique index                       | `test_unique_per_day`                         | `03-data-model.md`, `05-hosting-and-deploy.md`       |
| I-4       | Two-DB topology, binding allowlist, schema  | `test_schema_introspect`, `test_binding_allowlist` | `01-architecture.md`, `03-data-model.md`             |
| I-5       | Worker route guards, scoped bindings        | `test_auth_required`, `test_chain_cannot_be_written_by_read_worker` | `04-api.md`                                          |
| I-6       | Pre-commit + CI grep, log scrubbing         | `test_no_keypair_materials_in_code`           | `05-hosting-and-deploy.md`, `06-security-model.md`   |
| I-7       | Pure-function anchor builder, parity test   | `test_memo_bytes_match_head_hash` (TS + Py)   | `03-data-model.md`, `08-testing-strategy.md`         |
| I-8       | Cloudflare cache + purge-on-write           | `test_cache_headers`, manual smoke            | `04-api.md`                                          |
| I-9       | Account topology, Telegram account discipline | Quarterly manual audit, runbook              | `06-security-model.md`, `07-observability-and-ops.md` |
