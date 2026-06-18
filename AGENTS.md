# OpenCode Agent Notes

**Status:** All 8 epics implemented, verified, and deployed to staging. 620 tests pass, CI green (all 5 gates exit 0). Frontend rebuilt to match `docs/ui-prototypes/landing.html`. See `docs/implementation-plan.md` for current backlog.

## Project shape

- Cloudflare Workers monorepo, pnpm workspace (`apps/*`, `packages/*`, `tools/*`).
- Runtime is **stateless V8 isolate per request**; persistence is D1, not memory.
- Package manager: `pnpm@11.6.0`.

## Apps and entrypoints

| App                | Worker name         | Binding                                                                                                                                   | `wrangler.jsonc`                                                                                                                       | Code status                                                                   |
| ------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `apps/ingest`      | `vault-ingest`      | `vault_db` (D1: `vault-db`)                                                                                                               | has route `staging.open-care.org/webhook/helius`, cron `0 */6 * * *`                                                                   | ✅ Real: Helius webhook + async SPL processing + reconciliation               |
| `apps/tg-bot`      | `tg-bot`            | `bot_db` (D1: `bot-db`)                                                                                                                   | has route `staging.open-care.org/tg/webhook`                                                                                           | ✅ Real: 4 commands, HMAC+AES-GCM, redacted operator view, code delivery      |
| `apps/api-read`    | `vault-api-read`    | `vault_db`                                                                                                                                | has route `staging.open-care.org/api/*`                                                                                                | ✅ Real: 6 public endpoints with 60s cache, D1 queries                        |
| `apps/api-write`   | `vault-api-write`   | `vault_db`                                                                                                                                | no public route; reached only via service binding from `vault-operator`                                                                | ✅ Real: POST /api/disbursements with Zod validation + hash-chained append    |
| `apps/anchor-cron` | `vault-anchor-cron` | `vault_db`                                                                                                                                | no public route, cron `0 1 * * *`; reached via service binding from `vault-operator` for manual triggers                               | ✅ Real: Solana Memo pipeline, lock protocol, recovery                        |
| `apps/operator`    | `vault-operator`    | none (no D1 binding); uses service bindings to `vault-api-write`, `vault-anchor-cron`, `tg-bot`, `vault-api-read`; holds `OPERATOR_TOKEN` | has routes `staging.open-care.org/api/disbursements`, `staging.open-care.org/api/anchor/manual`, `staging.open-care.org/tg/internal/*` | ✅ Real: constant-time auth, CORS, per-route auth, service binding forwarding |
| `apps/web`         | (Pages)             | —                                                                                                                                         | —                                                                                                                                      | ✅ Real: SvelteKit 2 + Svelte 5, 12 routes, prototype-matching design         |

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

| Package                 | Status                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `@open-care/vault-core` | ✅ RFC 8785 canonical JSON, 4 event schemas (Zod), hash chain, test vector, beneficiary ref, anchor memo, logging |
| `@open-care/vault-db`   | ✅ Drizzle schemas (6 tables), ledger append helper, query helpers, client factories                              |
| `@open-care/bot-crypto` | ✅ HMAC-SHA256 user ref derivation, AES-GCM chat ID encryption/decryption, base64url                              |

## Local dev

- Copy `.env.example` → `.dev.vars` (gitignored). `wrangler dev` reads `.dev.vars`, not `.env`.
- Use fake/generated keys locally; never put staging/prod secrets in `.dev.vars`.
- Per-app dev server:

  ```bash
  cd apps/<name>
  pnpm dev          # wrangler dev → http://localhost:8787
  ```

- D1 is local SQLite automatically. Migrations are applied per DB name:

  ```bash
  pnpm exec wrangler d1 migrations apply vault-db --local
  pnpm exec wrangler d1 migrations apply bot-db --local
  ```

## Quality gates (run before commit/PR)

```bash
pnpm run final-check   # format:check → lint → typecheck → test → build
```

This runs the exact same sequence as CI. All 5 gates must exit 0. Current: 593 tests pass (38 files), tsc -b clean, lint exit 0, format:check passes, build succeeds.

Individual gates:

```bash
pnpm run format:check   # prettier --check .
pnpm run lint           # eslint .
pnpm run check          # tsc -b
pnpm run test           # vitest run
pnpm run build          # tsc -b + SvelteKit build
```

## Secrets and config

- Access secrets in code via Hono bindings (`c.env.SECRET_NAME`), **not** `process.env`.
- Deployed secrets are set with `wrangler secret put` per Worker. All 9 Worker secrets are set. See `docs/ops/secrets-inventory.md`.
- The **treasury private key is never in Workers, CI, repo, or logs** — operator custody only.
- Public config values (e.g. `USDC_MINT`, treasury/anchor addresses) live in `.env.example` / `wrangler.jsonc` vars, not secrets.

## Deploy

- All-in-one staging deploy:

  ```bash
  pnpm run deploy       # migrations → 6 Workers → frontend Pages
  ```

- Per-app deploy from inside the app directory:

  ```bash
  cd apps/<name>
  pnpm exec wrangler deploy
  ```

- Frontend only:

  ```bash
  pnpm run deploy:frontend
  ```

- Staging is the default environment. No `--env production` setup exists yet.
- Live logs: `pnpm exec wrangler tail <worker-name>`.

## Seed data (local dev)

```bash
pnpm run seed   # applies migrations + seed data for both D1 databases
```

## Current backlog

See `docs/implementation-plan.md` for the full backlog. Epics 0-6 are complete. Remaining MVP epics: 7 (Frontend Testing & Hardening) and 8 (Backend Completeness).
