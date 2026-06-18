# OpenCode Agent Notes

## Project shape

- Cloudflare Workers monorepo, pnpm workspace (`apps/*`, `packages/*`, `tools/*`).
- Runtime is **stateless V8 isolate per request**; persistence is D1, not memory.
- Package manager: `pnpm@11.6.0`.

## Apps and entrypoints

| App                | Worker name         | Binding                                                                                                                                   | `wrangler.jsonc`                                                                                                                       |
| ------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/ingest`      | `vault-ingest`      | `vault_db` (D1: `vault-db`)                                                                                                               | has route `staging.open-care.org/webhook/helius`, cron `0 */6 * * *`                                                                   |
| `apps/tg-bot`      | `tg-bot`            | `bot_db` (D1: `bot-db`)                                                                                                                   | has route `staging.open-care.org/tg/webhook`                                                                                           |
| `apps/api-read`    | `vault-api-read`    | `vault_db`                                                                                                                                | has route `staging.open-care.org/api/*`                                                                                                |
| `apps/api-write`   | `vault-api-write`   | `vault_db`                                                                                                                                | no public route; reached only via service binding from `vault-operator`                                                                |
| `apps/anchor-cron` | `vault-anchor-cron` | `vault_db`                                                                                                                                | no public route, cron `0 1 * * *`; reached via service binding from `vault-operator` for manual triggers                               |
| `apps/operator`    | `vault-operator`    | none (no D1 binding); uses service bindings to `vault-api-write`, `vault-anchor-cron`, `tg-bot`, `vault-api-read`; holds `OPERATOR_TOKEN` | has routes `staging.open-care.org/api/disbursements`, `staging.open-care.org/api/anchor/manual`, `staging.open-care.org/tg/internal/*` |
| `apps/web`         | (Pages)             | —                                                                                                                                         | —                                                                                                                                      |

**`vault-operator` is the sole holder of `OPERATOR_TOKEN`.** All operator-authenticated
endpoints (`/api/disbursements`, `/api/anchor/manual`, `/tg/internal/pending-requests`,
`/tg/internal/send-code`) flow through it; the token is never in
`vault-api-write` or `tg-bot`. Service bindings are in-process and
not-publicly-routable, so the downstream Workers are not exposed to the
public internet for these routes. See
[`docs/specs/01-architecture.md`](docs/specs/01-architecture.md) §"Operator
Worker trust model" for the full design.

**`vault-api-read`** exposes the public, no-auth surface
(`/api/totals`, `/api/donations`, `/api/disbursements` (the public list, not
the write), `/api/ledger-events`, `/api/verify`, `/api/health`). The
`/api/health.anchor_wallet_low_sol` field reads the cached
`anchor_runs.last_anchor_wallet_sol_lamports` value written by
`vault-anchor-cron`; the read Worker has no RPC binding.

All Workers use Hono. Main export is the Hono app from `src/index.ts`.

## Shared packages

| Package                 | Contents                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `@open-care/vault-core` | RFC 8785 canonical JSON, 4 event schemas (Zod), hash chain, test vector, beneficiary ref, anchor memo, logging |
| `@open-care/vault-db`   | Drizzle schemas (6 tables), ledger append helper, query helpers, client factories                   |
| `@open-care/bot-crypto` | HMAC-SHA256 user ref derivation, AES-GCM chat ID encryption/decryption, base64url                   |

## Migration directory location

D1 migration directories live inside specific app directories rather than a
neutral shared location:

| Database   | Migration directory       | Owner app      |
| ---------- | ------------------------- | -------------- |
| `vault-db` | `apps/ingest/migrations/` | `vault-ingest` |
| `bot-db`   | `apps/tg-bot/migrations/` | `tg-bot`       |

**Why this asymmetry exists:**

- Cloudflare D1 migrations are **per-database**, not per-Worker. A single
  `wrangler d1 migrations apply vault-db` command applies all pending
  migrations to the `vault-db` database, regardless of which Worker directory
  the command is run from.
- `vault-db` is shared across multiple Workers (`vault-ingest`, `vault-api-read`,
  `vault-api-write`, `vault-anchor-cron`). The migrations could live in any of
  these apps, but they must live in exactly one.
- `vault-ingest` was chosen as the designated "owner" app for `vault-db`
  migrations because it is the first Worker that writes to the database
  (ingesting donations from the Helius webhook).
- `bot-db` migrations live in `apps/tg-bot/migrations/` following the same
  pattern — `tg-bot` is the sole owner of `bot-db`.
- Test configurations reference the migration directory explicitly:
  `apps/api-read/vitest.config.ts` imports migrations from
  `../../apps/ingest/migrations` via `readD1Migrations()`.
- The deploy script (`pnpm run deploy`) applies migrations from the
  canonical locations before deploying Workers.

**Do not move migration directories** without updating all references
(vitest configs, deploy scripts, CI, and this documentation).

## Key constraints

- **Stateless.** No in-memory caches between requests. Use D1 for persistence.
- **CPU limit.** 30s per request. Long work goes in `ctx.waitUntil()`.
- **D1 latency.** Reads can be 5–50ms depending on edge location. Public endpoints
  use 60s cache TTLs (per spec `04-api.md`).
- **Secrets.** Accessed via `c.env.SECRET_NAME` (Hono bindings), not `process.env`.
- **No treasury key.** The treasury private key is never in Workers, CI, or repo.
  Operator custody only.

## Key decisions

| Decision                | Choice                                                                         |
| ----------------------- | ------------------------------------------------------------------------------ |
| Hash canonicalization   | RFC 8785 (JCS), normative test vector pinned                                   |
| Solana SDK              | `@solana/web3.js` v1 (`^1.98.4`)                                               |
| HTTP routing            | Hono                                                                           |
| Validation              | Zod (backend), Valibot (frontend)                                              |
| ORM                     | Drizzle with D1 driver                                                         |
| Test runner             | Vitest                                                                         |
| Browser tests           | Playwright                                                                     |
| Telegram E2E            | Telethon + pytest (manual/nightly, not PR CI)                                  |

## Future work

- Design phase (replace disposable frontend layers with production design)
- Mainnet launch (after production secrets and domain setup)
- Local realistic simulation and Solana interaction testing (localnet orchestration, webhook simulation fixtures, chain-state seeders)
