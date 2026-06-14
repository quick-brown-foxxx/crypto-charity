# INVARIANTS — Grep-able mirror

This file is the canonical, grep-able source of the project's
invariants. The detailed invariant definitions, enforcement
mechanisms, and test mappings live in
[`docs/specs/02-invariants.md`](02-invariants.md). If the two
disagree, **this file is authoritative for the canonical text** and
the spec doc should be updated to match.

Each invariant is one short line. If you need the full
explanation, follow the link.

## I-1: Append-only ledger

`vault-db` donor-facing tables (`donations`, `disbursements`,
`anchor_publications`, `chain_sequence`) are append-only. No
UPDATE or DELETE on them, in any code path, in any environment,
in any test, once the row has been committed. The canonical
insert path uses a shared-autoincrement trick with INSERTs only
— no UPDATE. `bot-db` is separate and not subject to this rule.

## I-2: Linear hash chain with a single global head

Every donor-visible event is a row in the single
`chain_sequence` table. The chain has exactly one head
(MAX(sequence_no).row_hash). `head_hash` is unambiguous and
re-derivable from the public DB.

## I-3: At most one anchor transaction per UTC day

A second anchor attempt for the same UTC day is a no-op at the DB
level. Enforced by a partial unique index on
`anchor_publications(date(published_at_utc))`.

## I-4: No real beneficiary identity in the main vault

`vault-db` schema contains no column for a Telegram user id, real
name, phone, or email. The mapping `telegram_user_id ↔ handle ↔
opaque_id` lives only in `bot-db`, which is a separate D1 database
in a separate Cloudflare account. The `vault-db` Workers do not
have the `bot-db` binding.

## I-5: Operator-only writes to the donor ledger

Public read endpoints are open. The only write endpoints are
operator-authenticated. The anchor job and the ingest Worker are
the only other writers (each scoped to its own auth).

## I-6: The wallet private key is never in code, repo, logs, or build artifacts

The Solana keypair is held only in a GitHub Actions encrypted
secret and a Workers Secret bound to the `vault-anchor-cron`
Worker.

## I-7: The on-chain anchor contains only the ledger hash digest

The Solana memo field contains exactly `bytes.fromhex(head_hash)` —
32 bytes, the SHA-256 of the head. No amounts, no timestamps, no
PII, no metadata.

## I-8: Public read endpoints are cache-friendly with bounded staleness

Donor-facing JSON is served from Cloudflare's edge cache with TTL
60s. Writes purge the cache in-process. Staleness is bounded by
write_time → purge_propagation + 60s TTL.

## I-9: Operator is structurally blind to beneficiary real identity

The operator (a) cannot read the bot's D1 binding and (b) does
not have admin access to the Telegram account the bot operates on.
Structural, not code-level.
