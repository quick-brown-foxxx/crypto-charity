# Development Guide

Quick-start patterns for working on this project. For architecture and system
shape, see `AGENTS.md`. For deployed secrets and readiness, see
`docs/ops/secrets-inventory.md`.

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

- Copy `.env.example` → `.dev.vars` (gitignored). `wrangler dev` reads `.dev.vars`, not `.env`.
- Use fake/generated keys locally; never put staging/prod secrets in `.dev.vars`.
- Per-app dev server:

  ```bash
  cd apps/<name>
  pnpm dev          # wrangler dev → http://localhost:8787
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

## Quality gates (run before commit/PR)

```bash
pnpm run final-check   # format:check → lint → typecheck → test → build
```

This runs the exact same sequence as CI. All 5 gates must exit 0.

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
- Deployed secrets are set with `wrangler secret put` per Worker. See `docs/ops/secrets-inventory.md`.
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

### Apply D1 migrations (staging)

```bash
pnpm exec wrangler d1 migrations apply vault-db
pnpm exec wrangler d1 migrations apply bot-db
```

### Verify

```bash
curl https://staging.open-care.org/api/health
curl -X POST https://staging.open-care.org/webhook/helius \
  -H "Authorization: Bearer <HELIUS_WEBHOOK_AUTH_HEADER>" -d '{}'
```

## Seed data (local dev)

```bash
pnpm run seed   # applies migrations + seed data for both D1 databases
```

## The dev loop

```text
write code → wrangler dev (local test) → vitest (unit/integration)
          → wrangler deploy (staging) → curl verify → wrangler tail (logs)
          → repeat
```

Each deploy cycle is ~15 seconds. There is no Docker build, no container
orchestration, no SSH.

## Future local infra extension

Local realistic simulation and Solana interaction testing are intentionally
deferred. When the project moves past pure unit/integration tests, research
and implement proper automated and manual testing tooling — e.g. localnet
orchestration, webhook simulation fixtures, chain-state seeders — as a
dedicated architecture/infrastructure task. Do not bolt ad hoc scripts onto the
main dev loop.
