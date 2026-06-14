# 01 — Architecture

**Status:** Draft v0.3.1
**Date:** 2026-06-14
**Scope:** MVP v1. The shape of the system and how trust flows through it.

## How to read this

This doc describes **how the system is put together**. It does not
describe the data model (see [`03-data-model.md`](03-data-model.md)),
the API surface (see [`04-api.md`](04-api.md)), or where the bytes
live (see [`05-hosting-and-deploy.md`](05-hosting-and-deploy.md)).
For the **rules** the architecture must satisfy, see
[`02-invariants.md`](02-invariants.md).

## The shape

```
            Public donor surface               Operator surface
            (read-only, anonymous)             (authenticated)
   ┌────────────────────────────────┐   ┌──────────────────────────┐
   │ Cloudflare Pages               │   │ Operator browser          │
   │  - /         (landing+totals)  │   │  - simple auth form       │
   │  - /ledger   (history)         │   │  - POST /api/disbursements│
   │  - /verify   (anchor+re-verify)│   │  - "anchor now" button    │
   │  - /donate   (QR+addr+ff.io)   │   └─────────┬────────────────┘
   │  - /about    (who runs this)   │             │ writes
   │  - /faq      (limits)          │             ▼
   │  - /contact  (mailto: + PGP)   │   ┌──────────────────────────────────┐
   │ Static SPA: Vite + React       │   │ vault-api-write (Cloudflare      │
   └──────────┬─────────────────────┘   │ Worker, OPERATOR_TOKEN)          │
              │ reads                   │  - POST /api/disbursements       │
              ▼                         │  - POST /api/anchor/manual       │
   ┌────────────────────────────────┐   │  binding: vault-db (INSERT only) │
   │ vault-api-read (Cloudflare     │   │  in-process cache purge on write│
   │ Worker, no auth)                │   └─────────┬────────────────────────┘
   │  - GET /api/totals              │             │
   │  - GET /api/donations           │             │
   │  - GET /api/disbursements       │             │
   │  - GET /api/verify              │             │
   │  - GET /api/health              │             │
   │  - GET /api/about               │             │
   │  - GET /api/faq                 │             │
   │  binding: vault-db (read only)  │             │
   │  no secrets                     │             │
   └──────────┬─────────────────────┘             │
              │ reads                             │
              ▼                                   ▼
   ┌────────────────────────────────────────────────────────────┐
   │                vault-db (Cloudflare D1)                    │
   │   Donor-facing, hash-chained, append-only.                 │
   │   Tables:                                                  │
   │   - chain_sequence      (single linear chain, head)        │
   │   - donations           (incoming)                         │
   │   - disbursements       (outgoing, carries HANDLE)         │
   │   - anchor_publications (daily hash on-chain)              │
   │   - wallets             (treasury addresses)               │
   │   NO beneficiary real IDs. NO Telegram user IDs.           │
   └────────────────────────────────────────────────────────────┘
              ▲                                      ▲
              │ writes                               │ writes
   ┌──────────┴─────────────────────┐   ┌──────────────┴────────────────────┐
   │ vault-ingest (Cloudflare       │   │ vault-anchor-cron (Cloudflare    │
   │ Worker)                        │   │ Cron Worker, 5-field cron)      │
   │  - receives Helius webhooks    │   │  - computes head_hash             │
   │  - verifies Solana tx on RPC   │   │  - signs and sends anchor tx     │
   │  - inserts into donations      │   │  - inserts into anchor_publications│
   │    (with sequence_no)          │   │  - uses Helius RPC                 │
   │  binding: vault-db             │   │  binding: vault-db                │
   │  secrets: HELIUS_WEBHOOK_SECRET,│   │  secrets: WALLET_SECRET, HELIUS_RPC_URL│
   │            VAULT_WALLET_ADDRESS │   │                                   │
   └──────────┬─────────────────────┘   └───────────┬───────────────────────┘
              ▲                                      │
              │ HTTPS                                │ (also daily, 02:17 UTC)
   ┌──────────┴─────────────────────┐                │
   │ Helius (free tier)             │                │
   │  - webhook for address activity│                │
   │  - RPC for tx verification     │                │
   └───────────────────────────────┘                │
                                                     │
                                          ┌──────────┴──────────────────────┐
                                          │ GitHub Actions (backup anchor)  │
                                          │  schedule: 02:17 UTC             │
                                          │  - idempotency check via vault-api-read│
                                          │  - read head_hash, sign, send    │
                                          │  - secret: WALLET_SECRET         │
                                          │  - on failure: exit 1, alert     │
                                          └──────────┬──────────────────────┘
                                                     │
                                                     ▼
                                          ┌──────────────────────┐
                                          │ Solana (mainnet)     │
                                          │  - one tx / day      │
                                          │    memo = SHA-256    │
                                          │    (head_hash)       │
                                          │  - 0-lamport         │
                                          │    self-transfer     │
                                          │  - priority fee: low │
                                          └──────────────────────┘

            Beneficiary surface (separate trust boundary)
   ┌────────────────────────────────────────────────────────────┐
   │ tg-bot (Cloudflare Worker)                                 │
   │  - separate Cloudflare account section                    │
   │  - separate Telegram account, operator has no admin        │
   │  - binding: bot-db ONLY (not vault-db)                     │
   │  - on /start <handle>: register in bot-db only            │
   │  - on /card: notify operator (via separate queue)          │
   │  - on operator reply: post code back to beneficiary        │
   │  secret: TG_BOT_TOKEN, TG_WEBHOOK_SECRET,                 │
   │          VAULT_API_URL, OPERATOR_TOKEN                     │
   └──────────┬─────────────────────────────────────────────────┘
              │ reads + writes (own scope)
              ▼
   ┌────────────────────────────────────────────────────────────┐
   │ bot-db (Cloudflare D1, SEPARATE database)                  │
   │  - handles (opaque_id, handle, first_seen_utc,             │
   │             last_seen_utc, telegram_user_id, is_active)     │
   │  - conversations (in-flight gift card requests)            │
   │  NOT hash-chained. NOT readable by vault Workers.          │
   └────────────────────────────────────────────────────────────┘
              ▲
              │ DMs (commands)
              │
   ┌──────────┴─────────────────────┐
   │ Telegram (cloud)               │
   │  - bot chat history lives here │
   │  - operator does not admin     │
   └───────────────────────────────┘
              ▲
              │ DMs
   ┌──────────┴─────────────────────┐
   │ Beneficiaries (Alter users)    │
   └───────────────────────────────┘
```

