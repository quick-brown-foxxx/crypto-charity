# apps/ingest (vault-ingest) — Agent Notes

## Role

**Donation ingestion pipeline.** Entry point for all incoming USDC donations on
Solana. Receives Helius webhooks, stores them in a durable inbox, fetches full
transaction details from Solana RPC, parses SPL USDC transfers, and appends
`donation_confirmed` events to the hash-chained ledger. Also runs scheduled
reconciliation every 6 hours to catch missed transactions.

## Routes and triggers

| Route/Trigger         | Method | Auth                                | Purpose                                                                                  |
| --------------------- | ------ | ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `/webhook/helius`     | POST   | Helius Bearer token (constant-time) | Receive webhook events, insert into inbox, ACK fast, process async via `ctx.waitUntil()` |
| `/health`             | GET    | None                                | Liveness check                                                                           |
| `/internal/reconcile` | POST   | None (internal only)                | Manual reconciliation trigger                                                            |
| Cron `0 */6 * * *`    | —      | —                                   | Scheduled reconciliation + inbox processing                                              |

Only `/webhook/helius` is publicly routable. `/health` and `/internal/reconcile`
are reachable only internally (e.g. via service binding from `vault-operator`).
The default deployment route is `staging.open-care.org/webhook/helius`; the
production Wrangler environment routes `open-care.org/webhook/helius` and sets
`workers_dev=false`.

## Bindings

| Binding                                                                                                         | Type            | Purpose                                                              |
| --------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------- |
| `vault_db`                                                                                                      | D1 (`vault-db`) | Shared vault database — writes to `helius_inbox` and `ledger_events` |
| `HELIUS_WEBHOOK_AUTH_HEADER`                                                                                    | Secret          | Bearer token from Helius, validated via constant-time comparison     |
| `HELIUS_RPC_URL`                                                                                                | Secret          | Helius RPC endpoint for fetching transactions and signature lists    |
| `SOLANA_CLUSTER`, `USDC_MINT`, `TREASURY_WALLET_ADDRESS`, `VAULT_USDC_ATA`, `ANCHOR_WALLET_ADDRESS`, `SITE_URL` | Vars            | Public config values                                                 |

## Key source files

| File                        | Role                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `src/index.ts`              | Hono app factory, mounts routes, exports `scheduled` handler                           |
| `src/routes/webhook.ts`     | Webhook handler: auth, inbox insert, async processing                                  |
| `src/routes/reconcile.ts`   | Manual reconciliation trigger                                                          |
| `src/lib/inbox.ts`          | Core processing: `insertIntoInbox`, `processInbox`, `checkDuplicateDonation`           |
| `src/lib/reconciliation.ts` | `reconcileMissedSignatures` — scans vault ATA history for missed signatures            |
| `src/lib/solana-rpc.ts`     | Solana RPC client: `fetchTransaction`, `parseSplTransfer`, `fetchSignaturesForAddress` |
| `src/lib/auth.ts`           | Constant-time Helius auth header validation                                            |

## Connections

### Depends on

- `@open-care/vault-core` — types (`DonationPayload`, `Cluster`, `Result`), logging, `ok`/`err`
- `@open-care/vault-db` — `createVaultDb`, `appendLedgerEvent`, `vaultSchema`
- `@open-care/api-contract` — test-only `ApiErrorResponse` contract for webhook error compliance

### Connected to

- **Helius RPC** (external) — outbound HTTP for `getTransaction`, `getSignaturesForAddress`
- **`vault-db`** (shared D1) — writes donation events; read by `api-read`, `api-write`, `anchor-cron`
- **`vault-operator`** — can reach `/internal/reconcile` via service binding

### Not connected to

- `tg-bot`, `bot-db` — no interaction with Telegram bot

## Key invariants

- Webhook handler ACKs fast (insert into inbox, return 200) — all heavy work in `ctx.waitUntil()`
- Three-layer duplicate protection: `ON CONFLICT DO NOTHING` on inbox PK, pre-insert check, `checkDuplicateDonation` against ledger
- Inbox rows retry up to 10 attempts; retryable errors (network, rate limit, not finalized) keep `received` status
- Reconciliation scans vault ATA history for signatures not in inbox or ledger — ensures no missed donations
- This app owns `vault-db` migrations (`apps/ingest/migrations/`), including the append-only `ledger_events` UPDATE/DELETE prevention triggers
