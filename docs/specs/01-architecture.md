# 01 — Architecture

**Status:** Implemented
**Date:** 2026-06-18
**Scope:** MVP system shape, data flow, and trust boundaries.

## How to read this

This document explains how components fit together. The database schemas are in
[`03-data-model.md`](03-data-model.md), the HTTP contract is in
[`04-api.md`](04-api.md), the frontend architecture is in
[`10-frontend-architecture.md`](10-frontend-architecture.md), and the rules are
in [`02-invariants.md`](02-invariants.md).

## System shape

```text
              Public donor surface                    Operator surface
              read-only, no auth                       authenticated
┌────────────────────────────────────┐      ┌───────────────────────────────┐
│ SvelteKit Cloudflare Pages         │      │ /admin operator UI             │
│ - landing, donate, ledger, verify  │      │ - record disbursement          │
│ - /faq, /about (prerendered static) │      │ - trigger manual anchor        │
│ - contact                          │      │ - record delivery (bot handoff)│
└──────────────────┬─────────────────┘      └──────────────┬────────────────┘
                   │ reads                                  │ writes (operator token)
                   ▼                                        ▼
┌────────────────────────────────────┐      ┌───────────────────────────────┐
│ vault-api-read Worker              │      │ vault-operator Worker          │
│ - public JSON                      │      │ - sole holder of OPERATOR_    │
│ - ledger export + verify           │      │   TOKEN                        │
│ - /api/totals, /api/donations,     │      │ - /api/disbursements →         │
│   /api/disbursements,              │      │   vault-api-write              │
│   /api/ledger-events, /api/verify, │      │ - /api/anchor/manual →         │
│   /api/health                      │      │   vault-anchor-cron            │
│ - no secrets                       │      │ - /tg/internal/pending-       │
│ - reads anchor_runs.last_anchor_   │      │   requests → tg-bot            │
│   wallet_sol_lamports for health   │      │ - /tg/internal/send-code →     │
│   check (no RPC binding)            │      │   tg-bot                       │
└──────────────────┬─────────────────┘      └──────────────┬────────────────┘
                   │ reads                                  │ service binding
                   ▼                                        ▼
┌────────────────────────────────────┐      ┌───────────────────────────────┐
│ vault-db (Cloudflare D1)           │      │ vault-api-write Worker         │
│ - ledger_events                    │      │ - no OPERATOR_TOKEN; trusts   │
│ - wallets, anchor_runs,            │      │   the operator Worker         │
│   helius_inbox, read models        │      │ - ledger append helper         │
└────────────────────────────────────┘      └──────────────┬────────────────┘
         ▲ appends/updates ops state                         │ appends
         │                                                     ▼
┌───────┴──────────────────────┐                ┌───────────────────────────────┐
│ vault-ingest Worker           │                │ vault-anchor-cron Worker       │
│ - /webhook/helius             │                │ - sole holder of ANCHOR_      │
│ - Authorization authHeader    │                │   WALLET_SECRET                │
│ - ACKs fast + ctx.waitUntil   │                │ - scheduled cron (0 1 * * *)   │
│ - finalized SPL USDC parsing  │                │ - writes last_anchor_wallet_  │
└───────────────┬──────────────┘                │   sol_lamports for health      │
                ▲                                │ - sends Memo transaction       │
                │ HTTPS                           │ - calls runAnchor() in         │
┌───────────────┴──────────────┐                │   packages/vault-core          │
│ Helius webhooks + RPC         │                └─────────────┬─────────────────┘
│ - vault USDC ATA watch        │                              │ Solana RPC
│ - reconciliation history      │                              ▼
└───────────────────────────────┘                ┌───────────────────────────────┐
                                                 │ Solana                         │
                                                 │ - USDC SPL transfers           │
                                                 │ - Memo anchors                 │
                                                 └───────────────────────────────┘

              Beneficiary surface: separate app/db boundary
┌───────────────────────────────────────────────────────────────────────────┐
│ tg-bot Worker                                                              │
│ - same Cloudflare account, separate Worker + D1 binding                    │
│ - bot-db binding only                                                      │
│ - receives Telegram webhook                                                │
│ - called by the operator Worker via service binding for /tg/internal/*    │
│ - sends gift-card codes; does not retain full code after delivery          │
└──────────────────┬────────────────────────────────────────────────────────┘
                   ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ bot-db (Cloudflare D1)                                                     │
│ - handles: opaque_id, handle, telegram_user_ref, telegram_chat_id_enc      │
│ - handles: telegram_chat_key_version, first/last_seen, is_active           │
│ - conversations: request/delivery status, hash/last4/short-TTL encrypted   │
│   delivery value when needed                                               │
└──────────────────┬────────────────────────────────────────────────────────┘
                   ▼
            Telegram beneficiaries
```

