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
pnpm run final-check   # install → secret scan → ledger guard → sync → lint/format:check/check/test/python-verify/build
```

This runs the local pre-commit sequence, including the secret scan and ledger
mutation guard. CI runs repository quality gates on PR/push to main and also
runs the Chromium Playwright browser suite. All normal commit/PR gates must exit 0. Manual live checks are listed in their own sections below and are not normal
PR CI gates.

Individual normal gates:

```bash
pnpm run format:check   # prettier --check .
pnpm run lint           # eslint .
pnpm run lint:fix       # eslint --fix .
pnpm run check          # tsc -b
pnpm run test           # vitest run
pnpm run test:python-verify # python3 test/verify/test_vector.py
pnpm run build          # tsc -b + SvelteKit build
pnpm exec playwright test --project=chromium # Chromium browser smoke suite
pnpm run final-check:secret-scan # scan repo source, docs, tools, and root files for treasury key material
pnpm run final-check:ledger-guard # reject ledger_events UPDATE/DELETE in production src dirs
```

Manual/live checks are intentionally separate from the normal commit/PR gate
list because they depend on live provider credentials, staging availability,
funded throwaway wallets, or external account state. See the Devnet, Helius, and
Telegram sections below for their commands and fail-closed behavior.

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

- Staging is the default Worker environment. Worker configs also define
  `env.production` for mainnet/public-domain deployment.
- Production D1 bindings use placeholder database IDs until a human creates or
  selects production D1 databases. Replace `TBD_PRODUCTION_VAULT_DB_ID` and
  `TBD_PRODUCTION_BOT_DB_ID` before production migrations or deploys. If the
  production D1 database names differ from `vault-db` / `bot-db`, update the
  production migration commands and GitHub workflow targets at the same time.
- Live logs: `pnpm exec wrangler tail <worker-name>`.

### Production deploy caveats

Production deploys use the `production` Wrangler environment and publish Workers
with `-production` names (for example, `vault-api-read-production`). Production
service bindings in `apps/operator/wrangler.jsonc` target those names.

```bash
cd apps/<name>
pnpm exec wrangler deploy --env production
```

Production migrations must run only after the production D1 placeholders in the
Worker configs have been replaced with real database IDs:

```bash
cd apps/ingest
pnpm exec wrangler d1 migrations apply vault-db --env production --remote

cd ../tg-bot
pnpm exec wrangler d1 migrations apply bot-db --env production --remote
```

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
pnpm run verify:chain -- --base-url https://staging.open-care.org
```

`verify:chain` requires an explicit deployment base URL or
`VERIFY_CHAIN_BASE_URL`; it recomputes `/api/ledger-events` hashes and checks
published anchor metadata from `/api/verify`.

## Seed data (local dev)

```bash
pnpm run seed   # applies migrations + seed data for both D1 databases
```

## Local Solana validator smoke

Use the localnet harness when developing blockchain-facing tests or checking
fixture setup against a real `solana-test-validator` process:

```bash
pnpm run blockchain:local-validator
pnpm run blockchain:local-validator -- --allow-skip
pnpm run blockchain:local-validator -- --rpc-port 8899 --keep-ledger
pnpm run blockchain:local-validator -- --test-command "pnpm run test"
```

The harness preflights `solana-test-validator`, starts an isolated validator with
`--reset`, creates throwaway localnet keypairs, creates an SPL Token mint, funds a
donor/source token account, creates a treasury owner and vault ATA, and then runs
either a built-in SPL transfer + memo smoke or the provided test command. It
prints public addresses/signatures only; no devnet/mainnet secrets are required
or read.

Temporary validator ledgers and generated keypairs are removed on normal exit,
failure, and Ctrl+C. Pass `--keep-ledger` only when you need to inspect the temp
ledger path printed by the command. On machines without Solana CLI tooling,
`--allow-skip` exits 0 with a `SKIP` message instead of failing the whole dev
loop.

## Devnet live Solana smoke

The devnet smoke is a manual-only live check. It is intentionally **not** part of
PR CI because it spends devnet SOL fees and transfers a tiny amount of devnet
USDC. Use throwaway/faucet-funded devnet wallets only; never use mainnet or
treasury private keys.

```bash
pnpm run smoke:devnet -- --help
ALLOW_DEVNET_SMOKE=true \
SOLANA_CLUSTER=devnet \
HELIUS_RPC_URL=<devnet RPC URL> \
ANCHOR_WALLET_SECRET=<base58 devnet keypair secret> \
ANCHOR_WALLET_ADDRESS=<anchor wallet public key> \
DONOR_WALLET_SECRET=<base58 devnet donor keypair secret> \
TREASURY_WALLET_ADDRESS=<devnet treasury owner public key> \
VAULT_USDC_ATA=<devnet vault USDC token account> \
USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
pnpm run smoke:devnet
```

Optional knobs:

- `DONOR_USDC_ATA` — source token account; defaults to the donor wallet's
  associated token account for `USDC_MINT`.
- `DEVNET_SMOKE_USDC_MINOR_AMOUNT` — raw minor-unit transfer amount, default `1`
  and capped at `10000`.

