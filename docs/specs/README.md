# MVP v1 — Technical spec

**Status:** Draft v0.3.1 — internal review
**Date:** 2026-06-14
**Scope:** MVP (Phase 1). Phase 2 is explicitly out of scope.

This is the technical spec. It implements the concept captured in
[`../concepts/2026-06-14-crypto-charity-vault.md`](../concepts/2026-06-14-crypto-charity-vault.md).
Where this spec and the concept doc disagree, **the concept doc wins** —
flag the conflict and update both.

## How to read this

The spec is split into focused docs. Read in order the first time;
jump to a single doc when you need it.

| #   | File                              | One-line description                                                                  |
| --- | --------------------------------- | ------------------------------------------------------------------------------------- |
| 00  | [`00-overview.md`](00-overview.md)                       | What v1 delivers, who it's for, what success looks like, what is explicitly deferred. |
| 01  | [`01-architecture.md`](01-architecture.md)               | Components, data flow, who-talks-to-whom, trust boundaries.                            |
| 02  | [`02-invariants.md`](02-invariants.md)                   | The nine things that MUST NOT break (the trust model). Grep-able and test-enforced.    |
| 03  | [`03-data-model.md`](03-data-model.md)                   | D1 schemas, hash chain mechanics, idempotency, what is NOT stored.                     |
| 04  | [`04-api.md`](04-api.md)                                 | All HTTP endpoints: public read, operator write, Telegram webhook.                    |
| 05  | [`05-hosting-and-deploy.md`](05-hosting-and-deploy.md)   | Cloudflare topology, secrets, CI/CD, local dev.                                       |
| 06  | [`06-security-model.md`](06-security-model.md)           | Threat model, anonymity rules, logging policy, dependency security.                   |
| 07  | [`07-observability-and-ops.md`](07-observability-and-ops.md) | What we monitor, failure modes, runbook pointers.                                |
| 08  | [`08-testing-strategy.md`](08-testing-strategy.md)       | What we test, at what level, what's the proof for each invariant.                     |
| 09  | [`09-decisions.md`](09-decisions.md)                     | What we decided, what we deferred (and why), open questions.                          |

A grep-able mirror of the invariants lives in [`INVARIANTS.md`](./INVARIANTS.md).

## What changed in v0.2 (vs. the v1 draft)

v0.2 addresses issues found in adversarial review of the v1 draft
(archived at `/tmp/opencode/mvp-v1-archive.md`):

- **Two D1 databases** instead of one. Free plan allows 10; using
  separate `vault-db` and `bot-db` is a structural enforcement of
  the anonymity boundary, not a CI grep.
- **`handles` is NOT in the donor hash chain.** It's a working table
  in `bot-db`, no chain. The donor chain covers only donor-visible
  events.
- **Global `chain_sequence` with monotonic counter** replaces the
  per-table "head hash" definition. Single linear chain, unambiguous
  `head_hash`.
- **Atomic idempotency** on the anchor via a unique index on
  `date(published_at_utc)`. Two crons can no longer race.
- **Donation watchtower** (Helius webhook + ingestion Worker) is now
  a first-class subsystem, not a missing piece.
- **Public `/about` and `/faq` pages** added (donor-facing
  content). `/contact` and `/report` are `mailto:` links in
  the operator's email client (no form backend at v1).
- **Phase 0 gate** added: the manual conversion loop must be
  validated end-to-end *before* non-trivial code is written.
- **Open questions resolved** where possible: handle regex, frontend
  framework (React), receipt storage (`receipt_ref` string only),
  donation page (QR + ff.io link, no exchange widget), bot-disburse
  flow (operator uses POST directly).

## What changed in v0.3 (vs. v0.2)

v0.3 addresses issues found in adversarial review of v0.2:

- **Critical fixes:** `docs/INVARIANTS.md` mirror file created;
  `verify_chain()` vs `verify_chain_referential()` scope
  contradiction resolved; the anchor job's catch-and-exit-ok
  path is specified end-to-end; Cloudflare Cron Triggers now
  use 5-field standard cron (`17 2 * * *`) instead of the
  invalid 6-field form.
- **YAGNI removals:** `vault-purge` Worker (Cloudflare Workers
  have an in-process Cache API); `vault-contact` Worker and
  the `/contact` form (`mailto:` is enough at MVP); `POST
  /api/contact` and `POST /api/report` (operator triages in
  email); `shares_optional` table (no public reader); the
  separate `telegram_user_map` table (folded into `handles`,
  with `bot-db` separation still doing the heavy lifting).
- **Architecture simplification:** Worker count went from 7 → 5
  (4 functional + 1 bot). The remaining workers are:
  `vault-api-read`, `vault-api-write`, `vault-ingest`,
  `vault-anchor-cron`, `tg-bot`.
- **Honesty fixes:** the bot-compromise blast radius text is
  now consistent (a bot compromise IS a beneficiary
  deanonymization event, with explicit recovery); two-secret
  rotation (`WALLET_SECRET`, `OPERATOR_TOKEN` living in two
  Workers Secrets each) is now explicit; `POST
  /api/anchor/manual` now uses the unique index like the cron
  does, instead of an app-level 409 pre-check.

## Cross-reference summary (spec ↔ concept)

| Concept doc section                          | Spec doc / section                              |
| -------------------------------------------- | ----------------------------------------------- |
| Wallet integration                           | `01-architecture.md`, `03-data-model.md`, `04-api.md` |
| Tamper-evident ledger + daily anchor         | `02-invariants.md` (I-1..I-3, I-7), `03-data-model.md`, `04-api.md`, `05-hosting-and-deploy.md` |
| Public donor-facing site                     | `04-api.md`, `00-overview.md`                   |
| Manual operator workflow                     | `04-api.md` (operator endpoints)                |
| Telegram bot (beneficiary channel)           | `04-api.md`, `01-architecture.md`, `06-security-model.md` |
| Pseudonymous handle pattern                  | `03-data-model.md`, `04-api.md`, `06-security-model.md` |
| Single-wallet MVP is acceptable              | `09-decisions.md` (deferred)                    |
| Daily anchor job (CI-driven)                 | `05-hosting-and-deploy.md`                      |
| Out of scope items                           | `00-overview.md`                                |
| Key assumptions to validate                  | `00-overview.md` (success criteria)             |
| Architecture sketch                          | `01-architecture.md`                            |
| Trust layering                               | `01-architecture.md` (trust boundaries table), `02-invariants.md` |
| What this is not                             | `00-overview.md`, mirrored at `04-api.md` (`/faq` content) |