## Components

- **`apps/web`** — SvelteKit 2.x + Svelte 5 app deployed to Cloudflare Pages via
  `adapter-cloudflare`. Renders public API data, the `/faq` and `/about` pages
  (prerendered, static, with content-presence Playwright tests), the verify
  page, and the `/admin` operator UI. Public bundles contain no secrets; the
  MVP operator token is memory-only in the browser and sent only to the
  `vault-operator` Worker.
- **`apps/api-read`** — read-only Worker serving public JSON and ledger export.
  No secrets.
- **`apps/operator`** — **the sole holder of `OPERATOR_TOKEN`**. Auths every
  operator request, then routes to the right Worker via Cloudflare
  service bindings: `/api/disbursements` and `/api/corrections` to `vault-api-write`,
  `/api/anchor/manual` to `vault-anchor-cron`,
  `/tg/internal/pending-requests` and `/tg/internal/send-code` to `tg-bot`.
  One trust boundary, one secret, one Worker.
- **`apps/api-write`** — Worker that trusts the operator Worker (no
  `OPERATOR_TOKEN` of its own) and appends to `ledger_events`. Reached only
  via service binding from `vault-operator`.
- **`apps/ingest`** — Helius webhook receiver. Authenticates `Authorization`,
  writes `helius_inbox`, ACKs quickly, and processes finalized USDC transfers
  asynchronously.
- **`apps/anchor-cron`** — scheduled anchor Worker. The sole holder of
  `ANCHOR_WALLET_SECRET`. Reached from the cron trigger or via service
  binding from `vault-operator` for the manual trigger.
- **`apps/tg-bot`** — Telegram webhook Worker with `bot-db` only. It handles
  registration, requests, delivery, keyed HMAC Telegram user lookup, and
  encrypted chat-route storage. Reached from the public Telegram webhook
  and via service binding from `vault-operator` for the internal
  endpoints.
- **`packages/vault-core`** — TypeScript event schemas, canonical JSON,
  hash-chain verification, Solana Memo builder, and public verification logic.
- **`packages/vault-db`** — shared Drizzle ORM schema definitions and D1 query
  helpers for `vault-db`.
- **`packages/bot-crypto`** — HMAC and authenticated-encryption helpers for
  Telegram identity and chat-route storage.
- **`test/verify`**, **`test/localnet`**, **`test/smoke`**, and
  **`test/e2e-tg`** — auxiliary verification and smoke-test tooling for public
  chain verification, local Solana validation, env-gated live checks, and
  Telegram E2E.

## Operator Worker trust model

The `vault-operator` Worker is a thin auth-and-route layer:

- Receives a request with `Authorization: Bearer <OPERATOR_TOKEN>`.
- Verifies the token (constant-time comparison; the only Worker that
  holds the secret).
- Looks up the destination Worker for the route:
  - `/api/disbursements` → `vault-api-write`
  - `/api/anchor/manual` → `vault-anchor-cron`
  - `/tg/internal/pending-requests`, `/tg/internal/send-code` → `tg-bot`
- Forwards the request body to the destination Worker via a Cloudflare
  service binding (in-process call, not a public HTTP hop). The destination
  Worker is **not exposed to the public internet** for these routes; the
  binding is the only entry point.
- Returns the destination's response to the operator UI.

This means:

- A leak of `OPERATOR_TOKEN` in one Worker (a debug log in the bot, for
  example) is no longer possible — only the operator Worker has the
  token. The bot and the vault write paths are reached via service
  binding, which is internal and does not require or accept a bearer
  token.
- Rotation is global but simple: rotate `OPERATOR_TOKEN` on the
  `vault-operator` Worker only.