The script validates required config, verifies the anchor secret matches the
public anchor address, verifies the RPC endpoint reports the known Solana devnet
genesis hash before signing, verifies `VAULT_USDC_ATA` is the associated token
account for `TREASURY_WALLET_ADDRESS` + `USDC_MINT`, verifies the on-chain vault
token account owner is the treasury address, sends a real `ccv-anchor:<64hex>`
Memo transaction, fetches finalized parsed transactions with null-before-finality
retry handling, and verifies the tiny USDC transfer lands in `VAULT_USDC_ATA`.

## Staging Helius webhook contract smoke

The Helius contract smoke is a manual-only staging check. It is intentionally
**not** part of PR CI because it sends real staging webhook requests and spends
devnet SOL fees plus a tiny amount of devnet USDC. Use throwaway/faucet-funded
devnet wallets only; never use mainnet or treasury private keys.

Keep this check out of `pnpm run test`, `pnpm run final-check`, and PR CI. It is
useful release evidence, but it depends on live Helius credentials, provider
delivery behavior, public staging availability, devnet finality, faucet-funded
wallet state, and webhook/API timing. Those dependencies make it intentionally
manual rather than deterministic local/CI proof.

```bash
pnpm run smoke:helius-contract -- --help
pnpm run smoke:helius-contract # fail-closed unless ALLOW_HELIUS_CONTRACT_SMOKE=true
ALLOW_HELIUS_CONTRACT_SMOKE=true \
HELIUS_API_KEY=<Helius API key used by the staging webhook provider> \
HELIUS_WEBHOOK_AUTH_HEADER=<staging webhook token without Bearer prefix> \
SOLANA_CLUSTER=devnet \
HELIUS_RPC_URL=<devnet RPC URL> \
DONOR_WALLET_SECRET=<base58 devnet donor keypair secret> \
TREASURY_WALLET_ADDRESS=<devnet treasury owner public key> \
VAULT_USDC_ATA=<devnet vault USDC token account> \
USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
pnpm run smoke:helius-contract
```

Optional knobs:

- `WEBHOOK_URL` — defaults to `https://staging.open-care.org/webhook/helius` and
  must remain on the staging host.
- `API_BASE_URL` — defaults to `https://staging.open-care.org` and must remain on
  the staging host.
- `DONOR_USDC_ATA` — source token account; defaults to the donor wallet's
  associated token account for `USDC_MINT`.
- `HELIUS_CONTRACT_USDC_MINOR_AMOUNT` — raw minor-unit transfer amount, default
  `1` and capped at `10000`.
- `HELIUS_CONTRACT_ACK_MAX_MS` — maximum webhook ACK duration, default `1000`.
- `HELIUS_CONTRACT_POLL_TIMEOUT_MS` / `HELIUS_CONTRACT_POLL_INTERVAL_MS` — public
  ledger polling controls, default `120000` / `3000`.

The script verifies wrong-token `401`, malformed-JSON `400 BAD_REQUEST`,
correct-token `200`, ACK-fast timing, and duplicate replay. Duplicate replay uses
one real finalized devnet USDC transfer signature, posts it twice to the staging
webhook, then polls the public read API from a pre-transfer `/api/verify`
baseline to assert exactly one `donation_confirmed` ledger event for that
signature.

## Telegram staging E2E (manual)

The Telegram E2E suite is a manual live staging check. It is intentionally
**not** part of PR CI because it uses a real Telegram test account, the staging
bot token, and the staging operator token.

```bash
pnpm run test:tg-e2e:collect
pnpm run test:tg-e2e
pnpm run test:tg-e2e:fail-closed
ALLOW_TG_E2E=true \
TELETHON_API_ID=<telegram api id> \
TELETHON_API_HASH=<telegram api hash> \
TELETHON_SESSION_STRING=<telethon string session> \
TG_BOT_TOKEN=<staging bot token> \
OPERATOR_TOKEN=<staging operator token> \
pnpm run test:tg-e2e
```

Optional knobs:

- `TG_E2E_OPERATOR_BASE_URL` — defaults to and must remain
  `https://staging.open-care.org`.
- `TG_E2E_BOT_USERNAME` — skips Bot API `getMe` username resolution when set.
- `TG_E2E_TIMEOUT_SECONDS` — default `20`.

The Python dependencies, Poe task definitions, and Telethon session generator
remain in `test/e2e-tg/`; the real pytest files live under `test/e2e-tg/` so
test code is kept in the top-level test tree. The suite constructs
`TelegramClient(..., sequential_updates=True)`, uses
Telethon's Conversation API for deterministic bot interactions, and sleeps one
second between tests to reduce rate-limit pressure. The tests fail closed unless
`ALLOW_TG_E2E=true` is set, skip clearly when required env is missing, and never
print Telethon session strings, bot/operator tokens, full Telegram identifiers,
or full gift-card codes.

## The dev loop

```text
write code → wrangler dev (local test) → vitest (unit/integration)
          → wrangler deploy (staging) → curl verify → wrangler tail (logs)
          → repeat
```

Each deploy cycle is ~15 seconds. There is no Docker build, no container
orchestration, no SSH.

## Future local infra extension

Webhook simulation fixtures and richer chain-state seeders are still future
work. Keep additional realistic simulation tooling isolated in dedicated tools
or test fixtures rather than bolting ad hoc setup onto the main dev loop.
