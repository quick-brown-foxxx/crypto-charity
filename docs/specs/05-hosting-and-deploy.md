# 05 — Hosting and Deployment

**Status:** Implemented
**Date:** 2026-06-18
**Scope:** MVP infrastructure, secrets, CI/CD, and environments.

## Hosting decisions

| Concern               | Choice                                                                 | Why                                                                                                         |
| --------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Web frontend          | SvelteKit 2.x + Svelte 5 on Cloudflare Pages with `adapter-cloudflare` | Matches the project frontend standard, supports typed routes/load/actions, and keeps hosting on Cloudflare. |
| Workers               | Cloudflare Workers                                                     | Fits read API, write API, ingest, anchor, and bot webhooks.                                                 |
| Ledger DB             | Cloudflare D1 `vault-db`                                               | SQLite-compatible, enough for MVP, simple migrations.                                                       |
| Bot DB                | Separate Cloudflare D1 `bot-db` in the same Cloudflare account         | Practical privacy boundary for Telegram mapping without multi-account ops overhead.                         |
| Solana RPC / webhooks | Helius                                                                 | Webhooks, RPC, devnet/mainnet endpoints, free tier suitable for MVP.                                        |
| CI/CD                 | GitHub Actions                                                         | Public repo CI is free; manual/live jobs can be separately gated.                                           |
| Anchor schedule       | Cloudflare Cron plus operator-triggered backup run                     | Public liveness with an operator fallback through the same anchor code path.                                |

The operator-triggered backup run is not a separate anchoring system. It invokes
the same anchor logic as the scheduled Cloudflare Cron run, with the same
`ANCHOR_WALLET_SECRET`, ledger verification, Memo format, and `anchor_runs`
state handling.

## Cloudflare topology

The accepted topology uses **one Cloudflare account** for both vault and bot
resources. A previously considered two-account split was rejected for MVP and the
foreseeable future because it adds operational overhead without enough benefit at
this scale. The boundary is enforced with separate Workers, separate D1
databases, separate secrets, and binding allowlist checks in CI.

### Vault resources

Resources:

- Pages project: `open-care-web` (matches the deployed project name in `docs/ops/secrets-inventory.md` and the deploy command in `DEVELOPMENT.md`).
- Workers:
  - `vault-api-read` — `vault-db` read binding, no secrets. Public surface.
  - `vault-operator` — no D1 binding. **Sole holder of `OPERATOR_TOKEN`.**
    Service bindings to `vault-api-write`, `vault-anchor-cron`, and
    `tg-bot`. Auths every operator request, then forwards to the
    right downstream Worker via the binding. The public path is
    reached via a public HTTPS route or via a Pages Function
    proxy; the binding destinations are not publicly routable for
    these routes.
  - `vault-api-write` — `vault-db` write binding, no operator
    secrets. Reached only via service binding from `vault-operator`.
  - `vault-ingest` — `vault-db` write binding, Helius auth/RPC config.
  - `vault-anchor-cron` — `vault-db` write binding, anchor wallet
    secret. Reached via cron trigger or service binding from
    `vault-operator` for manual triggers.
- D1 database: `vault-db`.
- Cron Trigger: daily anchor run, off the top of the hour.

### Bot resources

Resources:

- Worker: `tg-bot` with `bot-db` only. Reached from the public
  Telegram webhook and via service binding from `vault-operator`
  for the internal endpoints.
- D1 database: `bot-db`.

Vault Workers do not receive the `bot-db` binding. The bot Worker
does not receive the `vault-db` binding; it returns a row from
`bot-db` only, and `vault-operator` is the only Worker that calls it
for the internal endpoints. Cloudflare account admins can still access
account resources, so this is not a state-adversary-grade isolation
boundary. The binding allowlist is checked in CI per invariant I-7.

## Secrets and environment variables

