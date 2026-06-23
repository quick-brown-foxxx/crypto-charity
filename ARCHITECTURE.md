# Architecture & Feature Map

How the Open Care system works, what each component does, and how they connect.

## System overview

Open Care is a transparent crypto charity platform. Donors send USDC on Solana;
every donation, disbursement, and correction is recorded in a public,
hash-chained append-only ledger. A daily Solana Memo transaction anchors the
ledger head hash on-chain. Beneficiaries receive gift-card codes via Telegram.

The system runs on Cloudflare Workers (edge compute) with D1 (SQLite-at-edge)
for persistence. There is no long-running server — every request gets a fresh V8
isolate.

## Data flow

```text
Donor sends USDC → Helius webhook → vault-ingest → ledger_events (donation_confirmed)
                                                         │
Operator records disbursement → vault-operator → vault-api-write → ledger_events (disbursement_recorded)
                                                         │
Daily cron → vault-anchor-cron → Solana Memo tx → ledger_events (anchor_published)
                                                         │
Public reads ← vault-api-read ← vault-db (ledger_events, wallets, anchor_runs)
                                                         │
Beneficiary /start → tg-bot → bot-db (handles, conversations)
Operator sends code → vault-operator → tg-bot → Telegram delivery
```

## Component map

### Apps (Workers + Pages)

| App                | Role                                                                                                                                                                                     | Public?                                                                                 | Auth                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------ |
| `apps/ingest`      | Receives Helius webhooks, parses SPL USDC transfers, appends `donation_confirmed` events. Also runs reconciliation cron every 6 hours.                                                   | Route `/webhook/helius`                                                                 | Helius auth header                         |
| `apps/api-read`    | Public read API: totals, donations, disbursements, ledger events, verify, health. 60s cache TTLs.                                                                                        | Route `/api/*`                                                                          | None                                       |
| `apps/api-write`   | Append-only write path for disbursements and corrections. No public route — reached only via service binding from `vault-operator`.                                                      | None                                                                                    | Trusts operator (in-process binding)       |
| `apps/anchor-cron` | Daily cron (01:00 UTC) sends Solana Memo transaction with ledger head hash. Holds `ANCHOR_WALLET_SECRET`. Manual trigger via operator service binding.                                   | None                                                                                    | Trusts operator (in-process binding)       |
| `apps/operator`    | Auth gateway. Sole holder of `OPERATOR_TOKEN`. Forwards authenticated requests to `vault-api-write`, `vault-anchor-cron`, `tg-bot` via service bindings. Also serves operator UI routes. | Routes `/api/disbursements`, `/api/corrections`, `/api/anchor/manual`, `/tg/internal/*` | Constant-time token comparison             |
| `apps/tg-bot`      | Telegram bot: `/start`, `/card`, `/whoami`, `/help`. HMAC-derived user refs, AES-GCM encrypted chat IDs. Code delivery with hash/last4 retention.                                        | Route `/tg/webhook`                                                                     | Telegram webhook secret                    |
| `apps/web`         | SvelteKit frontend (Cloudflare Pages). Public pages: landing, donate, ledger, verify, about, faq, contact. Operator admin: disbursement form, anchor trigger, bot handoff.               | All routes                                                                              | Operator token (memory-only, idle timeout) |

### Shared packages

| Package                   | Role                                                                                                                                                               | Consumers                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `@open-care/vault-core`   | Domain foundation: 4 event types, Zod schemas, RFC 8785 canonical JSON, SHA-256 hash chain, Solana anchor memo, beneficiary refs, structured logging, Result type. | All 6 Workers, vault-db, bot-crypto, seed tool                                          |
| `@open-care/vault-db`     | Database layer: Drizzle schemas for vault-db (4 tables) and bot-db (2 tables), client factories, ledger append helper, query helpers, public API types.            | ingest, api-read, api-write, anchor-cron, tg-bot                                        |
| `@open-care/bot-crypto`   | Telegram crypto: HMAC-SHA256 user ref derivation, AES-GCM chat ID encryption/decryption, base64url.                                                                | tg-bot only                                                                             |
| `@open-care/api-contract` | Type-only API response/request contracts shared across Workers and frontend schema checks; no runtime validation code.                                             | api-read, api-write, anchor-cron, operator, tg-bot, web; ingest tests use shared errors |

### Databases

| Database   | Tables                                                    | Owner app (migrations)    | Consumers                                |
| ---------- | --------------------------------------------------------- | ------------------------- | ---------------------------------------- |
| `vault-db` | `ledger_events`, `wallets`, `anchor_runs`, `helius_inbox` | `apps/ingest/migrations/` | ingest, api-read, api-write, anchor-cron |
| `bot-db`   | `handles`, `conversations`                                | `apps/tg-bot/migrations/` | tg-bot                                   |

## Trust boundaries

