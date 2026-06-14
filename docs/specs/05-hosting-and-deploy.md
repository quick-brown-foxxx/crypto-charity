# 05 — Hosting and deployment

**Status:** Draft v0.3.1
**Date:** 2026-06-14
**Scope:** MVP v1. Where the bytes live, how code gets there, where secrets live.

## How to read this

This doc describes **the infrastructure** — the Cloudflare account
topology, the secrets, the CI/CD, the local dev story. It does not
describe what the system does (see [`00-overview.md`](00-overview.md))
or what the API looks like (see [`04-api.md`](04-api.md)). The
invariants the infrastructure must satisfy live in
[`02-invariants.md`](02-invariants.md).

## Decisions (with reasoning)

| Decision                                  | Choice                                                    | Why                                                                                                                                                                  |
| ----------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static site host                          | Cloudflare Pages                                          | First-class Vite/React, free tier, commercial use allowed, no idle cost.                                                                                              |
| Read API                                  | Cloudflare Worker (no secrets, read-only binding)         | Free tier, edge cache, no idle cost.                                                                                                                                |
| Write API, ingest, anchor-cron            | Cloudflare Workers (per-Worker bindings + secrets)        | Free tier sufficient, no idle cost.                                                                                                                                |
| Telegram bot Worker                       | Cloudflare Worker, **second Cloudflare account**           | Structural isolation. The operator does not have admin access to the bot's account. Required for invariant I-9.                                                       |
| Ledger database                           | Cloudflare D1 (`vault-db`)                                | Free tier allows 10 databases per account. Append-only, SQLite-compatible, edge-replicated.                                                                          |
| Bot database                              | Cloudflare D1 (`bot-db`), separate database               | Same free-tier allowance. The `vault-db` Workers do not have the `bot-db` binding, by platform, not by code review.                                                  |
| Daily anchor (primary)                    | Cloudflare Cron Trigger (02:17 UTC)                        | 5 triggers/account free, runs on UTC, reliable. **Not 02:00** — top of the hour is the worst possible slot per GitHub's own schedule docs.                          |
| Daily anchor (backup)                     | GitHub Actions `schedule` (02:17 UTC)                      | Free for public repos. The two crons race; the DB unique index decides the winner.                                                                                    |
| Solana RPC                                | Helius free tier                                          | 1 sendTransaction/sec, 10 RPC req/s, 5 webhooks, 10M credits. We use 1 webhook (vault address) and a few RPC req/day.                                                |
| Wallet custody                            | GitHub Actions encrypted secret + Workers Secret          | Two locations, never in code/repo/logs/build artifacts. See invariant I-6.                                                                                            |
| CI                                        | GitHub Actions                                            | Free for public repos, well-understood, no idle cost.                                                                                                                |
| Frontend framework                        | React + Vite + TypeScript                                 | Mature ecosystem on Pages, TanStack Query, react-i18next, and react-hook-form are all available off the shelf.                                                       |
| Backend language                          | TypeScript for Workers, Python for the CI anchor          | Cloudflare Workers Python is still beta and won't run `solders` (a native-extension PyPI package). The CI anchor is the right place for Python.                     |

## Cloudflare account topology

Two Cloudflare accounts, one Cloudflare organization (if available
on the plan; otherwise just two separate logins).

### Account A — "Vault" (operator's primary)

Resources:

- **Pages project:** `vault-web` — bound to the GitHub repo, builds
  `apps/web`, deploys on push to `main`.
- **Workers:**
  - `vault-api-read` (apps/api-read). Bindings: `vault-db` (read).
    Secrets: none.
  - `vault-api-write` (apps/api-write). Bindings: `vault-db` (write).
    Secrets: `OPERATOR_TOKEN`. Performs in-process cache purge
    via the Workers Cache API.
  - `vault-ingest` (apps/ingest). Bindings: `vault-db` (write).
    Secrets: `HELIUS_WEBHOOK_SECRET`, `VAULT_WALLET_ADDRESS`.
    Same in-process cache purge.
  - `vault-anchor-cron` (apps/anchor-cron). Bindings: `vault-db`
    (write). Secrets: `WALLET_SECRET`, `HELIUS_RPC_URL`.
- **D1 database:** `vault-db`.
- **Cron Triggers:** one trigger on `vault-anchor-cron`,
  `crons = ["17 2 * * *"]` in `wrangler.toml` (5-field standard
  cron, 02:17 UTC, off the top of the hour).