## Components, one line each

- **`apps/web`** — static SPA. Vite + React, TypeScript. Renders
  API responses. No business logic. No secrets in the bundle. Hosts
  the public pages.
- **`apps/api-read`** — read-only Cloudflare Worker. Serves public
  JSON, edge-cached. Cannot write. Has `vault-db` read binding.
  No secrets.
- **`apps/api-write`** — operator-authenticated Worker. Serves
  write endpoints. Has `vault-db` write binding. One secret
  (`OPERATOR_TOKEN`). Performs in-process cache purge on write
  via `caches.default.delete()` (no separate Worker needed).
- **`apps/ingest`** — Helius webhook receiver Worker. Verifies
  incoming USDC transfers, inserts into `donations`. Has
  `vault-db` write binding. Two secrets (`HELIUS_WEBHOOK_SECRET`,
  `VAULT_WALLET_ADDRESS`). Same in-process cache purge on
  insert.
- **`apps/anchor-cron`** — Cloudflare Cron Trigger Worker. Daily
  anchor. Has `vault-db` write binding. Two secrets
  (`WALLET_SECRET`, `HELIUS_RPC_URL`).
- **`apps/tg-bot`** — Telegram webhook Worker. Has `bot-db` binding
  only. Four secrets (`TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET`,
  `VAULT_API_URL`, `OPERATOR_TOKEN`).
- **`tools/anchor-job`** — Python 3.12+ script, run by GitHub
  Actions. Daily anchor backup. Reads `WALLET_SECRET` from env.