- Each downstream Worker is protected by the binding allowlist, not
  by an auth check. A binding allowlist CI test (per
  [`08-testing-strategy.md`](08-testing-strategy.md) §"Per-invariant
  mapping" I-7) prevents accidental exposure of the operator routes
  to the public internet.

## Backend stack

| Concern                    | Choice                                                              | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo / package manager | `pnpm` workspaces                                                   | Same toolchain for frontend and backend.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Runtime / hosting          | Cloudflare Workers via `wrangler`                                   | Edge-native, binds D1/KV/Secrets in-process, fits the existing deployment model.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| HTTP routing               | **Hono** with `@hono/zod-validator`                                 | Edge-native, TypeScript-first, tiny bundle, Cloudflare-recommended. NestJS/Express/Fastify are avoided because they target long-running Node.js servers and require heavy `nodejs_compat` shims.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Validation / schemas       | **Zod**                                                             | Schema-first boundary validation; schemas live in `packages/vault-core` and can be shared with the frontend.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Database access            | **Drizzle ORM** with D1 driver                                      | Native D1 support, SQL-first type-safe queries, tiny runtime, migration discipline via `drizzle-kit`. Prisma is avoided because its D1 adapter is newer/heavier and a classic Prisma client does not run on Workers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Solana SDK                 | `@solana/web3.js` v1 (`^1.98.4`) + `@solana/spl-token` (`^0.4.14`)  | The `latest` dist-tag on npm. v1 is in maintenance mode (security patches continue) and is what every third-party Solana tool targets (Python `solana-py`, Rust `solana-sdk`, Helius docs, all donor-facing verifiers). `@solana/web3.js` v2 is published on the `next` dist-tag (a major API rewrite: `createSolanaRpc(...)` + `.send()` instead of `new Connection(...)`), and `@solana/spl-token` v2 does not exist on `latest` at all. The MVP uses v1. **Migration trigger:** when `@solana/web3.js` v2 reaches the `latest` dist-tag AND has at least one stable patch release AND the Helius + donor-verifier ecosystem publishes v2-compatible libraries, plan a one-week evaluation window and migrate. |
| Errors / expected failures | Explicit `Result<T, E>` or discriminated unions (e.g. `neverthrow`) | Engineering-principles aligned; transport layer converts, business logic returns.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Logging                    | Structured JSON                                                     | Compatible with Cloudflare Workers observability; no plaintext secrets.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Wallet model

| Wallet          | Role                                           | Secret availability                                              | Public monitoring                                                                                   |
| --------------- | ---------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Treasury wallet | Owns the vault USDC ATA and receives donations | No private key in CI, Workers, repo, or normal app runtime       | Vault USDC ATA balance and transfer history; owner scan only for reconciliation candidate discovery |
| Anchor wallet   | Signs Memo anchor transactions                 | `ANCHOR_WALLET_SECRET` in anchor Worker / gated manual tool only | SOL balance, Memo transactions                                                                      |

The anchor wallet holds only enough SOL for fees. Ops includes a low-SOL alert
and a manual replenishment step from an operator-controlled wallet.

## Data flows

### Donation ingest

1. Donor sends SPL USDC to the vault USDC ATA.
2. Helius posts an enhanced webhook for the watched vault USDC ATA. Owner-address
   watches may be enabled only to discover reconciliation candidates.
3. `apps/ingest` checks `Authorization` equals the configured Helius
   `authHeader` value.
4. The handler inserts or finds `helius_inbox.signature` and returns `200`
   within about one second.
5. Async processing fetches the transaction with `commitment: "finalized"` and
   `maxSupportedTransactionVersion: 0`.
6. The parser accepts only SPL Token transfers for the configured USDC mint whose
   destination is the configured vault USDC ATA.
7. If the signature is new and valid, the ledger append helper writes a
   `donation_confirmed` event.
8. Read-model caches are purged or allowed to expire within the documented
   bounded staleness window.

### Reconciliation/backfill

1. A scheduled or manual reconciliation job queries address/token-account
   history for the vault USDC ATA and treasury owner.
2. Missing signatures are inserted into `helius_inbox` with
   `source='reconciliation'`.
3. The same async processor handles them. Duplicate signatures are ignored.
4. RPC `null` before finality, 429, and 5xx responses retry with backoff.

This minimal backfill path is part of the MVP because webhooks are delivery
signals, not the source of truth for Solana history.

### Operator disbursement

1. A beneficiary requests a card through the Telegram bot.
2. The bot stores the request in `bot-db` and exposes only an operator-safe view
   to `/admin` via `vault-operator` (the operator Worker).
3. The operator buys the gift card manually.
4. The operator records amount, count, service, receipt reference, purchase
   time, and a server-generated `public_beneficiary_ref` or no public reference.
5. `apps/web` POSTs to `vault-operator` with `OPERATOR_TOKEN`. `vault-operator`
   validates the token, then forwards the request to `vault-api-write` via
   service binding.
6. `vault-api-write` appends a `disbursement_recorded` event.
7. The bot sends the code to the beneficiary. After delivery, bot storage keeps
   only delivery status plus code hash/last4, or a short-TTL encrypted value if
   retry requires it. The `vault-operator` Worker calls
   `POST /tg/internal/send-code` on the `tg-bot` Worker via service binding.

### Daily anchor

1. The anchor runner computes the current ledger head before adding an anchor
   publication event.
2. It creates Memo text `ccv-anchor:<64hex head_hash>` and sends a Solana
   transaction signed by the anchor wallet.
3. Mutable attempt state is recorded in `anchor_runs`.
4. Once the transaction is known/finalized, the runner appends an
   `anchor_published` event whose payload includes `anchor_date`,
   `anchored_head_hash`, `tx_signature`, `anchor_wallet_address`,
   `memo_text`, and `published_at_utc`.
5. A later anchor covers this anchor publication event.

### Beneficiary bot flow

1. Beneficiary DMs `/start <handle>` or `/card`.
2. The bot receives Telegram user and chat IDs from the incoming update.
3. The bot computes `telegram_user_ref` with
   `HMAC-SHA256(TG_ID_HMAC_KEY, "tg-user:" + telegram_user_id)`.
4. The bot encrypts the Telegram chat route into `telegram_chat_id_enc` with
   authenticated encryption under `TG_CHAT_ENC_KEY` and records
   `telegram_chat_key_version`.
5. `bot-db` stores `opaque_id`, `handle`, `telegram_user_ref`,
   `telegram_chat_id_enc`, key version, timestamps, and active state; it stores
   no plaintext Telegram user ID or chat ID.
6. Beneficiary DMs `/card`; bot records a pending conversation.
7. Operator fulfills manually from `/admin` without seeing Telegram user ID or
   chat ID.
8. Bot decrypts `telegram_chat_id_enc` only in memory, posts the code to
   Telegram, does not log plaintext chat ID, and minimizes stored delivery data.

## Trust boundaries

| Layer                      | Proves                                                                           | Does not prove                                                                    |
| -------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `ledger_events` hash chain | Public records have one append-only order and payload history.                   | Receipts are genuine.                                                             |
| Solana Memo anchor         | A specific pre-anchor head hash was publicly posted at a time.                   | The anchor event itself is included in that same transaction.                     |
| Public verify/export       | Donors can recompute what the site claims.                                       | The operator bought a real gift card.                                             |
| Two database topology      | Vault Workers cannot query bot identity mapping when bindings are kept separate. | Telegram/provider metadata is anonymous to Telegram.                              |
| Bot identity storage       | A `bot-db`-only leak does not reveal plaintext Telegram user IDs or chat IDs.    | DB plus bot secrets, or bot runtime compromise, can still deanonymize or deliver. |
| Bot binding discipline     | Normal vault code does not casually read Telegram mapping.                       | State-adversary-grade or Cloudflare-account-compromise protection.                |

The architecture promises tamper-evidence and narrower operator visibility. It
does not promise cryptographic proof of receipt truth or full anonymity.

## Why this architecture

- **Canonical `ledger_events` table.** One append-only source of truth avoids
  ambiguity between typed tables and hash preimages.
- **Payload-committing hashes.** Donor-visible facts are part of the hash chain,
  so public verification can detect payload tampering.
- **Separate mutable operational state.** `anchor_runs` and `helius_inbox` can
  retry and record errors without weakening append-only ledger semantics.
- **Separate wallets.** The treasury private key is not required for anchoring;
  an anchor-key compromise cannot spend donations.
- **ACK-fast ingest.** Helius delivery reliability improves when the webhook
  endpoint returns `200` quickly and processes from a durable inbox.
- **One Cloudflare account, two D1 databases.** The rejected stronger option was
  separate Cloudflare accounts for vault and bot. The accepted MVP and
  foreseeable-future topology keeps one Cloudflare account for operational
  simplicity, while preserving the important boundary with separate Workers,
  separate D1 databases, separate secrets, and CI-enforced binding allowlists.
- **One operator Worker holds `OPERATOR_TOKEN`.** The rejected alternative was
  sharing the token between `vault-api-write` and `tg-bot` (a leak in one
  Worker compromises both), or splitting into two tokens (`VAULT_OPERATOR_TOKEN`
  - `BOT_OPERATOR_TOKEN`, two secrets, two rotations, two-token UI for a
    single-operator MVP). The accepted topology is a single thin Worker
    (`vault-operator`) that auths every operator request once, then forwards
    via service binding to the right downstream Worker. One trust boundary,
    one secret, one rotation. Service bindings are in-process and
    not-publicly-routable, so a downstream Worker that holds no
    `OPERATOR_TOKEN` of its own is unreachable from the public internet.