- **R2 bucket (deferred):** `vault-receipts` for receipt images.
  Not used in v1 (see [`09-decisions.md`](09-decisions.md#q-6-receipt-storage)).

### Account B — "Bot" (operator does not have admin)

Resources:

- **Workers:**
  - `tg-bot` (apps/tg-bot). Bindings: `bot-db` (write). Secrets:
    `TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET`, `VAULT_API_URL`,
    `OPERATOR_TOKEN` (for calling the vault's write API on the
    operator's behalf when delivering gift card codes).
- **D1 database:** `bot-db`.

Account A's Workers do not have any binding to `bot-db`. Account
B's `tg-bot` has a binding to `bot-db` only. This is enforced by
Cloudflare's per-Worker binding model, not by code review.

The Telegram bot account itself is on a phone/account the operator
does not have admin access to. The bot's chat history lives at
Telegram, not in our infrastructure. (See invariant I-9.)

## Secrets (where each one lives)

**Rotation note for `OPERATOR_TOKEN`:** it lives in **two**
locations — the `vault-api-write` Workers Secret and the
`tg-bot` Workers Secret. They must be rotated in lockstep via
`wrangler secret put OPERATOR_TOKEN` against both Workers, in
the same maintenance window. The bot will reject 401s for a few
seconds during the swap, which is acceptable for v1.

**Rotation note for `WALLET_SECRET`:** same two-location pattern
(GH Actions secret + `vault-anchor-cron` Workers Secret). The
rotation window is also tight; the Cron Worker may briefly
reject 401s. Acceptable for v1.

| Secret                     | Lives in                                                  | Used by                  | Rotation                                                          |
| -------------------------- | --------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------- |
| `WALLET_SECRET`            | GH Actions encrypted secret + Account A Workers Secret on `vault-anchor-cron` | anchor job + cron trigger | Quarterly. See "Rotation note" above. Multi-sig is Phase 2.       |
| `OPERATOR_TOKEN`           | Account A Workers Secret on `vault-api-write` + Account B Workers Secret on `tg-bot` | write API + bot          | On operator departure. See "Rotation note" above. 32+ byte random. |
| `TG_BOT_TOKEN`             | Account B Workers Secret on `tg-bot`                      | bot                      | On bot compromise.                                                |
| `TG_WEBHOOK_SECRET`        | Account B Workers Secret on `tg-bot`                      | bot                      | On bot webhook endpoint rotation.                                 |
| `HELIUS_WEBHOOK_SECRET`    | Account A Workers Secret on `vault-ingest`                | ingest                   | On provider change.                                               |
| `HELIUS_RPC_URL`           | Account A Workers Secret on `vault-anchor-cron`           | anchor worker            | On provider change.                                               |
| `VAULT_WALLET_ADDRESS`     | Account A Workers Secret on `vault-ingest`                | ingest                   | Never changes (it's the treasury address).                        |
| `VAULT_API_URL`            | Account B Workers Secret on `tg-bot`                      | bot                      | Never changes (it's the vault's public URL).                      |

## CI/CD (GitHub Actions)

### `ci.yml` — runs on PRs and on push to `main`

Steps:

1. Checkout.
2. Setup pnpm, Node 20, Python 3.12 (via `actions/setup-python` with
   `uv`).
3. `pnpm install --frozen-lockfile`.
4. `uv sync` for `tools/anchor-job`.
5. **TS checks** (per package, parallel):
   - `pnpm exec eslint .`
   - `pnpm exec prettier --check .`
   - `pnpm exec tsc --noEmit`
   - `pnpm exec vitest run`
6. **Python checks** (per tool, parallel):
   - `uv run ruff check`
   - `uv run ruff format --check`
   - `uv run basedpyright`
   - `uv run pytest`
7. **Invariant tests** (Python): `pytest tests/test_invariants.py`.
8. **Wrangler dry-run** per Worker: `wrangler deploy --dry-run
   --outdir=dist` (catches config errors before deploy).
9. **D1 migration lint**: a Python script walks `migrations/*.sql`
   and fails on `UPDATE`/`DELETE` outside the explicit allowlist
   (empty at v1).
10. **Binding allowlist check**: a Python script diffs every
    `wrangler.toml` against the allowlist of which Worker can bind
    to which database. Fails the build on any binding not in the
    allowlist. (See invariant I-4.)
11. **Workers Tail policy check**: confirms no Worker has both
    `vault-db` (write) and `bot-db` bindings.
12. **Cross-language parity test**: a fixture produces the same
    head hash in TS and Python.

### `deploy.yml` — runs on push to `main` after `ci.yml` passes

Steps:

1. All CI steps.
2. `pnpm build` in each app.
3. `wrangler deploy` for each Worker with `--env production`.
4. `wrangler pages deploy` for the Pages project.
5. `wrangler d1 migrations apply vault-db --remote` if new
   migration files are present.
6. `wrangler d1 migrations apply bot-db --remote` if new
   migration files are present.
7. `curl -fsS https://<host>/api/health` (smoke test).
8. `curl -fsS https://<host>/api/verify` and assert the response
   has the expected shape.

### `anchor.yml` — runs on `schedule: cron: "17 2 * * *"` and on `workflow_dispatch`

Schedule is `17 2 * * *` (02:17 UTC), **not** `0 2 * * *` (02:00
UTC). Per GitHub's docs, top-of-the-hour schedules are the most
likely to be delayed or dropped. Off-hour schedules are much more
reliable.

Steps:

1. Setup Python 3.12 with `uv`.
2. Idempotency check: `curl https://<vault-api-read>/api/verify`
   and parse the response. If `anchor.published_at_utc` is today
   AND it's a fresh day, exit ok.
3. Compute head hash: `curl
   https://<vault-api-read>/api/verify` again (or reuse) — the
   `head_hash` is what we publish.
4. Build, sign, send the anchor tx via Helius RPC.
5. `POST` to `https://<vault-api-write>/api/anchor/manual` with
   `source: "github-actions"` and the tx signature.
6. Log the tx signature as a workflow artifact and step output.
7. On any step failure: `exit 1`, GH Actions emails the operator.
   The Cron Trigger will run 5-10 minutes later (or vice versa)
   and likely succeed.

## Deployment guardrails

- **Branch protection on `main`:** requires CI green, requires 1
  review. Solo dev: the 1 review is the operator, which doesn't
  enforce separation of duties but does force a PR. Phase 2
  (multi-operator) adds real review.
- **No force-pushes** to `main`.
- **No direct push to `main`** (the deploy workflow is triggered
  by `push` to `main` from a PR; bypass would skip CI).
- **Wrangler secrets are set out-of-band** (`wrangler secret put`),
  not in any config file.
- **No `.env` files in the repo.** `.env.example` is allowed.
- **No `--remote` flag in any CI step that mutates production**
  outside `deploy.yml`. `wrangler dev` and `wrangler d1 migrations
  apply <db> --local` only.

## Local development

### Frontend

```sh
pnpm --filter web dev
# Vite dev server on http://localhost:5173
# Reads VITE_API_BASE from .env.local (default: http://localhost:8787)
```

### Workers (local)

```sh
pnpm --filter api-read dev
# wrangler dev with --local; miniflare-backed local D1
pnpm --filter api-write dev
pnpm --filter ingest dev
pnpm --filter anchor-cron dev
pnpm --filter tg-bot dev
```

Each Worker binds to a local D1 instance via `--local`. The local
D1 lives in `.wrangler/state/v3/d1/`.

### DB reset

```sh
pnpm db:reset
# Runs wrangler d1 migrations apply <db> --local
# Seeds the bootstrap row
```

### Python anchor (dry-run)

```sh
uv run --directory tools/anchor-job python -m anchor_job.dry_run
# Signs a tx against the configured RPC but does not send
# Prints the would-be tx signature
```

### End-to-end smoke test

```sh
pnpm e2e:smoke
# Playwright script:
#   - starts dev API + frontend
#   - navigates to /
#   - asserts totals render
#   - navigates to /verify
#   - asserts the structure is correct
#   - exits
```

## Free-tier limits and what we use

| Resource              | Free limit (per source)                                    | Our use                          | Headroom                                  |
| --------------------- | ---------------------------------------------------------- | -------------------------------- | ----------------------------------------- |
| Cloudflare Workers requests | 100,000 / day                                         | ~1,000 / day at MVP              | 100x                                      |
| Cloudflare Workers CPU    | 10 ms / HTTP request, 30 s / cron                       | < 5 ms / request typical         | 2x for request; 6x for cron (large chain) |
| Cloudflare Cron Triggers | 5 / account                                                | 1                                | 4x                                       |
| Cloudflare D1 storage    | 500 MB / DB, 5 GB total                                  | ~1 MB at MVP, ~50 MB at 5 years  | Plenty                                    |
| Cloudflare D1 databases | 10 / account on Free                                       | 2 (vault-db, bot-db)             | 5x                                       |
| Cloudflare Pages builds  | 500 / month                                                | ~20 / month                      | 25x                                      |
| Cloudflare Pages bandwidth | Unlimited on Free                                       | Negligible                       | ∞                                        |
| Helius RPC reqs          | 10 / sec                                                   | ~5 / day                         | ∞                                        |
| Helius sendTransaction   | 1 / sec                                                    | 1 / day                          | Plenty                                    |
| Helius webhooks          | 5                                                          | 1 (vault address)                | 4x                                       |
| GH Actions minutes (public) | Unlimited                                                | ~10 min / day for CI + anchor    | ∞                                        |
| UptimeRobot checks       | 50 free, 5-min interval                                    | 1                                | Plenty                                    |

If any limit is hit, the **first** thing to check is whether the
chain has grown large enough that the cron worker's 30s budget
is at risk. Mitigation: the anchor worker is a single read +
single write; 30s is comfortable up to ~100k rows. Beyond that,
move to Workers Paid ($5/mo) and the limit becomes 30 minutes.