- **`packages/shared-schemas`** — TypeScript: zod schemas for all
  API request/response shapes. Used by web, api-read, api-write,
  tg-bot, anchor-cron.
- **`packages/vault-core`** — TypeScript: hash chain mechanics,
  `verify_chain()`, `build_anchor_tx()`. Used by api-read, api-write,
  anchor-cron. The Python anchor job has a parallel
  implementation in `tools/anchor-job/src/vault_core.py` for
  cross-language parity testing.
- **`apps/web/scripts/verify/`** — public verification script.
  Two implementations (TS + Python) that any donor can run to
  re-verify the chain end-to-end. v1 deliverable, source in
  the public GitHub repo.
- **`apps/web/admin/`** — operator UI. A single-page React app
  served from the Pages project at `/admin/*`, protected by a
  Cloudflare Access policy in front (single-email allowlist
  matching the operator's address). Provides:
  - A form to record a disbursement (calls
    `POST /api/disbursements`).
  - A "pending requests" view (the bot's pending
    `conversations` rows; the operator reads them from the bot
    account's view, not from `vault-db`).
  - A "manual anchor" button (calls `POST /api/anchor/manual`).
  - All requests carry the `OPERATOR_TOKEN` in the
    `Authorization: Bearer` header, sent from the browser.
  - The UI itself is stateless; no operator-side DB.
- **`vault-db`** — Cloudflare D1 database, donor-facing. Schema in
  [`03-data-model.md`](03-data-model.md).
- **`bot-db`** — Cloudflare D1 database, bot-only. Schema in
  [`03-data-model.md`](03-data-model.md).

## Data flow

### Donation in
1. Donor sends USDC-SPL to the treasury wallet on Solana.
2. Helius detects the transfer on its address webhook and POSTs to
   `apps/ingest` (`/webhook/helius`).
3. `ingest` verifies the webhook signature, then queries Helius RPC
   to confirm the transaction is confirmed and parses the SPL Token
   program instruction to extract amount, sender (we do **not**
   store it), optional donor memo.
4. `ingest` reserves a `sequence_no` from `chain_sequence`, computes
   `row_hash` chained from the previous head, INSERTs into
   `chain_sequence` and `donations` in a transaction.
5. Cloudflare cache for the read API endpoints is purged.
6. The next donor request sees the new donation.

### Operator disbursement out
1. Operator (in real life) buys gift cards on Alter for some
   beneficiaries.
2. Operator opens the simple web UI at `/admin` (a single-page app
   protected by the `OPERATOR_TOKEN` via Cloudflare Access or a
   simple form).
3. Operator submits: amount, gift card count, service, receipt
   reference, beneficiary handle.
4. `api-write` validates the body (zod), reserves a `sequence_no`,
   computes `row_hash`, INSERTs into `chain_sequence` and
   `disbursements`.
5. Operator separately sends the gift card code to the beneficiary
   via the bot (operator types it in `/admin`, which calls the bot's
   internal endpoint or just opens a pre-filled Telegram URL).
6. Read API cache is purged.

### Daily anchor
1. At 02:17 UTC, **both** the Cloudflare Cron Trigger and the
   GitHub Actions job fire.
2. Each computes the current `head_hash` by calling
   `verify_chain()` against `vault-db`.
3. Each attempts to atomically INSERT a new `chain_sequence` row
   + `anchor_publications` row with `date(published_at_utc) = today`
   in a single D1 transaction.
4. The D1 transaction's unique index on
   `anchor_publications(date(published_at_utc))` makes the second
   INSERT fail with a constraint violation. The anchor job's
   code catches the specific error code (D1's `SQLITE_CONSTRAINT_UNIQUE`)
   and treats it as `EXIT 0` with a `level=info` log line: "anchor
   already published today, exiting ok."
5. The winning job signs a 0-lamport self-transfer with the head
   hash as memo and sends it to Solana via Helius RPC. On success,
   UPDATE `anchor_publications.send_status='sent'` and
   `tx_signature=<sig>`. (UPDATE is on `anchor_publications` row
   fields that are not in the chain — `send_status` and
   `tx_signature` are not part of the hash chain. See
   [`03-data-model.md`](03-data-model.md) for what is and isn't
   in the chain.)
6. On send failure: `send_status='failed'`, `send_error=<msg>`.
   The 36-hour `anchor_stale` banner on the public site will
   surface this.

### Beneficiary request
1. Beneficiary DMs the bot with `/start <handle>`.
2. Bot checks `bot-db.handles` for a free `handle` slot. If
   free, INSERTs a row with `opaque_id`, `handle`,
   `telegram_user_id`, `first_seen_utc = now`, `last_seen_utc =
   now`, `is_active = 1`. Bot replies with confirmation.
3. Beneficiary DMs `/card` later. Bot INSERTs a row into
   `bot-db.conversations` with `status = 'pending'`. Bot replies
   "Got it, the operator will reply."
4. Operator sees the pending request (via the bot's `/admin`
   view; the operator sees the `handle` and the `opaque_id` but
   not the `telegram_user_id`). Operator buys the gift card,
   types the code into `/admin`, which calls `api-write` to
   record the disbursement (with the handle from the
   conversation) and then calls the bot's internal endpoint
   `POST /tg/internal/send-code` (auth: `OPERATOR_TOKEN`) with
   `{ opaque_id, code }`. The bot looks up the
   `telegram_user_id` in `bot-db.handles` and posts the code to
   the beneficiary. Conversation marked `done`.

## Trust boundaries

This is the table the donors will see (in plainer language) on
`/faq`. It is the honest limits of the trust story.

| Layer                  | Proves                                                                 | Does NOT prove                                                              |
| ---------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `vault-db` (hash chain) | Records exist, form a consistent append-only chain.                  | That the receipts are real. That the chain head matches the on-chain anchor. |
| Daily Solana anchor    | That a specific head hash was published publicly at a specific time.   | That `vault-db` is the same DB. That the receipts in `vault-db` are real.   |
| `api-read` + site      | That what donors see is exactly what's in the chain.                  | Anything. The site is a window, not an oracle.                              |
| Two-DB topology        | That the operator cannot read `telegram_user_id` from `vault-db`.    | What the bot's private channel contains. (Operational, not technical.)    |
| Bot account discipline | That the operator does not have admin on the bot's Telegram account.  | What happens to messages in transit. (Telegram's job, not ours.)            |

This layering is honest: we promise **tamper-evidence**, not
**truth**.

## Why this architecture, briefly

- **Two D1 databases, not one.** Cloudflare D1 free plan allows 10
  databases per account. Using `vault-db` and `bot-db` as separate
  databases is **structural** enforcement of the anonymity boundary:
  a Worker with only the `vault-db` binding literally cannot query
  the bot's mapping table, because the binding is database-scoped,
  not table-scoped. (See
  [`06-security-model.md`](06-security-model.md) for the threat
  model.)
- **Single linear chain via `chain_sequence`.** Avoids the "DB-wide
  head hash is undefined" bug from v1 of the spec, where 5
  interleaved tables made the head ambiguous. The chain is now
  literally one table with a monotonic counter.
- **Atomic idempotency on the anchor.** The unique-per-UTC-day
  index replaces the read-then-write race in v1. Both crons can
  race; the DB decides.
- **Helius webhook + ingestion Worker.** Real-time donation
  ingestion is a first-class subsystem, not a missing piece. The
  operator does not need to push a button to make donations appear
  in the ledger.
- **TS for Workers, Python for the CI anchor.** The Cloudflare
  Python Workers runtime is still in beta and does not support
  native-extension packages like `solders` cleanly. Anchor stays
  Python in GH Actions; Cron Worker is TS and reuses `vault-core`
  (TypeScript).
- **Bot Worker is in a separate Cloudflare account section.** At
  v1 single-operator, this means a second Cloudflare account. The
  boundary is structural, not just binding-level.
