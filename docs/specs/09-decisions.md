# 09 — Decisions

**Status:** Draft v0.3.1
**Date:** 2026-06-14
**Scope:** MVP v1. What we decided, what we deferred, and what's still open.

## How to read this

This doc is the **decision log** for the spec. It records the
choices we made in the other docs, the choices we explicitly
deferred, and the questions still open. When you read the other
docs and want to know "why this and not that?", this is the index.

For each decision: a one-line summary, a link to where it's
specified, and a brief reasoning. For each deferral: a one-line
summary, why we deferred, and what would trigger us to revisit.

## Resolved decisions

### Frontend framework: React + Vite + TypeScript

- **Where:** `05-hosting-and-deploy.md` (Decisions table)
- **Reasoning:** mature Cloudflare Pages + Vite ecosystem;
  TanStack Query, react-i18next, react-hook-form, and zod are
  all standard. Vue would also work; the spec is framework-
  agnostic and the swap is one-app-local. (Resolved from Q-4.)

### Handle validation regex: `^[A-Za-zА-Яа-яёЁ0-9_-]{3,32}$u`, case-folded to lowercase for storage

- **Where:** `04-api.md` (POST /api/disbursements validation)
- **Reasoning:** Cyrillic + Latin + digits + `-_`, 3-32 chars.
  Case-folded for storage so "Песик-3" and "песик-3" are the
  same handle. No reserved words at v1 (the operator can
  deactivate a handle manually if needed). No Turkish-i-style
  folding — we don't expect Turkish beneficiaries. (Resolved
  from Q-1.)

### Bot-disburse flow: operator uses POST /api/disbursements directly

- **Where:** `04-api.md` ("Bot-mediated disbursement flow")
- **Reasoning:** the operator's `/admin` UI pre-fills the
  beneficiary handle from the conversation. The operator does
  not type the handle. This:
  - Prevents operator typos (the handle is a unique key into
    `bot-db.handles`; a typo would disburse to a non-existent
    beneficiary).
  - Avoids coupling the operator's UI to the bot's chat
    history (which lives at Telegram, not in our DB).
  - Keeps the disbursement record as the operator's official
    statement of what happened, separate from the bot's
    private delivery step.
- **What was rejected:** the operator replying to the
  beneficiary's chat in the bot directly. This couples the
  operator to the bot's chat history and creates an audit
  trail that's split across two surfaces. (Resolved from
  Q-3.)

### Receipt storage at v1: `receipt_ref` string only

- **Where:** `03-data-model.md` (`disbursements` schema)
- **Reasoning:** the receipt reference (gift card order number
  from Alter, etc.) is a human-readable string the operator
  types. It's enough for a donor to ask "show me receipt
  ALTER-2026-06-14-A1B2C3" and the operator to produce the
  Alter order confirmation. Storing an actual image in R2
  is Phase 2 because:
  - The image is the Alter platform's property; we don't
    want to host a screenshot of a third-party UI.
  - PII redaction (cropping the operator's account email
    in the corner of the screenshot) is non-trivial and we
    don't have a workflow for it.
  - The MVP donor story is "you can re-verify the chain";
    receipt authenticity is operational, not cryptographic.
- **What was rejected:** R2 bucket for screenshot uploads
  from the operator. (Resolved from Q-6.)

### Donation page at v1: QR code + address + ff.io link, no exchange widget

- **Where:** `01-architecture.md` (Public donor surface)
- **Reasoning:** the operator chose to either integrate an
  exchange widget or recommend ff.io. ff.io is a simple link,
  a static page is enough, and we avoid integrating with a
  third-party exchange (KYC, sanctions, fees, integration
  maintenance). Real exchange widget is Phase 2.
- **What was rejected:** Onramper, MoonPay, or similar widget.
  (Resolved from Q-7.)

### Anchor worker: TypeScript in Cloudflare, Python in CI

- **Where:** `01-architecture.md` (architecture diagram),
  `05-hosting-and-deploy.md` (anchor.yml)
- **Reasoning:** the Cloudflare Cron Worker is TS and reuses
  `vault-core`. The CI backup is Python. They share the
  algorithm but are independent code paths. This gives
  redundancy in code as well as in cron source — if the TS
  builder has a bug that produces a wrong memo, the Python
  builder will compute a different one and the
  cross-language parity test will catch it.
- **What was rejected:** rewriting the Cron Worker in Python
  via Pyodide. Cloudflare Python Workers are still beta
  and don't reliably support native-extension packages like
  `solders`. (Resolved from Q-5.)

### Stablecoin: USDC-SPL only

- **Where:** `03-data-model.md` (`donations.amount_usdc_minor`
  comments)