```
                    Public internet
                         │
    ┌────────────────────┼────────────────────┐
    │                    │                    │
    ▼                    ▼                    ▼
vault-api-read      vault-ingest          tg-bot
(no secrets)        (helius auth)         (tg secret)
    │                    │                    │
    │              [service bindings — in-process, not routable]
    │                    │                    │
    ▼                    ▼                    ▼
vault-db            vault-db              bot-db
                         ▲                    ▲
                         │                    │
                    vault-api-write      [operator→tg-bot]
                    vault-anchor-cron
                         ▲
                         │
                    vault-operator
                    (OPERATOR_TOKEN)
```

- **`vault-operator` is the sole holder of `OPERATOR_TOKEN`.** The token never leaves this Worker.
- **`vault-anchor-cron` is the sole holder of `ANCHOR_WALLET_SECRET`.** The anchor wallet key never leaves this Worker.
- **Service bindings are in-process and not publicly routable.** Downstream Workers (`vault-api-write`, `vault-anchor-cron`, `tg-bot` internal routes) are not exposed to the internet.
- **Production Worker envs disable `workers.dev`.** Production ingress is limited to configured `open-care.org` routes, service bindings, and cron triggers.
- **The treasury private key is never in any Worker, CI, or repo.** Operator custody only.
- **`tg-bot` stores no plaintext Telegram IDs or chat IDs.** User refs are HMAC-SHA256; chat IDs are AES-GCM encrypted.

## Feature map

### Donation flow

1. Donor sends USDC to the vault's USDC ATA on Solana
2. Helius webhook notifies `vault-ingest` (ACK fast, process async)
3. `vault-ingest` fetches the transaction, parses the SPL transfer, validates amount/mint/ATA
4. Appends `donation_confirmed` to `ledger_events` with hash chain
5. Reconciliation cron catches any missed transactions every 6 hours

### Disbursement flow

1. Operator purchases gift cards, records via `/admin/disbursements`
2. `vault-operator` validates token, forwards to `vault-api-write`
3. `vault-api-write` validates payload (Zod), generates `benpub_` ref, appends `disbursement_recorded`
4. Public can see disbursement in ledger (amount, service, receipt ref, beneficiary ref)

### Anchor flow

1. Daily cron (01:00 UTC) triggers `vault-anchor-cron`
2. Reads ledger head hash, builds `ccv-anchor:<64hex>` Memo instruction
3. Signs and sends Solana transaction from anchor wallet
4. On success: appends `anchor_published` to ledger
5. Manual trigger available via operator `/api/anchor/manual`
6. Lock protocol prevents concurrent anchor attempts; stale lock recovery built in

### Verification

1. Public `/verify` page shows current head hash and latest anchor memo
2. Anyone can export the full ledger (`/api/ledger-events`)
3. Anyone can independently verify with `test/verify/verify-chain.ts`: recompute hash chain, check anchor memo matches the anchored ledger head, and confirm anchor tx metadata exposed by `/api/verify`

### Beneficiary flow (Telegram)

1. Beneficiary sends `/start <handle>` to the Telegram bot
2. `tg-bot` derives HMAC-SHA256 user ref, encrypts chat ID with AES-GCM
3. Beneficiary requests card with `/card`
4. Operator sees pending requests (redacted — no plaintext IDs) via `/admin`
5. Operator sends gift-card code → `tg-bot` delivers to beneficiary
6. After delivery: only hash + last4 retained; full code encrypted with short TTL for retry

### Corrections

1. Operator can correct a previous event's `receipt_ref` or `service_note` via `POST /api/corrections`
2. Whitelist enforcement: only those two fields can be replaced
3. Original `payload_json` preserved byte-for-byte in read API (bivalent)
4. Correction is itself a hash-chained ledger event

## Key technical decisions

| Decision              | Choice                            | Why                                        |
| --------------------- | --------------------------------- | ------------------------------------------ |
| Hash canonicalization | RFC 8785 (JCS)                    | Deterministic JSON for reproducible hashes |
| Solana SDK            | `@solana/web3.js` v1              | Stable, widely used                        |
| HTTP framework        | Hono                              | Lightweight, Workers-native                |
| Validation            | Zod (backend), Valibot (frontend) | Tree-shakeable for edge                    |
| ORM                   | Drizzle with D1 driver            | Type-safe, SQL-first                       |
| Test runner           | Vitest                            | Native ESM, fast                           |
| Browser tests         | Playwright                        | Real browser, not jsdom                    |
| Telegram E2E          | Telethon + pytest                 | Manual live, not PR CI                     |

## Future work

- Design phase (replace disposable frontend layers with production design)
- Mainnet launch (after production secrets and domain setup)
- Local realistic simulation and Solana interaction testing (blockchain test cases,
  webhook simulation fixtures, chain-state seeders)
