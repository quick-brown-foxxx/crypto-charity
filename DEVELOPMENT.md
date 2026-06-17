# Development Guide

**Status:** Preparation complete; implementation phase begins.  
**Date:** 2026-06-16

Quick-start patterns for working on this project. Read `docs/ops/secrets-inventory.md`
first for what's already deployed.

## Mental model

This is a Cloudflare Workers monorepo, not a classic long-running server.

| Classic (NestJS/Next.js)          | Edge (this project)                                    |
| --------------------------------- | ------------------------------------------------------ |
| Long-running Node process         | Fresh V8 isolate per request                           |
| `process.env` / `.env`            | `.dev.vars` (local) / `wrangler secret put` (deployed) |
| Docker → build → deploy (minutes) | `wrangler deploy` (~12s, global edge in <30s)          |
| Separate staging infra            | Same infra, different secrets and domain               |
| In-memory state between requests  | Stateless. Use D1 for persistence.                     |

## Local dev

```bash
# One-time
cp .env.example .dev.vars
# Edit .dev.vars — use generated fake keys, never real staging secrets.

# Start a Worker
cd apps/<name>
pnpm dev                    # wrangler dev → http://localhost:8787
```

What happens:

- `wrangler dev` runs the real Cloudflare runtime (Workerd) locally.
- D1 bindings point to a local SQLite file (auto-created).
- `.dev.vars` secrets are injected as env bindings.
- Console output appears in your terminal.
- Edit source → next request uses new code (no restart needed).

Local dev is **not a mock**. It's the same V8 isolate, same D1 engine, same Web
Crypto API as production.

### Local D1 migrations

```bash
pnpm exec wrangler d1 migrations apply vault-db --local
pnpm exec wrangler d1 migrations apply bot-db --local
```

## Staging

Staging is `staging.open-care.org`. It uses the same Cloudflare infra as
production will — only secrets and domain differ.

### Deploy a Worker

```bash
cd apps/<name>
pnpm exec wrangler deploy
# ~12 seconds. Route goes live at staging.open-care.org/<path>.
```

### Deploy the frontend

```bash
cd apps/web
pnpm build
pnpm exec wrangler pages deploy .svelte-kit/cloudflare --project-name open-care-web
```

### Apply D1 migrations (staging)

```bash
pnpm exec wrangler d1 migrations apply vault-db
pnpm exec wrangler d1 migrations apply bot-db
```

### View live logs

```bash
pnpm exec wrangler tail <worker-name>
# Streams requests, status codes, duration, console.log.
# Secrets are auto-redacted by Cloudflare.
```

### Verify

```bash
curl https://staging.open-care.org/api/health
curl -X POST https://staging.open-care.org/webhook/helius \
  -H "Authorization: Bearer <HELIUS_WEBHOOK_AUTH_HEADER>" -d '{}'
```

## The dev loop

```text
write code → wrangler dev (local test) → vitest (unit/integration)
          → wrangler deploy (staging) → curl verify → wrangler tail (logs)
          → repeat
```

Each deploy cycle is ~15 seconds. There is no Docker build, no container
orchestration, no SSH.

## Key constraints

- **Stateless.** No in-memory caches between requests. Use D1 for persistence.
- **CPU limit.** 30s per request (free plan). Long work goes in `ctx.waitUntil()`.
- **D1 latency.** Reads can be 5–50ms depending on edge location. Public endpoints
  should use 60s cache TTLs (per spec `04-api.md`).
- **Secrets.** Accessed via `c.env.SECRET_NAME` (Hono bindings), not `process.env`.
- **No treasury key.** The treasury private key is never in Workers, CI, or repo.

## What's already set up

See `docs/ops/secrets-inventory.md` for the full readiness status. Summary:

- All Worker secrets pushed to Cloudflare (OPERATOR_TOKEN on vault-operator pending; see secrets inventory).
- `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in GitHub Actions.
- Helius and Telegram webhooks configured → draft Workers responding at staging.
- Devnet wallets funded (treasury + anchor; donor pending rate limit).
- `staging.open-care.org` DNS live.
- Solana CLI (`solana`, `solana-test-validator`) installed.

## What the AI creates (implementation phase)

All Worker `src/` code and the frontend are draft/mock and will be **overwritten**
(not extended) with real implementations. Preserve infra-level configs
(`wrangler.jsonc`, `package.json` names/dependencies, `tsconfig.json` options)
only when they match the specs; overwrite everything else.

- `.github/workflows/` (PR CI + deploy).
- D1 seed data scripts; Drizzle ORM schemas and migration tooling.
- `packages/vault-core/`, `packages/vault-db/`, `packages/bot-crypto/` source code (currently empty scaffolds).
- Full SvelteKit frontend in `apps/web/` (rebuilt from scratch; current draft is disposable).
- Real Worker implementations for ingest, tg-bot, api-read, api-write, anchor-cron, operator (overwriting drafts).
- ESLint, Prettier, Vitest, Playwright configs.
- Route configuration for `vault-api-read` and `vault-operator` on staging domain.

## Future local infra extension

Local realistic simulation and Solana interaction testing are intentionally
deferred. When the project moves past pure unit/integration tests, research
and implement proper automated and manual testing tooling — e.g. localnet
orchestration, webhook simulation fixtures, chain-state seeders — as a
dedicated architecture/infrastructure task. Do not bolt ad hoc scripts onto the
main dev loop.