- **Reasoning:** USDC is the cleaner technical choice (native
  SPL token, well-supported, regulated) and is sufficient for
  the MVP donor pool. Adding USDT is a one-time integration
  per chain and a Phase 2 task. Multi-currency is Phase 2.
- **What was rejected:** USDT-only, or USDC+USDT at v1.
  (Resolved from Q-8 of the original ideation; the operator
  decided USDC by default.)

### Cron schedule: 02:17 UTC, not 02:00 UTC

- **Where:** `05-hosting-and-deploy.md` (anchor.yml), Account A
  cron trigger config
- **Reasoning:** GitHub Actions explicitly notes that
  schedules at the top of the hour are most likely to be
  delayed or dropped. 02:17 UTC is off the worst-case slot
  and matches the Cron Trigger's local-time semantics.

### Donation unit: integer minor units as a string

- **Where:** `03-data-model.md` (`donations.amount_usdc_minor`,
  `disbursements.amount_usdc_minor`)
- **Reasoning:** USDC has 6 decimals on Solana. Storing the
  integer count of the smallest unit ("100000000" = 100
  USDC) matches the SPL Token program layout, avoids
  floating-point ambiguity, and is what the on-chain world
  uses. The public site formats for human display.

### Two D1 databases, not one

- **Where:** `01-architecture.md` (architecture diagram),
  `03-data-model.md` (opening section)
- **Reasoning:** Cloudflare D1 free plan allows 10 databases
  per account. Using `vault-db` and `bot-db` as separate
  databases is **structural** enforcement of the anonymity
  boundary: a Worker with only the `vault-db` binding
  literally cannot query `bot-db` and vice versa. This is
  enforcement by platform, not by code review.

### Single linear chain via `chain_sequence`

- **Where:** `03-data-model.md` (`chain_sequence` schema)
- **Reasoning:** every donor-visible event is a row in a
  single monotonic `chain_sequence` table. The head is
  `MAX(sequence_no).row_hash`. This is unambiguous; the
  v1 design (per-table chains with a "DB-wide head") was
  not.

### Atomic idempotency on the anchor

- **Where:** `03-data-model.md` (`anchor_publications` schema)
- **Reasoning:** a partial unique index on
  `date(published_at_utc)` is the single point of truth for
  "did we already publish today?" Both crons can race; the
  DB decides. The losing INSERT fails with a constraint
  violation, which the anchor job catches and treats as
  "already done, exiting ok."

## Explicit deferrals (out of scope for v1)

These are deferred items where the spec says "we are not
building this" and the rationale.

| Item                                            | Why deferred                                                                  | Trigger to revisit                                            |
| ----------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Multi-sig wallet (Squads, etc.)                 | Single-wallet is acceptable at MVP scale. Adds key-management complexity.       | Treasury balance > 6 months of operating budget, or 2+ operators. |
| Cold storage                                    | Single-wallet is acceptable at MVP scale.                                      | Same as multi-sig.                                            |
| Wallet recovery procedure as a runbook          | MVP is single-operator, single-key.                                            | When we add a second operator.                                |
| Multi-currency / cross-chain                    | USDC-SPL is sufficient for MVP.                                                | Donor asks for a different chain twice.                       |
| Donor accounts, recurring donations             | Donor story is "send to a wallet address." Adds auth complexity.               | Donor asks for it.                                            |
| Public signup for beneficiaries                 | MVP beneficiaries are invited personally.                                      | Beneficiary count > 20.                                       |
| Exchange widget on `/donate`                    | ff.io is sufficient. Avoids third-party KYC/sanctions integration.            | First-time donor conversion rate is poor.                     |
| Receipt image storage (R2)                      | `receipt_ref` string is enough. PII redaction is non-trivial.                 | Donor asks for visual proof, or receipt verification becomes a thing. |
| Narrative / marketing / stories layer           | MVP donor is the operator.                                                     | External donors arrive.                                       |
| Receipt verification (Alter API integration)    | Alter is the receipt authority; we don't re-verify.                            | Donor asks for it.                                            |
| Referral / anti-abuse beyond minimum            | MVP is small.                                                                 | Beneficiary count > 10.                                       |
| Hardened opsec / state-adversary protection     | Out of scope per the concept doc.                                              | Russia-context legal review changes the threat model.         |
| Matrix / alternative messengers                 | Telegram bot is the realistic MVP.                                              | Telegram is blocked in a region we serve.                     |
| Psychiatry (vs. psychology)                     | Explicitly Phase 2 from the original note.                                     | Phase 2 begins.                                               |
| Automation of the conversion loop               | The "gift card factory" Phase 2 path. MVP is manual by design.                | Operator time per beneficiary > 30 min/month.                  |
| Multi-wallet support                            | Single-wallet is sufficient. Architecture supports adding later.              | When we add cold storage.                                     |
| R2 bucket                                       | Not needed at v1.                                                              | When we store receipt images.                                 |
| Workers KV (rate limiter for manual anchor)     | Nice-to-have, not essential. v1 uses the unique-per-day index instead.         | When we want to rate-limit other things.                      |
| Cloudflare Analytics dashboard for ops          | We have Workers Tail; Analytics is for product, not ops.                       | When we need historical request analytics.                    |
| Workers Logs (paid) with queryable history      | We have Workers Tail (free) and email alerts.                                  | When we need to investigate something older than 3 days.      |