| Name                         | Location                          | Required for PR CI?                | Purpose                                                                                                                                                                                                                                    |
| ---------------------------- | --------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OPERATOR_TOKEN`             | `vault-operator` Worker Secret    | no                                 | Sole holder of the operator write auth. Validated by `vault-operator` and forwarded via service binding to `vault-api-write`, `vault-anchor-cron`, and `tg-bot`. The downstream Workers do not hold the token.                             |
| `TG_BOT_TOKEN`               | `tg-bot` Workers Secret           | no                                 | Telegram Bot API.                                                                                                                                                                                                                          |
| `TG_WEBHOOK_SECRET`          | `tg-bot` Workers Secret           | no                                 | Telegram webhook secret-token validation.                                                                                                                                                                                                  |
| `TG_ID_HMAC_KEY`             | `tg-bot` Workers Secret           | no                                 | Keyed HMAC for non-reversible stable Telegram user references.                                                                                                                                                                             |
| `TG_CHAT_ENC_KEY`            | `tg-bot` Workers Secret           | no                                 | Authenticated encryption key for Telegram chat delivery routes.                                                                                                                                                                            |
| `HELIUS_API_KEY`             | deploy/live environments          | no                                 | Helius management/RPC access.                                                                                                                                                                                                              |
| `HELIUS_RPC_URL`             | ingest/anchor environments        | no for PR; optional for live smoke | Solana RPC endpoint.                                                                                                                                                                                                                       |
| `HELIUS_WEBHOOK_AUTH_HEADER` | `vault-ingest` Workers Secret     | no                                 | Bearer token (without `Bearer ` prefix) for Helius webhook auth. The Worker strips the `Bearer ` prefix from the incoming `Authorization` header before comparing. Set in the Helius dashboard `authHeader` field as just the token value. |
| `TREASURY_WALLET_ADDRESS`    | public config + ingest env        | yes as non-secret test value       | Owner of the vault USDC ATA.                                                                                                                                                                                                               |
| `VAULT_USDC_ATA`             | public config + ingest env        | yes as non-secret test value       | USDC token account watched for donations.                                                                                                                                                                                                  |
| `USDC_MINT`                  | public config                     | yes as non-secret test value       | Cluster-specific USDC mint.                                                                                                                                                                                                                |
| `ANCHOR_WALLET_ADDRESS`      | public config + anchor env        | yes as non-secret test value       | Public signer for Memo anchors.                                                                                                                                                                                                            |
| `ANCHOR_WALLET_SECRET`       | `vault-anchor-cron` Worker Secret | no                                 | Anchor wallet keypair; holds only SOL for fees. **Not in `vault-operator`** — manual triggers are routed through `vault-operator` to `vault-anchor-cron` via service binding.                                                              |
| `SOLANA_CLUSTER`             | all blockchain-aware environments | yes                                | `localnet`, `devnet`, or `mainnet-beta`.                                                                                                                                                                                                   |

The treasury private key is intentionally absent from CI, Workers, repository
files, and normal app runtime.

Frontend public config may include only non-secret values: API base URLs when not
same-origin, site URL, `SOLANA_CLUSTER`, `TREASURY_WALLET_ADDRESS`,
`VAULT_USDC_ATA`, `USDC_MINT`, `ANCHOR_WALLET_ADDRESS`, and contact/report URLs.
No `PUBLIC_` or checked-in config value may contain `OPERATOR_TOKEN`, bot
secrets, Helius auth headers/API keys, Telegram identifiers, or gift-card codes.
Authenticated write API CORS, when needed, must allow only the configured
frontend origin.

Telegram identity and route secrets are intentionally absent from PR CI,
repository files, and public config. A `bot-db`-only leak exposes opaque IDs,
handles, HMAC references, and encrypted chat routes, but not plaintext Telegram
user IDs or chat IDs. A leak of both `bot-db` and bot secrets, or bot runtime
compromise, can still deanonymize beneficiaries or deliver messages.

`TG_CHAT_ENC_KEY` is versioned by `handles.telegram_chat_key_version`: new writes
use the current key version, old rows are decrypted by their recorded version,
and rows are re-encrypted under the current version during a planned rotation.
Older decrypt-only key versions stay in the secret store only until rotation is
complete. Rotating `TG_ID_HMAC_KEY` changes `telegram_user_ref` values and
requires a planned migration based on future incoming Telegram updates or
explicit re-registration, because plaintext Telegram user IDs are not stored.

Chat-encryption secrets are stored as versioned 256-bit AES-GCM keys. The
current encrypting key and any temporary decrypt-only keys are configured only in
the bot environment; vault Workers never receive them.

## Cluster configuration

| Cluster        | USDC mint                                      | Use                                       |
| -------------- | ---------------------------------------------- | ----------------------------------------- |
| `mainnet-beta` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | Production donations.                     |
| `devnet`       | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | Live smoke tests with no financial value. |
| `localnet`     | Local test mint                                | Local validator tests.                    |

Every transaction fetch used for ingestion or verification finality uses
`commitment: "finalized"` and `maxSupportedTransactionVersion: 0`.

## CI/CD

### PR CI

PR CI must not require paid funds, real mainnet secrets, or a funded mainnet
wallet. It runs:

1. TypeScript lint, format, typecheck, SvelteKit `svelte-check`, and unit tests.
2. D1 migration lint and schema invariant checks.
3. Hash-chain canonical JSON and verification script tests.
4. Local-validator blockchain tests if the toolchain is available in CI.
5. Browser smoke tests against local or seeded data.

If local Solana tooling is not available, PR CI reports the local-validator
blockchain suite as skipped with a clear reason; it does not silently replace it
with fake mocked tests.

### Deploy workflow

Runs after PR CI passes and applies production deploy steps:

1. Build SvelteKit web and Workers.
2. Deploy Workers and Pages.
3. Apply D1 migrations.
4. Smoke `GET /api/health` and `GET /api/verify`.
5. Confirm public config contains the expected treasury/anchor wallet addresses
   and USDC mint.

### Live smoke workflows

Live blockchain checks are gated separately:

- **Devnet live smoke:** manual or nightly, free, uses throwaway devnet keypairs
  and faucet funds.
- **Helius webhook contract smoke:** manual/nightly against public HTTPS staging,
  uses Helius API key and configured auth header.
- **Tiny mainnet smoke:** optional manual release gate only, paid, throwaway
  wallet, never normal CI.

## Anchor job

Scheduled anchor steps:

1. Verify the current ledger chain and compute the pre-anchor head.
2. Create or update an `anchor_runs` row for the `anchor_date` and head hash.
3. Build Memo text `ccv-anchor:<64hex head_hash>`.
4. Sign and send a Solana transaction with the anchor wallet.
5. Fetch the transaction at finalized commitment.
6. Append an `anchor_published` ledger event after the transaction is known.
7. Mark `anchor_runs.status='published'`.

Failures update `anchor_runs` only. They do not create donor-visible ledger
events until a transaction is known.

## Donation ingest job

Helius webhook setup watches the vault USDC ATA and, where useful, the treasury
owner address. The webhook config sets `authHeader` to the token value (without
the `Bearer ` prefix). Helius sends it as `Authorization: Bearer <token>`. The
Worker extracts the Bearer token before comparing.

The ingest Worker:

- ACKs quickly after durable inbox write.
- Processes asynchronously.
- Deduplicates by transaction signature.
- Accepts finalized SPL Token transfers for the configured USDC mint whose
  destination is the configured vault USDC ATA.
- Retries RPC `null`, 429, and 5xx outcomes with backoff.
- Supports minimal reconciliation/backfill from address/token-account history.

## Local development

Local dev uses local D1 and either mocked Solana payload fixtures or a local
validator. Local config must make the cluster explicit (`localnet` or `devnet`)
so test transactions cannot be confused with production.

## Deployment guardrails

- No secrets in repo or config files.
- No treasury private key in CI or Workers.
- `wrangler.toml` binding allowlist enforced in CI.
- Main branch protected by CI.
- Live smoke jobs are opt-in and environment-gated.
- Anchor wallet low-SOL threshold is monitored and surfaced in `/api/health`.
