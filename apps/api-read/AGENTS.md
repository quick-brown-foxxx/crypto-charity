# apps/api-read (vault-api-read) — Agent Notes

## Role

**Public read-only API.** Serves all public `/api/*` endpoints with no
authentication. Reads from the shared `vault-db` D1 database. All endpoints
return JSON with 60s `Cache-Control` headers.

## Routes

| Method | Path                 | Purpose                                                                                                                                          |
| ------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/health`        | 5 health checks: db_reachable, anchor_stale, anchor_wallet_low_sol, ingest_recent_or_empty, helius_inbox_backlog_ok. Returns `ok` or `degraded`. |
| GET    | `/api/totals`        | Aggregated totals: in/out/balance, donation/disbursement counts, latest anchor info, staleness, low SOL                                          |
| GET    | `/api/donations`     | Paginated donation list. Cursor: `before_sequence_no`, limit: 50 (max 100).                                                                      |
| GET    | `/api/disbursements` | Paginated disbursement list. Same pagination as donations.                                                                                       |
| GET    | `/api/ledger-events` | Raw hash-chained ledger events (byte-for-byte `payload_json`). Cursor: `after_sequence_no`, limit: 500 (max 1000).                               |
| GET    | `/api/verify`        | Head hash/sequence_no, latest anchor, up to 30 previous anchors, TypeScript verification instructions, anchor_stale flag.                        |

The default deployment route is `staging.open-care.org/api/*`; the production
Wrangler environment routes `open-care.org/api/*` and sets `workers_dev=false`.

## Bindings

| Binding                                                                                                         | Type            | Purpose                                                    |
| --------------------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------- |
| `vault_db`                                                                                                      | D1 (`vault-db`) | Shared vault database — read-only access                   |
| `SOLANA_CLUSTER`, `USDC_MINT`, `TREASURY_WALLET_ADDRESS`, `VAULT_USDC_ATA`, `ANCHOR_WALLET_ADDRESS`, `SITE_URL` | Vars            | Public config values                                       |
| `DEPLOY_VERSION`                                                                                                | Var (optional)  | Version string in health response, defaults to `0.1.0-dev` |

**No secrets.** This Worker holds no `OPERATOR_TOKEN`, no private keys.

## Key source files

| File                             | Role                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `src/index.ts`                   | Hono app factory, mounts all route modules                                       |
| `src/routes/health.ts`           | 5 health checks, conservative defaults (false on query failure)                  |
| `src/routes/totals.ts`           | Aggregate sums via `getTotals`, BigInt balance computation                       |
| `src/routes/donations.ts`        | Paginated donations via `getDonations`                                           |
| `src/routes/disbursements.ts`    | Paginated disbursements via `getDisbursements`                                   |
| `src/routes/ledger-events.ts`    | Raw events via `getRawEventsPaginated` — byte-for-byte for external verification |
| `src/routes/verify.ts`           | Head hash, anchors, verification instructions                                    |
| `src/lib/cache.ts`               | `withCache()` — sets `Cache-Control: public, max-age=60`                         |
| `src/lib/pagination.ts`          | `validateLimit`, `validateCursor` for query params                               |
| `src/lib/verify-instructions.ts` | TypeScript verification code block for `/api/verify`                             |

## Connections

### Depends on

- `@open-care/vault-db` — `createVaultDb`, `getHead`, `getLatestAnchor`, `getTotals`, `getDonations`, `getDisbursements`, `getRawEventsPaginated`
- `@open-care/vault-core` — transitive through vault-db (not imported directly)
- `@open-care/api-contract` — type-only response contracts for public read endpoints

### Connected to

- **`vault-db`** (shared D1) — reads data written by `ingest`, `api-write`, `anchor-cron`
- **`vault-operator`** — has a service binding to this Worker for `GET /api/disbursements` passthrough

### Not connected to

- `tg-bot`, `bot-db` — no bot database access

## Key invariants

- All endpoints are read-only, no-auth, public
- 60s cache TTL on all responses to reduce D1 load
- `/api/ledger-events` returns raw `payload_json` strings (not parsed) — critical for bivalent correction model and independent auditability
- Health checks default to `false` on query failure — errs toward reporting degradation
- `anchor_wallet_low_sol` reads `last_anchor_wallet_sol_lamports` cached by `anchor-cron` — no RPC binding