## Open questions

Questions that remain open at v0.3 of the spec, with proposed
defaults.

### Q-A: How big does the FAQ need to be?

- **Where it matters:** `04-api.md` (`/api/faq`).
- **Proposed default:** 10 entries. The "what this is not"
  content from the concept doc is the source of truth. Add
  entries as donors ask.
- **Status:** no decision needed at spec level; this is
  content work, not architecture.

### Q-B: What happens to the chain if the operator needs to
issue a "correction"?

- **Where it matters:** every doc that talks about append-only.
- **Proposed default:** corrections are a new row in
  `disbursements` with `service='Correction'` and a
  `service_note` explaining the correction. The chain grows;
  history is preserved. No row is ever UPDATEd or DELETEd.
- **Status:** documented in
  `09-decisions.md` (this section), not elsewhere yet.
  Will be added to the FAQ content.

### Q-C: What is the SLA for donor reports?

- **Where it matters:** `04-api.md` (`/api/report`),
  `07-observability-and-ops.md` (F-12).
- **Proposed default:** weekly triage. A donor who reports
  a real hash mismatch gets a reply within 7 days. A
  report that turns out to be a tool error gets a polite
  reply with the correct instructions.
- **Status:** documented in the runbook pointer in
  `07-observability-and-ops.md`.

### Q-D: Should the public site link to a status page?

- **Where it matters:** `04-api.md` (public pages list).
- **Proposed default:** the `/verify` page already shows
  `anchor_stale`. A dedicated status page is Phase 2. For
  v1, UptimeRobot's public status page (free) can be linked
  from `/about`.
- **Status:** to be added to the `/about` content.

## Change log

- 2026-06-14: v0.1. Initial spec (single document, 845 lines,
  archived at `/tmp/opencode/mvp-v1-archive.md`).
- 2026-06-14: v0.2. Split into 10 focused docs. Resolved all
  critical issues from v0.1 adversarial review: two D1
  databases, `handles` out of the chain, atomic idempotency,
  single linear chain, donation watchtower, public
  contact/report pages, Phase 0 gate, bot-disburse flow.
- 2026-06-14: v0.3. Addressed v0.2 adversarial review. Critical:
  created `docs/INVARIANTS.md` mirror; fixed
  `verify_chain()` vs `verify_chain_referential()` scope
  contradiction; specified the anchor job's catch-and-exit-ok
  path; created the spec. YAGNI removals: `vault-purge`
  Worker (cache API is in-process), `vault-contact` Worker
  (mailto:), `POST /api/contact`, `POST /api/report`,
  `shares_optional` table, `telegram_user_map` (folded into
  `handles`). Bug fixes: 6-field cron → 5-field
  (`17 2 * * *`); `target_id` insert order to avoid
  chicken-and-egg with `row_hash`; `POST /api/anchor/manual`
  now uses the unique index instead of an app-level 409;
  added `INVARIANTS.md`; standardized the parity fixture
  size at 200;   listed the verify script as a real
  deliverable. Honesty fixes: bot-compromise blast radius
  is now consistent (real Telegram user IDs are exposed);
  `WALLET_SECRET` / `OPERATOR_TOKEN` rotation in two
  locations is explicit. Worker count went from 7 → 5.
- 2026-06-14: v0.3.1. Internal-consistency fixes from the
  v0.3 re-review. Picked one design for the `target_id`
  insert path: **shared-autoincrement trick** (no UPDATE,
  no exception to I-1 needed). Deleted the conflicting
  two-UPDATE design. Updated the I-1 invariant text and
  the `INVARIANTS.md` mirror to match. Stale text fixes:
  I-8 enforcement (in-process cache API, not
  Cloudflare-API-token-based purge); ingest Worker secret
  count (now consistently 2); parity-test fixture count
  (now consistently 200); `verify_chain_referential` call
  site (now consistently startup + CI); test name (now
  consistently `test_no_runtime_update_in_donor_tables`).
  Added the `/admin` UI to the components list. Removed
  the `Cloudflare Email Routing` row from the observability
  table. Documented the `source` field for
  `POST /api/anchor/manual` and its three callers.
